import "server-only";
import { createHmac } from "node:crypto";

const GRAPH = "https://graph.facebook.com/v24.0";

/**
 * Passos server-side obrigatórios do onboarding Cloud API (guia Tech Provider
 * da Meta), compartilhados entre o fluxo do cliente e o do admin:
 *  - subscribed_apps: inscreve nosso app nos webhooks do WABA (sem isso não
 *    chegam mensagens recebidas nem confirmações de entrega);
 *  - register: registra o número para envio via Cloud API, com PIN de 6
 *    dígitos determinístico (HMAC do app secret + phone_number_id) para que
 *    re-registros usem sempre o mesmo PIN sem precisar armazená-lo.
 */

export function deriveWhatsAppRegisterPin(appSecret: string, phoneNumberId: string): string {
  const digest = createHmac("sha256", appSecret).update(phoneNumberId).digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

export async function subscribeAppToWaba(params: {
  wabaId: string;
  accessToken: string;
  logPrefix: string;
}): Promise<boolean> {
  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(params.wabaId)}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${params.accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as { success?: boolean; error?: { message?: string } };
    const ok = data.success === true;
    console.info(`[${params.logPrefix}] subscribed_apps`, {
      waba_id: params.wabaId,
      ok,
      apiError: data.error?.message ?? null,
    });
    return ok;
  } catch (err) {
    console.warn(`[${params.logPrefix}] subscribed_apps failed`, err instanceof Error ? err.message : String(err));
    return false;
  }
}

export async function registerWhatsAppCloudNumber(params: {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  logPrefix: string;
}): Promise<boolean> {
  try {
    const pin = deriveWhatsAppRegisterPin(params.appSecret, params.phoneNumberId);
    const res = await fetch(`${GRAPH}/${encodeURIComponent(params.phoneNumberId)}/register`, {
      method: "POST",
      headers: { Authorization: `Bearer ${params.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", pin }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as { success?: boolean; error?: { message?: string } };
    const alreadyRegistered = /already/i.test(data.error?.message ?? "");
    const ok = data.success === true || alreadyRegistered;
    console.info(`[${params.logPrefix}] register`, {
      phone_number_id: params.phoneNumberId,
      ok,
      apiError: data.error?.message ?? null,
    });
    return ok;
  } catch (err) {
    console.warn(`[${params.logPrefix}] register failed`, err instanceof Error ? err.message : String(err));
    return false;
  }
}
