import "server-only";
import { checkWhatsAppCloudConnectionHealth } from "@/lib/integrations/whatsapp-cloud";
import { registerWhatsAppCloudNumber, subscribeAppToWaba } from "@/lib/server/whatsapp-cloud-onboarding";

const GRAPH = "https://graph.facebook.com/v24.0";

type TokenResponse = { access_token?: string; error?: { message?: string } };

export type LabMetaCredentials = {
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  displayPhone: string;
  verifiedName: string | null;
  webhookSubscribed: boolean;
  phoneRegistered: boolean;
};

function exactId(value: unknown, code: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^[0-9]{5,40}$/.test(text)) throw new Error(code);
  return text;
}

/** Exchanges an Embedded Signup code without exposing the resulting token. */
export async function exchangeLabMetaCode(input: {
  code: unknown;
  wabaId: unknown;
  phoneNumberId: unknown;
  purpose: "sender" | "receiver";
}): Promise<LabMetaCredentials> {
  const code = typeof input.code === "string" ? input.code.trim() : "";
  if (!code || code.length > 4096) throw new Error("meta_signup_code_invalid");
  const wabaId = exactId(input.wabaId, "meta_waba_invalid");
  const phoneNumberId = exactId(input.phoneNumberId, "meta_phone_id_invalid");
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) throw new Error("meta_server_not_configured");

  const tokenUrl = new URL(`${GRAPH}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("code", code);
  const tokenRes = await fetch(tokenUrl, { signal: AbortSignal.timeout(10_000) });
  const tokenData = (await tokenRes.json().catch(() => ({}))) as TokenResponse;
  if (!tokenRes.ok || !tokenData.access_token) throw new Error("meta_token_exchange_failed");

  const longUrl = new URL(`${GRAPH}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", appId);
  longUrl.searchParams.set("client_secret", appSecret);
  longUrl.searchParams.set("fb_exchange_token", tokenData.access_token);
  const longRes = await fetch(longUrl, { signal: AbortSignal.timeout(10_000) });
  const longData = (await longRes.json().catch(() => ({}))) as TokenResponse;
  if (!longRes.ok || !longData.access_token) throw new Error("meta_long_lived_token_required");
  const accessToken = longData.access_token;

  const health = await checkWhatsAppCloudConnectionHealth({ phoneNumberId, accessToken });
  if (!health.ok || !health.displayPhoneNumber) throw new Error("meta_number_verification_failed");
  const webhookSubscribed = await subscribeAppToWaba({
    wabaId,
    accessToken,
    logPrefix: `agent-test-lab/${input.purpose}`,
  });
  const phoneRegistered = await registerWhatsAppCloudNumber({
    phoneNumberId,
    accessToken,
    appSecret,
    logPrefix: `agent-test-lab/${input.purpose}`,
  });
  if (!webhookSubscribed || !phoneRegistered) throw new Error("meta_onboarding_incomplete");

  return {
    phoneNumberId,
    wabaId,
    accessToken,
    displayPhone: health.displayPhoneNumber,
    verifiedName: health.verifiedName,
    webhookSubscribed,
    phoneRegistered,
  };
}
