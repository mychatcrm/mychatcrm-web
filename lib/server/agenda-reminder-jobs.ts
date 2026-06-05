import "server-only";

import { parseTimezone } from "@/lib/agents/agent-datetime";
import { evolutionSendText, remoteJidToEvoNumber } from "@/lib/integrations/evolution-api";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getEvolutionInstanceByTenantSlot } from "@/lib/server/tenant-evolution-instance-db";
import type { AgentAgendaLembretes } from "@/lib/types";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

// ─── helpers ──────────────────────────────────────────────────────────────────

function offsetToMs(valor: number, unidade: "minutos" | "horas" | "dias"): number {
  if (unidade === "minutos") return valor * 60_000;
  if (unidade === "horas") return valor * 3_600_000;
  return valor * 86_400_000; // dias
}

function renderTemplate(
  template: string,
  vars: { nome: string; data: string; hora: string; local: string; titulo: string },
): string {
  return template
    .replace(/\{nome\}/g, vars.nome)
    .replace(/\{data\}/g, vars.data)
    .replace(/\{hora\}/g, vars.hora)
    .replace(/\{local\}/g, vars.local)
    .replace(/\{titulo\}/g, vars.titulo);
}

function formatEventDateTime(
  date: Date,
  timezone: string,
): { data: string; hora: string } {
  const tz = parseTimezone(timezone);
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const data = `${get("day")}/${get("month")}/${get("year")}`;
  const hora = `${get("hour")}:${get("minute")}`;
  return { data, hora };
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Agenda jobs de lembrete para um evento recém-criado.
 * Chamado logo após inserir um agendamento em `insertStructuredAgendaEvent`.
 */
export async function scheduleAgendaRemindersForEvent(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  agentId: string | null;
  slotIndex: number;
  remoteJid: string;
  agendaEventId: string;
  eventStartAt: Date;
  attendeeName: string | null;
  location: string | null;
  eventTitle: string;
  agendaLembretes: AgentAgendaLembretes;
  timezone: string;
}): Promise<void> {
  if (!params.agendaLembretes.ativo || params.agendaLembretes.regras.length === 0) return;

  const sb = params.sb ?? createSupabaseServiceClient();
  const { data: str, hora } = formatEventDateTime(params.eventStartAt, params.timezone);
  const nome = params.attendeeName?.trim() || "cliente";
  const local = params.location?.trim() || "não informado";

  const rows = params.agendaLembretes.regras
    .slice(0, 3)
    .map((regra) => {
      const scheduledAt = new Date(params.eventStartAt.getTime() - offsetToMs(regra.offsetValor, regra.offsetUnidade));
      if (scheduledAt.getTime() <= Date.now()) return null; // lembrete já passou
      const template =
        regra.mensagem?.trim() ||
        "Olá {nome}, lembrete do seu agendamento em {data} às {hora}. Local: {local}.";
      const message = renderTemplate(template, {
        nome,
        data: str,
        hora,
        local,
        titulo: params.eventTitle,
      });
      return {
        tenant_id: params.tenantId,
        agent_id: params.agentId ?? null,
        slot_index: params.slotIndex,
        remote_jid: params.remoteJid,
        agenda_event_id: params.agendaEventId,
        scheduled_at: scheduledAt.toISOString(),
        message,
        status: "pending" as const,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return;

  const { error } = await sb.from("agenda_reminder_jobs").insert(rows);
  if (error) {
    console.warn("[agenda-reminder-jobs] schedule_failed", {
      tenant_id: params.tenantId,
      event_id: params.agendaEventId,
      error: error.message,
    });
  }
}

/**
 * Cancela todos os jobs de lembrete associados a um evento.
 * Chamado quando o agendamento é cancelado ou remarcado.
 */
export async function cancelAgendaRemindersForEvent(params: {
  sb?: SupabaseServiceClient;
  agendaEventId: string;
}): Promise<void> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const { error } = await sb
    .from("agenda_reminder_jobs")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("agenda_event_id", params.agendaEventId)
    .eq("status", "pending");
  if (error) {
    console.warn("[agenda-reminder-jobs] cancel_failed", {
      event_id: params.agendaEventId,
      error: error.message,
    });
  }
}

/**
 * Processa todos os jobs de lembrete com `scheduled_at <= now()`.
 * Chamado pelo cron `/api/internal/process-agenda-reminders`.
 */
export async function processDueAgendaReminderJobs(params: {
  sb?: SupabaseServiceClient;
  batchSize?: number;
}): Promise<{ processed: number; failed: number }> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const batchSize = params.batchSize ?? 50;
  const now = new Date().toISOString();

  const { data: jobs, error: fetchError } = await sb
    .from("agenda_reminder_jobs")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(batchSize);

  if (fetchError) {
    console.warn("[agenda-reminder-jobs] fetch_due_failed", { error: fetchError.message });
    return { processed: 0, failed: 0 };
  }

  if (!jobs || jobs.length === 0) return { processed: 0, failed: 0 };

  let processed = 0;
  let failed = 0;

  for (const job of jobs as {
    id: string;
    tenant_id: string;
    slot_index: number;
    remote_jid: string;
    message: string;
  }[]) {
    try {
      const instance = await getEvolutionInstanceByTenantSlot(job.tenant_id, job.slot_index ?? 0);
      if (!instance?.instance_name) {
        await sb
          .from("agenda_reminder_jobs")
          .update({ status: "failed", last_error: "no_evolution_instance", updated_at: new Date().toISOString() })
          .eq("id", job.id);
        failed++;
        continue;
      }
      const number = remoteJidToEvoNumber(job.remote_jid);
      if (!number) {
        await sb
          .from("agenda_reminder_jobs")
          .update({ status: "failed", last_error: "invalid_remote_jid", updated_at: new Date().toISOString() })
          .eq("id", job.id);
        failed++;
        continue;
      }
      const send = await evolutionSendText({
        instanceName: instance.instance_name,
        number,
        text: job.message.slice(0, 4000),
      });
      if (send.ok) {
        await sb
          .from("agenda_reminder_jobs")
          .update({ status: "sent", updated_at: new Date().toISOString() })
          .eq("id", job.id);
        processed++;
      } else {
        await sb
          .from("agenda_reminder_jobs")
          .update({ status: "failed", last_error: send.error ?? "send_failed", updated_at: new Date().toISOString() })
          .eq("id", job.id);
        failed++;
      }
    } catch (err) {
      try {
        await sb
          .from("agenda_reminder_jobs")
          .update({
            status: "failed",
            last_error: err instanceof Error ? err.message : String(err),
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);
      } catch {
        // silent: don't break the batch loop
      }
      failed++;
    }
  }

  console.info("[agenda-reminder-jobs] batch_complete", { processed, failed, total: jobs.length });
  return { processed, failed };
}
