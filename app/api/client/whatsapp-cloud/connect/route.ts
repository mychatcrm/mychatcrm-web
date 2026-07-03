import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { signMetaOAuthState } from "@/lib/server/meta-oauth-state";
import { SITE_URL } from "@/lib/constants";

export const dynamic = "force-dynamic";

const WA_EXTRAS = JSON.stringify({
  version: "v4",
  sessionInfoVersion: "3",
  featureType: "whatsapp_business_app_onboarding",
});

/** Redirects the authenticated tenant to the Meta Embedded Signup for WhatsApp Business. */
export async function GET(): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const appId = process.env.META_APP_ID?.trim();
  const configId = process.env.META_WA_CONFIG_ID?.trim() ?? "1020220517466691";

  if (!appId) {
    return NextResponse.json({ error: "META_APP_ID not configured on server." }, { status: 503 });
  }

  const state = await signMetaOAuthState({
    tenantId: session.tenantId,
    ...(session.employeeId ? { employeeId: session.employeeId } : {}),
    employeeEmail: session.email,
    flow: "whatsapp",
  });

  if (!state) {
    return NextResponse.json(
      { error: "Cannot start WhatsApp OAuth — configure META_APP_SECRET, JWT_SECRET or CLIENT_SESSION_COOKIE_SECRET." },
      { status: 503 },
    );
  }

  const siteUrl = SITE_URL.replace(/\/$/, "");
  const redirectUri = `${siteUrl}/api/meta/callback`;

  const signupUrl = new URL("https://business.facebook.com/messaging/whatsapp/onboard/");
  signupUrl.searchParams.set("app_id", appId);
  signupUrl.searchParams.set("config_id", configId);
  signupUrl.searchParams.set("extras", WA_EXTRAS);
  signupUrl.searchParams.set("redirect_uri", redirectUri);
  signupUrl.searchParams.set("state", state);

  return NextResponse.redirect(signupUrl.toString());
}
