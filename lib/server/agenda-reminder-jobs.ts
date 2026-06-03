import "server-only";

import { evolutionSendText, remoteJidToEvoNumber } from "@/lib/integrations/evolution-api";
import { getAgendaEventById } from "@/lib/server/google-calendar-db";
import { getEvolutionInstanceByTenantId } from "@/lib/server/tenant-evolution-instance-db";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { AgentAgendaLembretes } from "@/lib/types";
import { parseTimezone } from "@/lib/agents/agent-datetime";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

function offsetToMinutes(regra: { offsetValor: number; offsetUnidade: string }): number {
  const valor = Math.max(1, Math.floor(regra.offsetValor));
  if (regra.offsetUnidade === "dias") return valor * 24 * 60;
  if (regra.offsetUnidade === "horas") return valor * 60;
  return valor;
}

function formatEventLocal(iso: string, timezone: string): { data: string; hora: string } {
  const tz = parseTimezone(timezone);
  const date = new Date(iso);
  const data = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
  const hora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return { data, hora };
}

function renderReminderMessage(
  template: string | undefined,
  event: {
    title: string;
    start_at: string;
    location: string | null;
    attendee_name: string | null;
  },
  timezone: string,
): string {
  const { data, hora } = formatEventLocal(event.start_at, timezone);
  const base =
    template?.trim() ||
    "Olá {nome}! Lembrete: você tem o compromisso \"{titulo}\" em {data} às {hora}.{local}";
  const localSuffix = event.location?.trim() ? ` Local: ${event.location.trim()}.` : "";
  const nome = event.attendee_name?.trim() || "tudo bem";
  return base
    .replace(/\{nome\}/g, nome)
    .replace(/\{titulo\}/g, event.title)
    .replace(/\{data\}/g, data)
    .replace(/\{hora\}/g, hora)
    .replace(/\{local\}/g, localSuffix);
}

export async function cancelAgendaRemindersForEvent(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  agendaEventId: string;
}): Promise<void> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const now = new Date().toISOString();
  await sb
    .from("agenda_reminder_jobs")
    .update({ status: "cancelled", updated_at: now })
    .eq("tenant_id", params.tenantId)
    .eq("agenda_event_id", params.agendaEventId)
    .eq("status", "pending");
}

export async function scheduleAgendaRemindersForEvent(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  remoteJid: string;
  leadId: string | null;
  agendaEventId: string;
  agendaLembretes: AgentAgendaLembretes | null | undefined;
  timezone: string;
  cancelPreviousEventId?: string | null;
}): Promise<number> {
  const config = params.agendaLembretes;
  if (!config?.ativo || !Array.isArray(config.regras) || config.regras.length === 0) {
    return 0;
  }

  const sb = params.sb ?? createSupabaseServiceClient();
  if (params.cancelPreviousEventId) {
    await cancelAgendaRemindersForEvent({
      sb,
      tenantId: params.tenantId,
      agendaEventId: params.cancelPreviousEventId,
    });
  }

  const event = await getAgendaEventById(params.tenantId, params.agendaEventId);
  if (!event || event.status === "cancelled") return 0;

  const startMs = new Date(event.start_at).getTime();
  const nowMs = Date.now();
  let inserted = 0;

  for (const regra of config.regras.slice(0, 3)) {
    const offsetMinutes = offsetToMinutes(regra);
    const scheduledAt = new Date(startMs - offsetMinutes * 60_000);
    if (scheduledAt.getTime() <= nowMs) continue;

    const message = renderReminderMessage(regra.mensagem, event, params.timezone);
    const { error } = await sb.from("agenda_reminder_jobs").insert({
      tenant_id: params.tenantId,
      agent_id: params.agentId,
      agenda_event_id: params.agendaEventId,
      remote_jid: params.remoteJid,
      lead_id: params.leadId,
      scheduled_at: scheduledAt.toISOString(),
      message,
      status: "pending",
      offset_minutes: offsetMinutes,
    });
    if (!error) inserted += 1;
  }

  return inserted;
}

export async function processDueAgendaReminderJobs(sb?: SupabaseServiceClient): Promise<{
  processed: number;
  sent: number;
  failed: number;
  cancelled: number;
}> {
  const client = sb ?? createSupabaseServiceClient();
  const nowIso = new Date().toISOString();
  const { data } = await client
    .from("agenda_reminder_jobs")
    .select("id, tenant_id, remote_jid, message, agenda_event_id")
    .eq("status", "pending")
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(30);

  let processed = 0;
  let sent = 0;
  let failed = 0;
  let cancelled = 0;

  for (const row of data ?? []) {
    const job = row as {
      id: string;
      tenant_id: string;
      remote_jid: string;
      message: string;
      agenda_event_id: string;
    };
    processed += 1;

    const event = await getAgendaEventById(job.tenant_id, job.agenda_event_id);
    if (!event || event.status === "cancelled") {
      await client
        .from("agenda_reminder_jobs")
        .update({ status: "cancelled", updated_at: nowIso })
        .eq("id", job.id);
      cancelled += 1;
      continue;
    }

    const instance = await getEvolutionInstanceByTenantId(job.tenant_id);
    const number = remoteJidToEvoNumber(job.remote_jid);
    if (!instance?.instance_name || !number) {
      await client
        .from("agenda_reminder_jobs")
        .update({ status: "failed", updated_at: nowIso })
        .eq("id", job.id);
      failed += 1;
      continue;
    }

    const delivery = await evolutionSendText({
      instanceName: instance.instance_name,
      number,
      text: job.message.slice(0, 4000),
    });

    if (delivery.ok) {
      await client
        .from("agenda_reminder_jobs")
        .update({ status: "sent", updated_at: nowIso })
        .eq("id", job.id);
      await client.from("whatsapp_messages").insert({
        tenant_id: job.tenant_id,
        remote_jid: job.remote_jid,
        direction: "outbound",
        kind: "text",
        content: job.message.slice(0, 4000),
      });
      sent += 1;
    } else {
      await client
        .from("agenda_reminder_jobs")
        .update({ status: "failed", updated_at: nowIso })
        .eq("id", job.id);
      failed += 1;
    }
  }

  return { processed, sent, failed, cancelled };
}
