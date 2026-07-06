import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { upsertWhatsAppCloudConnection } from "@/lib/server/whatsapp-cloud-connections";

export const dynamic = "force-dynamic";

const GRAPH = "https://graph.facebook.com/v24.0";

type TokenResponse = { access_token?: string; error?: { message: string } };
type LongLivedTokenResponse = { access_token?: string; error?: { message: string } };
type PhoneNumberResponse = {
  display_phone_number?: string;
  verified_name?: string;
  error?: { message: string };
};

/**
 * Exchanges a code from the FB JS SDK (Embedded Signup popup) for a long-lived
 * token and saves the WhatsApp Cloud connection for the authenticated tenant.
 *
 * Unlike the redirect-based callback, this endpoint receives waba_id and
 * phone_number_id directly from the WhatsAppOnboardingSuccess SDK event, so it
 * never needs to query /me/whatsapp_business_accounts.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

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
      console.error("[exchange-code] token exchange failed", tokenData.error?.message);
      return NextResponse.json({ error: "Token exchange failed" }, { status: 400 });
    }
    shortLivedToken = tokenData.access_token;
  } catch (err) {
    console.error("[exchange-code] token exchange request failed", err instanceof Error ? err.message : String(err));
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
    const llData = (await llRes.json()) as LongLivedTokenResponse;
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
    console.info("[exchange-code] phone details", { phone_number_id, displayPhone, verifiedName, apiError: phoneData.error?.message ?? null });
  } catch (err) {
    console.warn("[exchange-code] could not fetch phone details", err instanceof Error ? err.message : String(err));
  }

  // 4. Save to DB
  const { error: dbErr } = await upsertWhatsAppCloudConnection({
    tenantId: session.tenantId,
    phoneNumberId: phone_number_id,
    wabaId: waba_id,
    accessToken,
    displayPhone,
    verifiedName,
  });

  if (dbErr) {
    console.error("[exchange-code] db save failed", dbErr);
    return NextResponse.json({ error: "Failed to save connection" }, { status: 500 });
  }

  // 5. Subscribe our app to the customer's WABA so Meta delivers their inbound
  // webhooks to us (required per the Tech Provider onboarding guide).
  let webhookSubscribed = false;
  try {
    const subRes = await fetch(`${GRAPH}/${encodeURIComponent(waba_id)}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    const subData = (await subRes.json()) as { success?: boolean; error?: { message?: string } };
    webhookSubscribed = subData.success === true;
    console.info("[exchange-code] subscribed_apps", {
      waba_id,
      ok: webhookSubscribed,
      apiError: subData.error?.message ?? null,
    });
  } catch (err) {
    console.warn("[exchange-code] subscribed_apps failed", err instanceof Error ? err.message : String(err));
  }

  // 6. Register the number for Cloud API sending. The 6-digit two-step PIN is
  // derived deterministically from the app secret + phone_number_id so future
  // re-registrations always use the same PIN without storing it.
  let phoneRegistered = false;
  try {
    const digest = createHmac("sha256", appSecret).update(phone_number_id).digest();
    const pin = String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
    const regRes = await fetch(`${GRAPH}/${encodeURIComponent(phone_number_id)}/register`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", pin }),
      signal: AbortSignal.timeout(10_000),
    });
    const regData = (await regRes.json()) as { success?: boolean; error?: { message?: string } };
    const alreadyRegistered = /already/i.test(regData.error?.message ?? "");
    phoneRegistered = regData.success === true || alreadyRegistered;
    console.info("[exchange-code] register", {
      phone_number_id,
      ok: phoneRegistered,
      apiError: regData.error?.message ?? null,
    });
  } catch (err) {
    console.warn("[exchange-code] register failed", err instanceof Error ? err.message : String(err));
  }

  console.info("[exchange-code] connected", {
    tenantId: session.tenantId,
    phone_number_id,
    waba_id,
    webhookSubscribed,
    phoneRegistered,
  });
  return NextResponse.json({
    connected: true,
    phone_number_id,
    display_phone: displayPhone,
    verified_name: verifiedName,
    webhook_subscribed: webhookSubscribed,
    phone_registered: phoneRegistered,
  });
}
