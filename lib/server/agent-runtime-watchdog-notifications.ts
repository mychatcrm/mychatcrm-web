import "server-only";

import { OPERATIONAL_AUDIT_OWNER_ADMIN_ID } from "@/lib/admin-operational-audit-access";
import { getAdminSessionByIdFromDb } from "@/lib/server/admin-auth-db";
import { sendTransactionalEmail } from "@/lib/server/resend-mail";

export type WatchdogNotificationKind = "failure" | "repeat" | "recovery";
export type WatchdogMode = "live" | "test_failure" | "test_repeat" | "test_recovery";

export function boundedWatchdogReasonCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return ["runtime_unhealthy"];
  const codes = value
    .filter((item): item is string => typeof item === "string" && /^[a-z0-9_:-]{1,80}$/i.test(item))
    .slice(0, 10);
  return codes.length ? codes : ["runtime_unhealthy"];
}

function notificationCopy(kind: WatchdogNotificationKind, mode: WatchdogMode, reasons: string[]) {
  const testPrefix = mode.startsWith("test_") ? "[TESTE SEGURO — NÃO É INCIDENTE REAL] " : "";
  if (kind === "recovery") {
    return {
      subject: `${testPrefix}MyChatCRM — runtime dos agentes normalizado`,
      text: `${testPrefix}O monitor confirmou a recuperação do runtime dos agentes.`,
    };
  }
  const prefix = kind === "repeat" ? "Falha ainda ativa" : "Falha crítica detectada";
  return {
    subject: `${testPrefix}MyChatCRM — ${prefix} no runtime dos agentes`,
    text: `${testPrefix}${prefix}. Códigos técnicos: ${reasons.join(", ")}. Verifique filas, crons e provedores imediatamente.`,
  };
}

export async function sendWatchdogEmailNotification(params: {
  kind: WatchdogNotificationKind;
  mode: WatchdogMode;
  reasons: string[];
}): Promise<{ ok: boolean; code: string; detail?: string | null }> {
  const owner = await getAdminSessionByIdFromDb(OPERATIONAL_AUDIT_OWNER_ADMIN_ID);
  if (!owner?.email) return { ok: false, code: "owner_email_missing" };

  const copy = notificationCopy(params.kind, params.mode, params.reasons);
  const sent = await sendTransactionalEmail({
    to: owner.email,
    subject: copy.subject,
    text: copy.text,
    html: `<p>${copy.text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</p>`,
  });
  return sent.ok
    ? { ok: true, code: "email_sent" }
    : {
        ok: false,
        code: sent.code,
        detail: "detail" in sent ? sent.detail ?? null : null,
      };
}
