import "server-only";
import { OPERATIONAL_AUDIT_OWNER_ADMIN_ID, isOperationalAuditOwnerIdentity } from "@/lib/admin-operational-audit-access";
import { getAdminSessionByIdFromDb } from "@/lib/server/admin-auth-db";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getResendApiKey } from "@/lib/server/resend-config";
import { agentProtectionDescription, safeProtectionCode } from "@/lib/agent-protection";

type NotificationRow = { id: string; claim_token: string; reason_code: string };

/** Only fixed operator copy leaves the system. Identifiers/details stay in /admin. */
export function protectionNotificationText(reasonCode: string): string {
  if (reasonCode === "protection_delivery_test") return "[TESTE SEGURO DO MYCHATCRM] Este aviso confirma o caminho de entrega das notificações de proteção. Nenhum lead foi bloqueado ou contatado e nenhum agendamento foi alterado. Consulte https://www.mychatcrm.com.br/admin/logs";
  const description = agentProtectionDescription(safeProtectionCode(reasonCode));
  return ["MyChatCRM — proteção acionada",
    description.expected ? "Tipo: proteção esperada." : "Tipo: conferir configuração ou investigar.",
    description.explanation, description.nextStep,
    "Detalhes restritos ao proprietário: https://www.mychatcrm.com.br/admin/logs",
    "Este aviso não libera nem altera a automação e não significa necessariamente defeito.",
  ].join("\n");
}

/** Uses the existing watchdog; no new cron or customer-facing message. */
export async function processAgentProtectionNotifications(): Promise<{ sent: number; retry: number; code: string }> {
  const sb = createSupabaseServiceClient({ noStore: true });
  const { data, error } = await sb.rpc("claim_agent_protection_notifications_v1", { p_limit: 4 });
  if (error) return { sent: 0, retry: 0, code: "protection_queue_read_failed" };
  const rows = (data ?? []) as NotificationRow[];
  if (!rows.length) return { sent: 0, retry: 0, code: "protection_queue_idle" };
  const owner = await getAdminSessionByIdFromDb(OPERATIONAL_AUDIT_OWNER_ADMIN_ID).catch(() => null);
  const recipient = owner && isOperationalAuditOwnerIdentity(owner) ? owner.email : null;
  const key = getResendApiKey();
  const results = await Promise.all(rows.map(async (row) => {
    let ok = false;
    let code = !recipient ? "owner_destination_missing" : !key ? "notification_provider_not_configured" : "notification_request_failed";
    if (recipient && key) {
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST", signal: AbortSignal.timeout(8000),
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `agent-protection/${row.id}` },
          body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL?.trim() || "MyChatCRM <onboarding@resend.dev>",
            to: [recipient], subject: row.reason_code === "protection_delivery_test" ? "[TESTE SEGURO] MyChatCRM — avisos de proteção" : "MyChatCRM — uma proteção do agente foi acionada",
            text: protectionNotificationText(row.reason_code),
          }),
        });
        ok = response.ok;
        code = ok ? "notification_provider_accepted" : `notification_http_${response.status}`;
        await response.body?.cancel();
      } catch { code = "notification_request_failed"; }
    }
    const result = await sb.rpc("finish_agent_protection_notification_v1", {
      p_id: row.id, p_claim: row.claim_token, p_ok: ok, p_code: code,
    });
    return { ok: ok && !result.error && result.data === true };
  }));
  const sent = results.filter(r => r.ok).length;
  return { sent, retry: rows.length - sent, code: sent === rows.length ? "protection_notifications_processed" : "protection_notifications_retry" };
}
