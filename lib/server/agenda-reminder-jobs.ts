import "server-only";

import { isValidIanaTimezone } from "@/lib/agents/agent-datetime";
import { evolutionSendText, remoteJidToEvoNumber } from "@/lib/integrations/evolution-api";
import { extractEvolutionSendReceipt } from "@/lib/integrations/evolution-message-receipt";
import { sendWhatsAppTextMessage } from "@/lib/integrations/whatsapp-cloud";
import { finalizeAgentOutboundDelivery, markAgentOutboundAmbiguous, markAgentOutboundFailed, prepareAutomatedOutbound } from "@/lib/server/agent-outbound-outbox";
import { getEvolutionInstanceByIdForTenant } from "@/lib/server/tenant-evolution-instance-db";
import { lookupWhatsAppCloudConnectionByPhoneNumberId } from "@/lib/server/whatsapp-cloud-connections";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { AgentAgendaLembretes } from "@/lib/types";
import { recordAgentRuntimeAlert } from "@/lib/server/agent-runtime-alerts";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;
type AgendaReminderJobV2 = {
  id: string; tenant_id: string; agent_id: string; agenda_event_id: string;
  remote_jid: string; lead_id: string | null; journey_id: string; rule_id: string;
  channel: "evolution" | "meta_cloud"; connection_id: string;
  automation_epoch: number; config_version: number; operation_key: string;
  rendered_message: string; attempts: number; max_attempts: number; claim_token: string;
};

function offsetToMs(value: number, unit: "minutos" | "horas" | "dias"): number {
  if (unit === "minutos") return value * 60_000;
  if (unit === "horas") return value * 3_600_000;
  return value * 86_400_000;
}

function renderTemplate(template: string, vars: Record<"nome" | "data" | "hora" | "local" | "titulo", string>): string {
  return template.replace(/\{nome\}/g, vars.nome).replace(/\{data\}/g, vars.data)
    .replace(/\{hora\}/g, vars.hora).replace(/\{local\}/g, vars.local)
    .replace(/\{titulo\}/g, vars.titulo).trim();
}

function formatEventDateTime(date: Date, timezone: string, languageTag?: string | null) {
  if (!isValidIanaTimezone(timezone)) throw new Error("agenda_reminder_timezone_invalid");
  const locale = languageTag?.trim() || "en";
  return {
    data: new Intl.DateTimeFormat(locale, { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date),
    hora: new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date),
  };
}

/** Creates V2 obligations only after a new/rescheduled event was committed. */
export async function scheduleAgendaRemindersForEvent(params: {
  sb?: SupabaseServiceClient; tenantId: string; agentId: string | null; remoteJid: string;
  agendaEventId: string; eventStartAt: Date; attendeeName: string | null;
  location: string | null; eventTitle: string; agendaLembretes: AgentAgendaLembretes;
  timezone: string; languageTag?: string | null; leadId?: string | null;
  journeyId?: string | null; ruleId?: string | null;
  channel?: "evolution" | "meta_cloud" | null; connectionId?: string | null;
  automationEpoch?: number | null;
  skipReminderIndexes?: number[];
}): Promise<void> {
  if (!params.agendaLembretes.ativo || params.agendaLembretes.regras.length === 0) return;
  if (!params.agentId || !params.journeyId || !params.ruleId || !params.channel || !params.connectionId || params.automationEpoch == null) {
    throw new Error("agenda_reminder_exact_identity_required");
  }
  const sb = params.sb ?? createSupabaseServiceClient();
  const { data: agentRow, error: agentError } = await sb.from("tenant_agents")
    .select("agenda_reminder_config_version,active,archived_at").eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId).maybeSingle();
  if (agentError || !agentRow || !agentRow.active || agentRow.archived_at) throw new Error("agenda_reminder_agent_inactive");
  const formatted = formatEventDateTime(params.eventStartAt, params.timezone, params.languageTag);
  const vars = { nome: params.attendeeName?.trim() || "", data: formatted.data, hora: formatted.hora,
    local: params.location?.trim() || "", titulo: params.eventTitle };
  await Promise.all(params.agendaLembretes.regras.slice(0, 3).map(async (rule, index) => {
    if (params.skipReminderIndexes?.includes(index)) return;
    const template = rule.mensagem?.trim();
    if (!template) return; // Content belongs exclusively to the operator.
    const scheduledAt = new Date(params.eventStartAt.getTime() - offsetToMs(rule.offsetValor, rule.offsetUnidade));
    if (scheduledAt.getTime() <= Date.now()) return;
    const rendered = renderTemplate(template, vars).slice(0, 4000);
    if (!rendered) return;
    const reminderConfigVersion = Number(agentRow.agenda_reminder_config_version);
    const operationKey = `agenda-reminder-v2:${params.agendaEventId}:${reminderConfigVersion}:${index}:${scheduledAt.toISOString()}`;
    const { error } = await sb.rpc("enqueue_agenda_reminder_v2", {
      p_tenant_id: params.tenantId, p_agent_id: params.agentId,
      p_agenda_event_id: params.agendaEventId, p_remote_jid: params.remoteJid,
      p_lead_id: params.leadId ?? null, p_journey_id: params.journeyId,
      p_rule_id: params.ruleId, p_channel: params.channel, p_connection_id: params.connectionId,
      p_automation_epoch: params.automationEpoch, p_config_version: reminderConfigVersion,
      p_reminder_index: index, p_operation_key: operationKey,
      p_scheduled_at: scheduledAt.toISOString(), p_rendered_message: rendered,
      p_timezone: params.timezone, p_max_attempts: 4,
    });
    if (error) throw new Error(`agenda_reminder_enqueue_failed:${error.message}`);
  }));
}

type ReminderReconcileSeed = {
  agenda_event_id: string;
  remote_jid: string;
  lead_id: string | null;
  journey_id: string;
  rule_id: string;
  channel: "evolution" | "meta_cloud";
  connection_id: string;
  reminder_index: number;
  status: string;
  created_at: string;
};

/**
 * Rebuilds reminders after the operator changes their reminder rules.
 *
 * Only events that already had a V2 obligation are eligible. This activation
 * boundary prevents old appointments from receiving retroactive messages.
 * An index that was confirmed by the provider is never scheduled again.
 */
export async function reconcileAgendaRemindersAfterConfigChange(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  agendaLembretes: AgentAgendaLembretes | null;
  timezone: string | null;
  languageTag?: string | null;
}): Promise<{ eligibleEvents: number; scheduledEvents: number }> {
  if (!params.agendaLembretes?.ativo || params.agendaLembretes.regras.length === 0) {
    return { eligibleEvents: 0, scheduledEvents: 0 };
  }
  if (!params.timezone || !isValidIanaTimezone(params.timezone)) {
    throw new Error("agenda_reminder_timezone_invalid");
  }
  const sb = params.sb ?? createSupabaseServiceClient();
  const { data: seedData, error: seedError } = await sb
    .from("agenda_reminder_jobs_v2")
    .select("agenda_event_id,remote_jid,lead_id,journey_id,rule_id,channel,connection_id,reminder_index,status,created_at")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (seedError) throw new Error(`agenda_reminder_reconcile_seed_failed:${seedError.message}`);
  const seeds = (Array.isArray(seedData) ? seedData : []) as ReminderReconcileSeed[];
  const eventIds = [...new Set(seeds.map((row) => row.agenda_event_id))];
  if (!eventIds.length) return { eligibleEvents: 0, scheduledEvents: 0 };
  const { data: eventData, error: eventError } = await sb
    .from("agenda_events")
    .select("id,title,location,start_at,attendee_name,lead_id,status,agent_id")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .eq("status", "confirmed")
    .gt("start_at", new Date().toISOString())
    .in("id", eventIds);
  if (eventError) throw new Error(`agenda_reminder_reconcile_events_failed:${eventError.message}`);
  let scheduledEvents = 0;
  for (const event of eventData ?? []) {
    const eventSeeds = seeds.filter((row) => row.agenda_event_id === event.id);
    const seed = eventSeeds[0];
    if (!seed) continue;
    const { data: state, error: stateError } = await sb
      .from("conversation_states")
      .select("automation_epoch,human_paused,conversation_mode,active_journey_id")
      .eq("tenant_id", params.tenantId)
      .eq("remote_jid", seed.remote_jid)
      .eq("channel", "whatsapp")
      .maybeSingle();
    if (stateError) throw new Error(`agenda_reminder_reconcile_state_failed:${stateError.message}`);
    if (!state || state.human_paused || state.conversation_mode !== "automation" || state.active_journey_id !== seed.journey_id) continue;
    const sentIndexes = [...new Set(eventSeeds.filter((row) => row.status === "sent").map((row) => Number(row.reminder_index)))];
    await scheduleAgendaRemindersForEvent({
      sb,
      tenantId: params.tenantId,
      agentId: params.agentId,
      remoteJid: seed.remote_jid,
      agendaEventId: String(event.id),
      eventStartAt: new Date(String(event.start_at)),
      attendeeName: typeof event.attendee_name === "string" ? event.attendee_name : null,
      location: typeof event.location === "string" ? event.location : null,
      eventTitle: String(event.title),
      agendaLembretes: params.agendaLembretes,
      timezone: params.timezone,
      languageTag: params.languageTag,
      leadId: typeof event.lead_id === "string" ? event.lead_id : seed.lead_id,
      journeyId: seed.journey_id,
      ruleId: seed.rule_id,
      channel: seed.channel,
      connectionId: seed.connection_id,
      automationEpoch: Number(state.automation_epoch),
      skipReminderIndexes: sentIndexes,
    });
    scheduledEvents += 1;
  }
  return { eligibleEvents: eventIds.length, scheduledEvents };
}

export async function cancelAgendaRemindersForEvent(params: {
  sb?: SupabaseServiceClient; tenantId: string; agendaEventId: string; reason?: string;
}): Promise<void> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const { error } = await sb.rpc("cancel_agenda_reminders_v2", {
    p_tenant_id: params.tenantId, p_reason: params.reason ?? "agenda_event_changed",
    p_event_id: params.agendaEventId, p_remote_jid: null, p_agent_id: null,
  });
  if (error) throw new Error(`agenda_reminder_cancel_failed:${error.message}`);
}

async function finishJob(params: {
  sb: SupabaseServiceClient; job: AgendaReminderJobV2;
  status: "pending" | "sent" | "cancelled" | "exhausted"; attempts?: number;
  nextAttemptAt?: Date | null; error?: string | null; outboxId?: string | null;
  providerMessageId?: string | null;
}): Promise<boolean> {
  const { data, error } = await params.sb.rpc("finish_agenda_reminder_job_v2", {
    p_id: params.job.id, p_claim_token: params.job.claim_token, p_status: params.status,
    p_attempts: params.attempts ?? params.job.attempts,
    p_next_attempt_at: params.nextAttemptAt?.toISOString() ?? null,
    p_last_error: params.error ?? null, p_outbox_id: params.outboxId ?? null,
    p_provider_message_id: params.providerMessageId ?? null,
  });
  if (error) throw new Error(`agenda_reminder_finish_failed:${error.message}`);
  return data === true;
}

function isRetryableProviderFailure(reason: string): boolean {
  return /(?:429|5\d\d|timeout|timed out|network|fetch failed|ECONN|temporar)/i.test(reason);
}

async function processReminderJob(sb: SupabaseServiceClient, job: AgendaReminderJobV2): Promise<"sent" | "cancelled" | "failed"> {
  const [agentResult, eventResult, stateResult] = await Promise.all([
    sb.from("tenant_agents").select("active,archived_at,agenda_reminder_config_version,metadata").eq("tenant_id", job.tenant_id).eq("agent_id", job.agent_id).maybeSingle(),
    sb.from("agenda_events").select("status,start_at,agent_id").eq("tenant_id", job.tenant_id).eq("id", job.agenda_event_id).maybeSingle(),
    sb.from("conversation_states").select("human_paused,conversation_mode,automation_epoch,active_journey_id").eq("tenant_id", job.tenant_id).eq("remote_jid", job.remote_jid).eq("channel", "whatsapp").maybeSingle(),
  ]);
  if (agentResult.error || eventResult.error || stateResult.error) throw new Error("agenda_reminder_state_unavailable");
  const agent = agentResult.data; const event = eventResult.data; const state = stateResult.data;
  const reminderConfig = agent?.metadata && typeof agent.metadata === "object" ? (agent.metadata as Record<string, unknown>).agendaLembretes : null;
  const activeConfig = Boolean(reminderConfig && typeof reminderConfig === "object" && (reminderConfig as Record<string, unknown>).ativo === true);
  const invalid = !agent || !agent.active || agent.archived_at || Number(agent.agenda_reminder_config_version) !== job.config_version || !activeConfig ||
    !event || event.status !== "confirmed" || event.agent_id !== job.agent_id || new Date(event.start_at).getTime() <= Date.now() ||
    !state || state.human_paused || state.conversation_mode !== "automation" || Number(state.automation_epoch) !== job.automation_epoch ||
    state.active_journey_id !== job.journey_id;
  if (invalid) { await finishJob({ sb, job, status: "cancelled", error: "agenda_reminder_state_invalid" }); return "cancelled"; }

  const outbound = await prepareAutomatedOutbound({
    sb, operationKey: job.operation_key, tenantId: job.tenant_id, remoteJid: job.remote_jid,
    agentId: job.agent_id, journeyId: job.journey_id, ruleId: job.rule_id,
    connectionId: job.connection_id, channel: job.channel, kind: "text",
    content: job.rendered_message.slice(0, 4000), leadId: job.lead_id,
  });
  if (outbound.action === "already_sent") { await finishJob({ sb, job, status: "sent", outboxId: outbound.id }); return "sent"; }
  if (outbound.action !== "send") {
    await finishJob({ sb, job, status: "cancelled", error: outbound.action === "blocked" ? `authorization_blocked:${outbound.reason}` : `outbox_${outbound.action}` });
    return "cancelled";
  }

  let send: Awaited<ReturnType<typeof evolutionSendText>> | Awaited<ReturnType<typeof sendWhatsAppTextMessage>>;
  if (job.channel === "evolution") {
    const instance = await getEvolutionInstanceByIdForTenant(job.tenant_id, job.connection_id);
    const number = remoteJidToEvoNumber(job.remote_jid);
    if (!instance || !number) {
      await markAgentOutboundFailed({ sb, id: outbound.id, claimToken: outbound.claimToken, error: "connection_unavailable" });
      await finishJob({ sb, job, status: "cancelled", error: "connection_unavailable", outboxId: outbound.id }); return "cancelled";
    }
    send = await evolutionSendText({ instanceName: instance.instance_name, number, text: job.rendered_message.slice(0, 4000) });
  } else {
    const connection = await lookupWhatsAppCloudConnectionByPhoneNumberId(job.connection_id);
    const number = job.remote_jid.replace(/\D/g, "");
    if (!connection || connection.tenant_id !== job.tenant_id || !number) {
      await markAgentOutboundFailed({ sb, id: outbound.id, claimToken: outbound.claimToken, error: "connection_unavailable" });
      await finishJob({ sb, job, status: "cancelled", error: "connection_unavailable", outboxId: outbound.id }); return "cancelled";
    }
    send = await sendWhatsAppTextMessage({ toWaId: number, text: job.rendered_message.slice(0, 4000), phoneNumberId: connection.phone_number_id, accessToken: connection.access_token });
  }
  if (!send.ok) {
    const reason = send.error || "agenda_reminder_provider_failed";
    await markAgentOutboundFailed({ sb, id: outbound.id, claimToken: outbound.claimToken, error: reason });
    const attempts = job.attempts + 1; const retry = attempts < job.max_attempts && isRetryableProviderFailure(reason);
    await finishJob({ sb, job, status: retry ? "pending" : "exhausted", attempts,
      nextAttemptAt: retry ? new Date(Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** attempts)) : null,
      error: reason, outboxId: outbound.id });
    if (!retry) await recordAgentRuntimeAlert({ sb, tenantId: job.tenant_id, agentId: job.agent_id,
      code: "agenda_reminder_delivery_exhausted", severity: "warning",
      resourceType: "agenda_reminder", resourceId: job.id, details: { channel: job.channel, reason } });
    return "failed";
  }
  const evolutionReceipt = job.channel === "evolution" ? extractEvolutionSendReceipt("data" in send ? send.data : null) : null;
  const providerMessageId = job.channel === "meta_cloud" ? ("messageId" in send ? send.messageId ?? null : null) : evolutionReceipt?.messageId ?? null;
  try {
    await finalizeAgentOutboundDelivery({ sb, id: outbound.id, claimToken: outbound.claimToken,
      providerMessageId, kind: "text", content: job.rendered_message,
      providerRemoteJid: evolutionReceipt?.remoteJid ?? null, providerStatus: evolutionReceipt?.providerStatus ?? null,
      deliveryStatus: evolutionReceipt?.deliveryStatus ?? "sent" });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "outbox_finalize_failed";
    await markAgentOutboundAmbiguous({ sb, id: outbound.id, claimToken: outbound.claimToken,
      reason: `provider_accepted_finalize_failed:${reason}` }).catch(() => undefined);
    await finishJob({ sb, job, status: "cancelled", attempts: job.attempts + 1,
      error: `provider_accepted_outbox_ambiguous:${reason}`, outboxId: outbound.id,
      providerMessageId }).catch(() => undefined);
    return "failed";
  }
  await finishJob({ sb, job, status: "sent", attempts: job.attempts + 1, outboxId: outbound.id, providerMessageId });
  return "sent";
}

export async function processDueAgendaReminderJobs(params: { sb?: SupabaseServiceClient; batchSize?: number; deadlineMs?: number }): Promise<{ processed: number; sent: number; cancelled: number; failed: number }> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const deadlineAt = Date.now() + Math.max(5_000, params.deadlineMs ?? 45_000);
  const { data, error } = await sb.rpc("claim_agenda_reminder_jobs_v2", { p_limit: Math.max(1, Math.min(params.batchSize ?? 8, 20)), p_claim_seconds: 120 });
  if (error) throw new Error(`agenda_reminder_claim_failed:${error.message}`);
  const jobs = (Array.isArray(data) ? data : []) as AgendaReminderJobV2[];
  const totals = { processed: 0, sent: 0, cancelled: 0, failed: 0 };
  for (const job of jobs) {
    if (Date.now() >= deadlineAt) break;
    try {
      const outcome = await processReminderJob(sb, job); totals.processed += 1; totals[outcome] += 1;
    } catch (error_) {
      totals.processed += 1; totals.failed += 1; const attempts = job.attempts + 1;
      await finishJob({ sb, job, status: attempts < job.max_attempts ? "pending" : "exhausted", attempts,
        nextAttemptAt: attempts < job.max_attempts ? new Date(Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** attempts)) : null,
        error: error_ instanceof Error ? error_.message : "agenda_reminder_failed" }).catch(() => undefined);
    }
  }
  console.info("[agenda-reminder-v2] batch_complete", totals);
  return totals;
}
