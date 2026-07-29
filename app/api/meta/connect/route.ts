import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { signMetaOAuthState } from "@/lib/server/meta-oauth-state";
import { SITE_URL } from "@/lib/constants";

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

  const state = await signMetaOAuthState({
    tenantId: session.tenantId,
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

  const fbUrl = new URL("https://www.facebook.com/v19.0/dialog/oauth");
  fbUrl.searchParams.set("client_id", appId);
  fbUrl.searchParams.set("redirect_uri", redirectUri);
  fbUrl.searchParams.set("scope", SCOPES);
  fbUrl.searchParams.set("response_type", "code");
  fbUrl.searchParams.set("state", state);

  return NextResponse.redirect(fbUrl.toString());
}
