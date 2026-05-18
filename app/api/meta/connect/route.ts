import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { signMetaOAuthState } from "@/lib/server/meta-oauth-state";

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

  const state = await signMetaOAuthState(session.tenantId);
  if (!state) {
    return NextResponse.json(
      { error: "Cannot start Meta OAuth — CLIENT_SESSION_COOKIE_SECRET not configured." },
      { status: 503 },
    );
  }

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://mychatcrm.vercel.app").replace(/\/$/, "");
  const redirectUri = `${siteUrl}/api/meta/callback`;

  const fbUrl = new URL("https://www.facebook.com/v19.0/dialog/oauth");
  fbUrl.searchParams.set("client_id", appId);
  fbUrl.searchParams.set("redirect_uri", redirectUri);
  fbUrl.searchParams.set("scope", SCOPES);
  fbUrl.searchParams.set("response_type", "code");
  fbUrl.searchParams.set("state", state);

  return NextResponse.redirect(fbUrl.toString());
}
