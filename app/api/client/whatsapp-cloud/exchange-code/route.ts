import { NextRequest, NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { notifyTenantIntegrationConnected } from "@/lib/server/integration-disconnect-notifications";
import {
  lookupWhatsAppCloudConnectionByPhoneNumberId,
  upsertWhatsAppCloudConnection,
} from "@/lib/server/whatsapp-cloud-connections";
import { registerWhatsAppCloudNumber, subscribeAppToWaba } from "@/lib/server/whatsapp-cloud-onboarding";
import { assertSlotIndexAllowed } from "@/lib/server/whatsapp-slot-server";
import { getExtraWhatsappSlots } from "@/lib/server/whatsapp-extra-slots-db";

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

  const body = (await req.json()) as { code?: string; waba_id?: string; phone_number_id?: string; slotIndex?: number };
  const { code, waba_id, phone_number_id } = body;

  if (!code || !waba_id || !phone_number_id) {
    return NextResponse.json({ error: "Missing code, waba_id or phone_number_id" }, { status: 400 });
  }

  const slotIndex = typeof body.slotIndex === "number" ? body.slotIndex : Number(body.slotIndex ?? 0);
  const extraWhatsappSlots = await getExtraWhatsappSlots(session.tenantId);
  if (!Number.isInteger(slotIndex) || !assertSlotIndexAllowed(session, slotIndex, extraWhatsappSlots)) {
    return NextResponse.json({ error: "slotIndex inválido" }, { status: 400 });
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
  let tokenDurability: "long_lived" | "short_lived_fallback" = "short_lived_fallback";
  try {
    const llRes = await fetch(llUrl.toString(), { signal: AbortSignal.timeout(10_000) });
    const llData = (await llRes.json()) as LongLivedTokenResponse;
    if (llData.access_token) {
      accessToken = llData.access_token;
      tokenDurability = "long_lived";
    } else {
      // Sem isto o token curto (validade de ~1-2h) ficava salvo em silêncio,
      // e o próximo envio dias depois falhava com "token inválido" sem pista
      // nenhuma de que a causa era esta troca aqui, não uma revogação.
      console.error("[exchange-code] long-lived token exchange failed", {
        phone_number_id,
        error: llData.error?.message ?? "no_access_token_in_response",
      });
    }
  } catch (err) {
    console.error(
      "[exchange-code] long-lived token exchange request failed",
      err instanceof Error ? err.message : String(err),
    );
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
  // Checked before the upsert (whose conflict key is phone_number_id alone,
  // not tenant-scoped) so we know whether this is a genuinely new connection
  // for this tenant, vs. a token-refresh reauth of an already-connected number.
  const existingConnection = await lookupWhatsAppCloudConnectionByPhoneNumberId(phone_number_id);
  const isNewConnection = !existingConnection || existingConnection.tenant_id !== session.tenantId;

  const { error: dbErr } = await upsertWhatsAppCloudConnection({
    tenantId: session.tenantId,
    slotIndex,
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

  if (isNewConnection) {
    try {
      await notifyTenantIntegrationConnected({
        tenantId: session.tenantId,
        integration: "whatsapp",
        source: "whatsapp_cloud_exchange_code",
        sourceKey: phone_number_id,
        phoneDisplay: displayPhone,
        metadata: { phone_number_id, waba_id, verified_name: verifiedName },
      });
    } catch (notifyError) {
      console.warn("[exchange-code] connect notification failed", notifyError);
    }
  }

  // 5. Subscribe our app to the customer's WABA so Meta delivers their inbound
  // webhooks to us, then register the number for Cloud API sending (required
  // per the Tech Provider onboarding guide). Shared helpers with the admin flow.
  const webhookSubscribed = await subscribeAppToWaba({
    wabaId: waba_id,
    accessToken,
    logPrefix: "exchange-code",
  });

  const phoneRegistered = await registerWhatsAppCloudNumber({
    phoneNumberId: phone_number_id,
    accessToken,
    appSecret,
    logPrefix: "exchange-code",
  });

  console.info("[exchange-code] connected", {
    tenantId: session.tenantId,
    phone_number_id,
    waba_id,
    webhookSubscribed,
    phoneRegistered,
    tokenDurability,
  });
  return NextResponse.json({
    connected: true,
    phone_number_id,
    display_phone: displayPhone,
    verified_name: verifiedName,
    webhook_subscribed: webhookSubscribed,
    phone_registered: phoneRegistered,
    token_durability: tokenDurability,
  });
}
