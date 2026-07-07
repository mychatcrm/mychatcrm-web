import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { saveSystemAgentMetaConfig } from "@/lib/server/system-agent";
import { registerWhatsAppCloudNumber, subscribeAppToWaba } from "@/lib/server/whatsapp-cloud-onboarding";

export const dynamic = "force-dynamic";

const GRAPH = "https://graph.facebook.com/v24.0";

type TokenResponse = { access_token?: string; error?: { message: string } };
type PhoneNumberResponse = {
  display_phone_number?: string;
  verified_name?: string;
  error?: { message: string };
};

/**
 * Exchanges a code from the FB JS SDK (Embedded Signup popup) for a long-lived
 * token and saves the connection as the system agent's Meta config. Mirrors
 * app/api/client/whatsapp-cloud/exchange-code/route.ts but persists via
 * saveSystemAgentMetaConfig instead of the per-tenant whatsapp_cloud_connections table.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getAdminSessionFromCookies();
  if (!session || !hasAdminAccess(session, "system-agent")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { code?: string; waba_id?: string; phone_number_id?: string };
  const { code, waba_id, phone_number_id } = body;

  if (!code || !waba_id || !phone_number_id) {
    return NextResponse.json({ error: "Missing code, waba_id or phone_number_id" }, { status: 400 });
  }

  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();

  if (!appId || !appSecret) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 503 });
  }

  // 1. Exchange JS SDK code → short-lived token (no redirect_uri for JS SDK codes)
  const tokenUrl = new URL(`${GRAPH}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("code", code);

  let shortLivedToken: string;
  try {
    const tokenRes = await fetch(tokenUrl.toString(), { signal: AbortSignal.timeout(10_000) });
    const tokenData = (await tokenRes.json()) as TokenResponse;
    if (!tokenData.access_token) {
      console.error("[admin/exchange-code] token exchange failed", tokenData.error?.message);
      return NextResponse.json({ error: "Token exchange failed" }, { status: 400 });
    }
    shortLivedToken = tokenData.access_token;
  } catch (err) {
    console.error("[admin/exchange-code] token exchange request failed", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Network error" }, { status: 500 });
  }

  // 2. Exchange → long-lived token
  const llUrl = new URL(`${GRAPH}/oauth/access_token`);
  llUrl.searchParams.set("grant_type", "fb_exchange_token");
  llUrl.searchParams.set("client_id", appId);
  llUrl.searchParams.set("client_secret", appSecret);
  llUrl.searchParams.set("fb_exchange_token", shortLivedToken);

  let accessToken = shortLivedToken;
  try {
    const llRes = await fetch(llUrl.toString(), { signal: AbortSignal.timeout(10_000) });
    const llData = (await llRes.json()) as TokenResponse;
    accessToken = llData.access_token ?? shortLivedToken;
  } catch {
    // Fall back to short-lived token
  }

  // 3. Fetch phone number display details (optional — don't fail if this errors)
  let displayPhone: string | null = null;
  let verifiedName: string | null = null;
  try {
    const phoneUrl = `${GRAPH}/${encodeURIComponent(phone_number_id)}?fields=display_phone_number,verified_name&access_token=${encodeURIComponent(accessToken)}`;
    const phoneRes = await fetch(phoneUrl, { signal: AbortSignal.timeout(10_000) });
    const phoneData = (await phoneRes.json()) as PhoneNumberResponse;
    displayPhone = phoneData.display_phone_number ?? null;
    verifiedName = phoneData.verified_name ?? null;
  } catch (err) {
    console.warn("[admin/exchange-code] could not fetch phone details", err instanceof Error ? err.message : String(err));
  }

  // 4. Subscribe our app to this WABA's webhooks
  const webhookSubscribed = await subscribeAppToWaba({
    wabaId: waba_id,
    accessToken,
    logPrefix: "admin/exchange-code",
  });

  // 5. Register the number for Cloud API sending (deterministic PIN shared with the client route)
  const phoneRegistered = await registerWhatsAppCloudNumber({
    phoneNumberId: phone_number_id,
    accessToken,
    appSecret,
    logPrefix: "admin/exchange-code",
  });

  // 6. Save as the system agent's Meta config (including onboarding health flags)
  await saveSystemAgentMetaConfig({
    phoneNumberId: phone_number_id,
    accessToken,
    displayPhone,
    verifiedName,
    wabaId: waba_id,
    webhookSubscribed,
    phoneRegistered,
  });

  console.info("[admin/exchange-code] connected", { phone_number_id, waba_id, webhookSubscribed, phoneRegistered });
  return NextResponse.json({
    connected: true,
    phone_number_id,
    display_phone: displayPhone,
    verified_name: verifiedName,
    webhook_subscribed: webhookSubscribed,
    phone_registered: phoneRegistered,
  });
}
