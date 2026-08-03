import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { signMetaOAuthState } from "@/lib/server/meta-oauth-state";
import { SITE_URL } from "@/lib/constants";
import { META_GRAPH_API_VERSION } from "@/lib/server/meta-graph-api";
import { metaLeadsBusinessLoginConfiguration } from "@/lib/server/meta-leads-config";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SCOPES = [
  "pages_show_list",
  "leads_retrieval",
  "pages_read_engagement",
  "pages_manage_metadata",
  "pages_manage_ads",
  "business_management",
  // Sem isso, o token de página nunca conseguiu ler campanha/conjunto/anúncio
  // via Graph API (/{ad_id}?fields=name,campaign{...},adset{...}) — falhava
  // silenciosamente em todo lead, sempre, desde o início. pages_manage_ads só
  // cobre gerenciar anúncios pela página, não ler objetos de conta de anúncio.
  "ads_read",
].join(",");

/** Redirects the authenticated tenant to Facebook OAuth consent screen. */
export async function GET(): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const appId = process.env.META_APP_ID?.trim();
  if (!appId) {
    return NextResponse.json({ error: "META_APP_ID not configured on server." }, { status: 503 });
  }

  const nonce = crypto.randomUUID();
  const sb = createSupabaseServiceClient();
  const { data: generation, error: beginError } = await sb.rpc("begin_meta_lead_oauth", {
    p_tenant_id: session.tenantId,
    p_nonce: nonce,
  });
  if (beginError || !Number.isSafeInteger(Number(generation))) {
    return NextResponse.json({ error: "Não foi possível iniciar a conexão Meta." }, { status: 503 });
  }

  const state = await signMetaOAuthState({
    tenantId: session.tenantId,
    nonce,
    ...(session.employeeId ? { employeeId: session.employeeId } : {}),
    employeeEmail: session.email,
  });
  if (!state) {
    return NextResponse.json(
      {
        error:
          "Cannot start Meta OAuth — configure META_APP_SECRET, JWT_SECRET or CLIENT_SESSION_COOKIE_SECRET.",
      },
      { status: 503 },
    );
  }

  // Use SITE_URL from constants — já resolve NEXT_PUBLIC_SITE_URL com fallback para https://mychatcrm.com.br
  const siteUrl = SITE_URL.replace(/\/$/, "");
  const redirectUri = `${siteUrl}/api/meta/callback`;

  const fbUrl = new URL(`https://www.facebook.com/${META_GRAPH_API_VERSION}/dialog/oauth`);
  fbUrl.searchParams.set("client_id", appId);
  fbUrl.searchParams.set("redirect_uri", redirectUri);
  fbUrl.searchParams.set("response_type", "code");
  fbUrl.searchParams.set("state", state);

  const { configurationId, tokenMode } = metaLeadsBusinessLoginConfiguration();
  if (configurationId) {
    if (!tokenMode) {
      return NextResponse.json(
        {
          error:
            "META_LEADS_TOKEN_MODE não está configurado para o Facebook Login for Business.",
        },
        { status: 503 },
      );
    }
    // Facebook Login for Business is the supported SaaS onboarding. The
    // configuration owns the requested assets and permissions; `scope` must
    // not be mixed into this flow.
    fbUrl.searchParams.set("config_id", configurationId);
    fbUrl.searchParams.set("override_default_response_type", "true");
  } else {
    // Fallback de compatibilidade: sem `META_LEADS_CONFIG_ID` seguimos no OAuth
    // clássico por `scope`, que é o fluxo em uso hoje e está funcionando.
    //
    // O comportamento original aqui era responder 503 em produção para forçar a
    // migração para o Facebook Login for Business. Isso tiraria do ar a conexão
    // Meta de quem já usa o produto no instante do deploy, antes de a variável
    // existir no ambiente. Mantendo o fallback, o Login for Business passa a
    // valer sozinho assim que a configuração for preenchida — sem janela de
    // indisponibilidade e sem exigir coordenação entre deploy e ambiente.
    console.warn(
      "[meta-connect] META_LEADS_CONFIG_ID ausente — seguindo com OAuth por scope",
    );
    fbUrl.searchParams.set("scope", SCOPES);
  }

  return NextResponse.redirect(fbUrl.toString());
}
