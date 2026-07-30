import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { signMetaOAuthState } from "@/lib/server/meta-oauth-state";
import { SITE_URL } from "@/lib/constants";
import { META_GRAPH_API_VERSION } from "@/lib/server/meta-graph-api";
import { metaLeadsBusinessLoginConfiguration } from "@/lib/server/meta-leads-config";

export const dynamic = "force-dynamic";

const SCOPES = [
  "pages_show_list",
  "leads_retrieval",
  "pages_read_engagement",
  "pages_manage_metadata",
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
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        {
          error:
            "O Facebook Login for Business de Lead Ads ainda não foi configurado no servidor.",
        },
        { status: 503 },
      );
    }
    // Compatibility only for local development and automated tests.
    fbUrl.searchParams.set("scope", SCOPES);
  }

  return NextResponse.redirect(fbUrl.toString());
}
