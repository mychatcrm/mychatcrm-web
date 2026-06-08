import "server-only";

import {
  detectAgendaCancelIntent,
  detectRescheduleIntent,
  findNextActiveAgendaEvent,
} from "@/lib/server/agent-cta-scheduler";
import type { AgendaEventRow } from "@/lib/server/google-calendar-db";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type AgendaFollowUpSignalReason = "reschedule_requested" | "cancel_requested";

const AGENDA_FOLLOW_UP_REACTIVATED_EVENT = "agenda_follow_up_reactivated";

const RESCHEDULE_SIGNAL_RE =
  /\b(quero\s+remarcar|quero\s+trocar\s+(o\s+)?hor[aá]rio|quero\s+mudar\s+a\s+data|n[aã]o\s+consigo\s+nesse\s+hor[aá]rio|nao\s+consigo\s+nesse\s+horario|n[aã]o\s+consigo\s+nesse\s+dia|nao\s+consigo\s+nesse\s+dia|outro\s+hor[aá]rio|outra\s+data)\b/i;

const CANCEL_SIGNAL_RE =
  /\b(quero\s+cancelar|preciso\s+cancelar|n[aã]o\s+vou\s+conseguir\s+ir|nao\s+vou\s+conseguir\s+ir|n[aã]o\s+consigo\s+ir|nao\s+consigo\s+ir|vou\s+cancelar)\b/i;

function isAgendaOnHandoffOff(agentMetadata: Record<string, unknown>): boolean {
  return agentMetadata.agendaAutomationEnabled === true && agentMetadata.ctaHandoffAtivo === false;
}

function detectAgendaFollowUpSignalReason(text: string): AgendaFollowUpSignalReason | null {
  const value = text.trim();
  if (!value) return null;
  if (detectRescheduleIntent(value) || RESCHEDULE_SIGNAL_RE.test(value)) {
    return "reschedule_requested";
  }
  if (detectAgendaCancelIntent(value) || CANCEL_SIGNAL_RE.test(value)) {
    return "cancel_requested";
  }
  return null;
}

function eventTimestampMs(event: AgendaEventRow): number {
  const createdAt = new Date(event.created_at).getTime();
  const updatedAt = new Date(event.updated_at).getTime();
  return Math.max(Number.isNaN(createdAt) ? 0 : createdAt, Number.isNaN(updatedAt) ? 0 : updatedAt);
}

function logAgendaFollowUp(event: string, payload: Record<string, unknown>): void {
  console.info("[agenda-follow-up-control]", { event, ...payload });
}

export async function recordAgendaFollowUpReactivationForInbound(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  remoteJid: string;
  leadId?: string | null;
  conversationStateId?: string | null;
  agentMetadata: Record<string, unknown>;
  inboundText: string;
  now?: Date;
}): Promise<{
  recorded: boolean;
  reason?: AgendaFollowUpSignalReason;
  activeEventId?: string;
  skippedReason?: string;
}> {
  if (!isAgendaOnHandoffOff(params.agentMetadata)) {
    return { recorded: false, skippedReason: "scope_not_applicable" };
  }

  const reason = detectAgendaFollowUpSignalReason(params.inboundText);
  if (!reason) return { recorded: false, skippedReason: "no_agenda_mutation_signal" };

  let activeAgendaEvent: AgendaEventRow | null = null;
  try {
    activeAgendaEvent = await findNextActiveAgendaEvent({
      sb: params.sb,
      tenantId: params.tenantId,
      remoteJid: params.remoteJid,
      now: params.now,
    });
  } catch (error) {
    console.warn("[agenda-follow-up-control]", {
      event: "reactivation_lookup_failed",
      tenant_id: params.tenantId,
      agent_id: params.agentId,
      remote_jid_last4: params.remoteJid.replace(/\D/g, "").slice(-4),
      error: error instanceof Error ? error.message : String(error),
    });
    return { recorded: false, reason, skippedReason: "active_event_lookup_failed" };
  }

  if (!activeAgendaEvent) {
    return { recorded: false, reason, skippedReason: "no_active_agenda_event" };
  }

  const detail = JSON.stringify({
    reason,
    agent_id: params.agentId,
    active_event_id: activeAgendaEvent.id,
    active_event_start_at: activeAgendaEvent.start_at,
    source: "evolution_inbound",
  });

  const { error } = await params.sb.from("conversation_events").insert({
    tenant_id: params.tenantId,
    remote_jid: params.remoteJid,
    lead_id: params.leadId ?? null,
    conversation_state_id: params.conversationStateId ?? null,
    event_type: AGENDA_FOLLOW_UP_REACTIVATED_EVENT,
    title: "Follow-up convencional reativado por agenda",
    detail,
    actor_type: "system",
    actor_id: params.agentId,
    actor_name: "agenda_follow_up_control",
  });

  if (error) {
    console.warn("[agenda-follow-up-control]", {
      event: "reactivation_insert_failed",
      tenant_id: params.tenantId,
      agent_id: params.agentId,
      active_event_id: activeAgendaEvent.id,
      error: error.message,
    });
    return { recorded: false, reason, activeEventId: activeAgendaEvent.id, skippedReason: "insert_failed" };
  }

  logAgendaFollowUp("reactivation_recorded", {
    tenant_id: params.tenantId,
    agent_id: params.agentId,
    active_event_id: activeAgendaEvent.id,
    reason,
  });

  return { recorded: true, reason, activeEventId: activeAgendaEvent.id };
}

export async function shouldSuppressConventionalFollowUpForAgenda(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  agentMetadata: Record<string, unknown>;
  now?: Date;
}): Promise<{
  suppress: boolean;
  activeAgendaEvent: AgendaEventRow | null;
  reason: string;
  reactivationEventId?: string;
}> {
  const activeAgendaEvent = await findNextActiveAgendaEvent({
    sb: params.sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    now: params.now,
  });

  if (!activeAgendaEvent) {
    return { suppress: false, activeAgendaEvent: null, reason: "no_active_agenda_event" };
  }

  if (!isAgendaOnHandoffOff(params.agentMetadata)) {
    return { suppress: true, activeAgendaEvent, reason: "active_agenda_event_legacy" };
  }

  const { data, error } = await params.sb
    .from("conversation_events")
    .select("id, created_at")
    .eq("tenant_id", params.tenantId)
    .eq("remote_jid", params.remoteJid)
    .eq("event_type", AGENDA_FOLLOW_UP_REACTIVATED_EVENT)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[agenda-follow-up-control]", {
      event: "reactivation_lookup_failed",
      tenant_id: params.tenantId,
      active_event_id: activeAgendaEvent.id,
      error: error.message,
    });
    return { suppress: true, activeAgendaEvent, reason: "reactivation_lookup_failed" };
  }

  const latestReactivation = data as { id: string; created_at: string } | null;
  if (!latestReactivation) {
    return { suppress: true, activeAgendaEvent, reason: "active_agenda_event" };
  }

  const reactivationMs = new Date(latestReactivation.created_at).getTime();
  if (!Number.isNaN(reactivationMs) && reactivationMs > eventTimestampMs(activeAgendaEvent)) {
    return {
      suppress: false,
      activeAgendaEvent,
      reason: "reactivation_signal_after_active_event",
      reactivationEventId: latestReactivation.id,
    };
  }

  return {
    suppress: true,
    activeAgendaEvent,
    reason: "active_agenda_event_after_reactivation",
    reactivationEventId: latestReactivation.id,
  };
}
