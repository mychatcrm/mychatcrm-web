import {
  generateAgentResponse,
  isAgentMissingInstructionsResult,
} from "@/lib/ai/generate-agent-response";
import { evolutionSendText, remoteJidToEvoNumber } from "@/lib/integrations/evolution-api";
import { extractEvolutionSendReceipt } from "@/lib/integrations/evolution-message-receipt";
import { sendWhatsAppTextMessage } from "@/lib/integrations/whatsapp-cloud";
import type { AgentFollowUpInteligente } from "@/lib/types";
import { phoneFromRemoteJid } from "@/lib/server/auto-lead-upsert";
import { isAgentAutomationAllowed } from "@/lib/server/conversation-operation";
import { followUpInteligenteFromMetadata } from "@/lib/server/follow-up-settings";
import {
  getEvolutionInstanceByIdForTenant,
  type TenantEvolutionInstanceRow,
} from "@/lib/server/tenant-evolution-instance-db";
import {
  lookupWhatsAppCloudConnectionByPhoneNumberId,
  type WhatsAppCloudConnection,
} from "@/lib/server/whatsapp-cloud-connections";
import { canAgentAutoContactLead } from "@/lib/server/agent-auto-contact-guard";
import { applyAgentCrmMove } from "@/lib/server/agent-crm-move";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  buildFollowUpAiInstruction,
  evaluateFollowUpNeed,
  isWithinBusinessHours,
  type FollowUpDecision,
} from "@/lib/server/follow-up-engine";
import { isValidIanaTimezone } from "@/lib/agents/agent-datetime";
import { buildFollowUpEvalContext } from "@/lib/server/follow-up-evaluate";
import { findNextActiveAgendaEvent } from "@/lib/server/agent-cta-scheduler";
import {
  authorizeActiveJourney,
  getLeadJourneyById,
  touchLeadJourney,
  type LeadJourney,
} from "@/lib/server/lead-journeys";
import {
  finalizeAgentOutboundDelivery,
  markAgentOutboundFailed,
  prepareAutomatedOutbound,
} from "@/lib/server/agent-outbound-outbox";
import { parseAgentTurnPlan } from "@/lib/ai/agent-turn-plan";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export function safeFollowUpReplyFromResult(result: Awaited<ReturnType<typeof generateAgentResponse>>):
  | { ok: true; reply: string }
  | { ok: false; reason: string } {
  if (!result.ok) return { ok: false, reason: `agent_generation_failed:${result.code}` };
  const plan = parseAgentTurnPlan(result.structuredData);
  if (!plan) return { ok: false, reason: "follow_up_structured_reply_missing" };
  if (plan.agenda.action !== "none") {
    return { ok: false, reason: "follow_up_agenda_action_forbidden" };
  }
  if (plan.leadOutcome.action !== "none") {
    return { ok: false, reason: "follow_up_lead_outcome_forbidden" };
  }
  if (/\[\[(?:HANDOFF|ENVIAR_MEDIA)(?::[^\]]*)?\]\]/i.test(plan.reply)) {
    return { ok: false, reason: "follow_up_internal_marker_forbidden" };
  }
  const reply = plan.reply.trim();
  return reply ? { ok: true, reply } : { ok: false, reason: "follow_up_empty_reply" };
}

/** Maior que o limite de 120s da função que processa follow-ups. */
export const FOLLOW_UP_CLAIM_TTL_MS = 5 * 60 * 1000;
export const FOLLOW_UP_BATCH_LIMIT = 15;
export const FOLLOW_UP_PROCESS_CONCURRENCY = 3;

export type FollowUpOutboundTransport =
  | {
      ok: true;
      channel: "evolution";
      connectionId: string;
      instance: TenantEvolutionInstanceRow;
    }
  | {
      ok: true;
      channel: "meta_cloud";
      connectionId: string;
      connection: WhatsAppCloudConnection;
    }
  | { ok: false; reason: string };

export type FollowUpJobRow = {
  id: string;
  tenant_id: string;
  agent_id: string;
  remote_jid: string;
  lead_id: string | null;
  journey_id: string | null;
  channel: "evolution" | "meta_cloud" | null;
  connection_id: string | null;
  rule_id: string | null;
  automation_epoch: number | null;
  claim_token: string | null;
  claim_expires_at: string | null;
  scheduled_at: string;
  attempts: number;
  max_attempts: number;
  status: string;
  follow_up_type: string;
  priority: number;
  context_summary: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function logFollowUp(event: string, payload: Record<string, unknown>): void {
  console.info("[follow-up-jobs]", { event, ...payload });
}

type FollowUpRuntimeConfiguration =
  | {
      ok: true;
      settings: AgentFollowUpInteligente;
      fingerprint: string;
    }
  | {
      ok: false;
      reason: "agent_not_found" | "agent_inactive" | "agent_configuration_unavailable";
    };

async function loadFollowUpRuntimeConfiguration(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
}): Promise<FollowUpRuntimeConfiguration> {
  const { data, error } = await params.sb
    .from("tenant_agents")
    .select("metadata,active,archived_at")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .maybeSingle();
  if (error) return { ok: false, reason: "agent_configuration_unavailable" };
  if (!data) return { ok: false, reason: "agent_not_found" };
  if (data.active !== true || data.archived_at) {
    return { ok: false, reason: "agent_inactive" };
  }
  const metadata =
    data.metadata && typeof data.metadata === "object"
      ? (data.metadata as Record<string, unknown>)
      : {};
  const settings = followUpInteligenteFromMetadata(metadata);
  return {
    ok: true,
    settings,
    // The normalizer returns a stable object shape. This fingerprint makes a
    // configuration change during generation invalidate that pending output.
    fingerprint: JSON.stringify(settings),
  };
}

async function markFollowUpTimezoneReview(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
}): Promise<void> {
  const { error } = await params.sb.rpc("mark_agent_runtime_review_reason_v1", {
    p_tenant_id: params.tenantId,
    p_agent_id: params.agentId,
    p_reason: "follow_up_timezone_required",
  });
  if (error) {
    logFollowUp("review_reason_failed", {
      tenant_id: params.tenantId,
      agent_id: params.agentId,
      reason: "follow_up_timezone_required",
      error: error.message,
    });
  }
}

export async function resolveFollowUpOutboundTransport(params: {
  tenantId: string;
  connectionId: string;
  channel: "evolution" | "meta_cloud";
}): Promise<FollowUpOutboundTransport> {
  const connectionId = params.connectionId.trim();
  if (!connectionId) {
    return { ok: false, reason: "missing_authorized_connection" };
  }

  if (params.channel === "meta_cloud") {
    const cloud = await lookupWhatsAppCloudConnectionByPhoneNumberId(connectionId);
    if (!cloud || cloud.tenant_id !== params.tenantId || !cloud.active) {
      return { ok: false, reason: "authorized_connection_not_found" };
    }
    return {
      ok: true,
      channel: "meta_cloud",
      connectionId,
      connection: cloud,
    };
  }

  const evolution = await getEvolutionInstanceByIdForTenant(
    params.tenantId,
    connectionId,
  );
  if (evolution) {
    return evolution.instance_name && evolution.connection_state === "open"
      ? {
          ok: true,
          channel: "evolution",
          connectionId,
          instance: evolution,
        }
      : { ok: false, reason: "authorized_connection_not_open" };
  }
  return { ok: false, reason: "authorized_connection_not_found" };
}

/** Recovers only database leases that have actually expired. */
export async function reclaimStuckFollowUpJobs(
  sb: SupabaseServiceClient,
  now = new Date(),
): Promise<number> {
  const { data, error } = await sb.rpc("recover_expired_follow_up_jobs_v2", {
    p_now: now.toISOString(),
  });
  if (error) {
    logFollowUp("claim_recovery_failed", { error: error.message });
    return 0;
  }
  const recovered = Number(data ?? 0);
  if (recovered > 0) logFollowUp("claim_recovered", { count: recovered });
  return recovered;
}

async function claimFollowUpJob(
  sb: SupabaseServiceClient,
  jobId: string,
): Promise<FollowUpJobRow | null> {
  const claimSeconds = Math.floor(FOLLOW_UP_CLAIM_TTL_MS / 1000);
  const { data, error } = await sb.rpc("claim_follow_up_job_v2", {
    p_job_id: jobId,
    p_claim_seconds: claimSeconds,
  });
  if (error) {
    logFollowUp("claim_failed", { job_id: jobId, error: error.message });
    return null;
  }
  const raw = Array.isArray(data) ? data[0] : data;
  return raw && typeof raw === "object"
    ? rowFromDb(raw as Record<string, unknown>)
    : null;
}

async function heartbeatFollowUpJob(
  sb: SupabaseServiceClient,
  job: FollowUpJobRow,
): Promise<boolean> {
  if (!job.claim_token) return false;
  const { data, error } = await sb.rpc("heartbeat_follow_up_job_v2", {
    p_job_id: job.id,
    p_claim_token: job.claim_token,
    p_extend_seconds: Math.floor(FOLLOW_UP_CLAIM_TTL_MS / 1000),
  });
  if (error || data !== true) {
    logFollowUp("claim_lost", {
      job_id: job.id,
      error: error?.message ?? "claim_expired",
    });
    return false;
  }
  return true;
}

type FollowUpFinishStatus = "pending" | "sent" | "exhausted" | "cancelled";

async function finishClaimedFollowUpJob(params: {
  sb: SupabaseServiceClient;
  job: FollowUpJobRow;
  status: FollowUpFinishStatus;
  attempts?: number;
  scheduledAt?: Date | null;
  followUpType?: string | null;
  priority?: number | null;
  lastError?: string | null;
  nextScheduledAt?: Date | null;
}): Promise<{ ok: true; nextJobId: string | null } | { ok: false; reason: string }> {
  if (!params.job.claim_token) return { ok: false, reason: "claim_missing" };
  const { data, error } = await params.sb.rpc("finish_follow_up_job_v2", {
    p_job_id: params.job.id,
    p_claim_token: params.job.claim_token,
    p_status: params.status,
    p_attempts: params.attempts ?? null,
    p_scheduled_at: params.scheduledAt?.toISOString() ?? null,
    p_follow_up_type: params.followUpType ?? null,
    p_priority: params.priority ?? null,
    p_last_error: params.lastError ?? null,
    p_next_scheduled_at: params.nextScheduledAt?.toISOString() ?? null,
  });
  if (error) {
    logFollowUp("finish_failed", {
      job_id: params.job.id,
      error: error.message,
    });
    return { ok: false, reason: error.message };
  }
  const result = data && typeof data === "object"
    ? (data as Record<string, unknown>)
    : null;
  if (result?.ok !== true) {
    return {
      ok: false,
      reason: typeof result?.reason === "string" ? result.reason : "claim_lost",
    };
  }
  return {
    ok: true,
    nextJobId: typeof result.nextJobId === "string" ? result.nextJobId : null,
  };
}

function retomadaHumanoMs(value: number, unit: AgentFollowUpInteligente["retomadaHumanoTempoUnidade"]): number {
  if (unit === "minutos") return value * 60_000;
  if (unit === "dias") return value * 86_400_000;
  return value * 3_600_000;
}

function rowFromDb(data: Record<string, unknown>): FollowUpJobRow {
  return {
    id: String(data.id),
    tenant_id: String(data.tenant_id),
    agent_id: String(data.agent_id),
    remote_jid: String(data.remote_jid),
    lead_id: typeof data.lead_id === "string" ? data.lead_id : null,
    journey_id: typeof data.journey_id === "string" ? data.journey_id : null,
    channel:
      data.channel === "evolution" || data.channel === "meta_cloud"
        ? data.channel
        : null,
    connection_id:
      typeof data.connection_id === "string" ? data.connection_id : null,
    rule_id: typeof data.rule_id === "string" ? data.rule_id : null,
    automation_epoch:
      Number.isFinite(Number(data.automation_epoch))
        ? Number(data.automation_epoch)
        : null,
    claim_token: typeof data.claim_token === "string" ? data.claim_token : null,
    claim_expires_at:
      typeof data.claim_expires_at === "string" ? data.claim_expires_at : null,
    scheduled_at: String(data.scheduled_at),
    attempts: Number(data.attempts ?? 0),
    max_attempts: Number(data.max_attempts ?? 3),
    status: String(data.status),
    follow_up_type: typeof data.follow_up_type === "string" ? data.follow_up_type : "silence",
    priority: Number(data.priority ?? 3),
    context_summary: typeof data.context_summary === "string" ? data.context_summary : null,
    last_error: typeof data.last_error === "string" ? data.last_error : null,
    created_at: String(data.created_at),
    updated_at: String(data.updated_at),
  };
}

// ─── observability event ────────────────────────────────────────────────────

type FollowUpEventType =
  | "follow_up_evaluated"
  | "follow_up_skipped"
  | "follow_up_blocked_by_human"
  | "follow_up_sent"
  | "follow_up_failed"
  | "cooldown_active"
  | "spam_risk_detected"
  | "sla_breached"
  | "follow_up_closed"
  | "business_hours_skipped"
  | "customer_replied"
  | "follow_up_rescheduled_retomada"
  | "follow_up_exhausted";

async function recordEvent(
  sb: SupabaseServiceClient,
  event: FollowUpEventType,
  params: {
    tenantId: string;
    agentId: string;
    remoteJid: string;
    leadId?: string | null;
    jobId?: string | null;
    payload?: Record<string, unknown>;
    /** Só grava eventos quando follow-up está ativo no agente. */
    followUpActive: boolean;
  },
): Promise<void> {
  if (!params.followUpActive) return;
  try {
    await sb.from("agent_followup_events").insert({
      tenant_id: params.tenantId,
      agent_id: params.agentId,
      remote_jid: params.remoteJid,
      lead_id: params.leadId ?? null,
      job_id: params.jobId ?? null,
      event_type: event,
      payload: params.payload ?? null,
    });
  } catch {
    // observability must never crash the main flow
  }
}

// ─── lead loader ─────────────────────────────────────────────────────────────

type LeadForFollowUp = {
  id: string;
  name: string | null;
  status: string | null;
  last_message_at: string | null;
  last_follow_up_at: string | null;
  follow_up_count: number;
  follow_up_cooldown_until: string | null;
  sla_breached_at: string | null;
};

export async function loadLeadForFollowUp(
  sb: SupabaseServiceClient,
  tenantId: string,
  remoteJid: string,
  explicitLeadId?: string | null,
): Promise<LeadForFollowUp | null> {
  if (explicitLeadId) {
    const { data } = await sb
      .from("leads")
      .select(
        "id,name,status,last_message_at,last_follow_up_at,follow_up_count,follow_up_cooldown_until,sla_breached_at",
      )
      .eq("id", explicitLeadId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    return data ? normalizeLeadRow(data as Record<string, unknown>) : null;
  }

  const phone = phoneFromRemoteJid(remoteJid);
  if (!phone) return null;
  const { data } = await sb
    .from("leads")
    .select(
      "id,name,status,last_message_at,last_follow_up_at,follow_up_count,follow_up_cooldown_until,sla_breached_at",
    )
    .eq("tenant_id", tenantId)
    .eq("phone", phone)
    .maybeSingle();
  return data ? normalizeLeadRow(data as Record<string, unknown>) : null;
}

function normalizeLeadRow(row: Record<string, unknown>): LeadForFollowUp {
  return {
    id: String(row.id),
    name: typeof row.name === "string" ? row.name.trim() || null : null,
    status: typeof row.status === "string" ? row.status : null,
    last_message_at:
      typeof row.last_message_at === "string" ? row.last_message_at : null,
    last_follow_up_at:
      typeof row.last_follow_up_at === "string" ? row.last_follow_up_at : null,
    follow_up_count: Number(row.follow_up_count ?? 0),
    follow_up_cooldown_until:
      typeof row.follow_up_cooldown_until === "string"
        ? row.follow_up_cooldown_until
        : null,
    sla_breached_at:
      typeof row.sla_breached_at === "string" ? row.sla_breached_at : null,
  };
}

// ─── message timestamp helpers ───────────────────────────────────────────────

export async function loadMessageTimestamps(
  sb: SupabaseServiceClient,
  tenantId: string,
  remoteJid: string,
): Promise<{
  lastCustomerMessageAt: Date | null;
  lastAgentMessageAt: Date | null;
  lastHumanOutboundAt: Date | null;
}> {
  const { data } = await sb
    .from("whatsapp_messages")
    .select("direction,agent_id,created_at")
    .eq("tenant_id", tenantId)
    .eq("remote_jid", remoteJid)
    .order("created_at", { ascending: false })
    .limit(50);

  const rows = (data ?? []) as Array<{
    direction: string;
    agent_id: string | null;
    created_at: string;
  }>;

  let lastCustomerMessageAt: Date | null = null;
  let lastAgentMessageAt: Date | null = null;
  let lastHumanOutboundAt: Date | null = null;

  for (const row of rows) {
    const ts = new Date(row.created_at);
    if (row.direction === "inbound") {
      if (!lastCustomerMessageAt) lastCustomerMessageAt = ts;
    } else if (row.direction === "outbound") {
      const isHumanOutbound = !row.agent_id || row.agent_id === "human";
      if (isHumanOutbound) {
        if (!lastHumanOutboundAt) lastHumanOutboundAt = ts;
      } else {
        if (!lastAgentMessageAt) lastAgentMessageAt = ts;
      }
    }
    if (lastCustomerMessageAt && lastAgentMessageAt && lastHumanOutboundAt) break;
  }

  return { lastCustomerMessageAt, lastAgentMessageAt, lastHumanOutboundAt };
}

// ─── conversation state loader ───────────────────────────────────────────────

export async function loadConversationStateForJob(
  sb: SupabaseServiceClient,
  tenantId: string,
  remoteJid: string,
): Promise<{
  humanPaused: boolean;
  pausedReason: string | null;
  handoffSuggested: boolean;
  conversationMode: string | null;
  archivedAt: Date | null;
  automationEpoch: number;
} | null> {
  const { data } = await sb
    .from("conversation_states")
    .select("human_paused,paused_reason,handoff_suggested,conversation_mode,archived_at,automation_epoch")
    .eq("tenant_id", tenantId)
    .eq("remote_jid", remoteJid)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    humanPaused: row.human_paused === true,
    pausedReason: typeof row.paused_reason === "string" ? row.paused_reason : null,
    handoffSuggested: row.handoff_suggested === true,
    conversationMode:
      typeof row.conversation_mode === "string" ? row.conversation_mode : null,
    archivedAt:
      typeof row.archived_at === "string" ? new Date(row.archived_at) : null,
    automationEpoch: Number(row.automation_epoch ?? 0),
  };
}

// ─── public exports ──────────────────────────────────────────────────────────

export async function cancelPendingFollowUpJobs(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  reason?: string;
  journeyId?: string | null;
}): Promise<number> {
  const { data, error } = await params.sb.rpc("cancel_active_follow_up_jobs_v2", {
    p_tenant_id: params.tenantId,
    p_remote_jid: params.remoteJid,
    p_reason: params.reason ?? "cancelled",
    p_journey_id: params.journeyId ?? null,
  });
  if (error) {
    logFollowUp("cancel_failed", { tenant_id: params.tenantId, error: error.message });
    return 0;
  }
  const count = Number(data ?? 0);
  if (count > 0) logFollowUp("cancelled_pending", { tenant_id: params.tenantId, count });
  return count;
}

export async function scheduleRetomadaJob(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  remoteJid: string;
  leadId?: string | null;
  journeyId?: string | null;
  scheduledAt: Date;
  maxAttempts?: number;
}): Promise<void> {
  // Compatibilidade de API: a retomada por timeout foi desativada. O humano
  // precisa clicar em "Devolver para automação", que revalida a jornada.
  logFollowUp("retomada_not_scheduled_manual_return_required", {
    tenant_id: params.tenantId,
    agent_id: params.agentId,
    scheduled_at: params.scheduledAt.toISOString(),
  });
}

export async function scheduleFollowUpAfterInbound(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  remoteJid: string;
  leadId?: string | null;
  journeyId?: string | null;
  channel?: "evolution" | "meta_cloud";
  connectionId?: string | null;
  settings: AgentFollowUpInteligente;
}): Promise<string | null> {
  if (!params.settings.ativo) return null;

  const sb = params.sb ?? createSupabaseServiceClient();
  if (
    params.settings.usarHorarioComercial &&
    !isValidIanaTimezone(params.settings.timezone)
  ) {
    await markFollowUpTimezoneReview({
      sb,
      tenantId: params.tenantId,
      agentId: params.agentId,
    });
    logFollowUp("schedule_blocked", {
      tenant_id: params.tenantId,
      agent_id: params.agentId,
      reason: "follow_up_timezone_required",
    });
    return null;
  }
  const now = new Date();
  const scheduledAt = new Date(
    now.getTime() + params.settings.intervaloVerificacaoMinutos * 60_000,
  );

  if (!params.journeyId || !params.channel || !params.connectionId) {
    logFollowUp("schedule_blocked", {
      tenant_id: params.tenantId,
      reason: "missing_exact_omnichannel_identity",
    });
    return null;
  }
  const journeyAuth = await authorizeActiveJourney({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    preferredAgentId: params.agentId,
    connectionId: params.connectionId,
    channel: params.channel,
  });
  const exactJourney = journeyAuth.ok ? journeyAuth.journey : null;
  if (
    !journeyAuth.ok ||
    !exactJourney ||
    exactJourney.id !== params.journeyId ||
    !exactJourney.ruleId ||
    exactJourney.connectionId !== params.connectionId
  ) {
    logFollowUp("schedule_blocked", {
      tenant_id: params.tenantId,
      reason: journeyAuth.ok ? "journey_identity_mismatch" : journeyAuth.reason,
    });
    return null;
  }

  const conversationState = await loadConversationStateForJob(
    sb,
    params.tenantId,
    params.remoteJid,
  );
  if (
    !conversationState ||
    conversationState.humanPaused ||
    conversationState.conversationMode !== "automation"
  ) {
    logFollowUp("schedule_blocked", {
      tenant_id: params.tenantId,
      reason: "automation_state_invalid",
    });
    return null;
  }

  const guard = await canAgentAutoContactLead({
    sb,
    tenantId: params.tenantId,
    agentId: params.agentId,
    leadId: params.leadId,
    phone: phoneFromRemoteJid(params.remoteJid),
    remoteJid: params.remoteJid,
    journeyId: params.journeyId,
    triggerSource: "follow_up_schedule",
  });
  if (!guard.ok) {
    logFollowUp("schedule_blocked", {
      tenant_id: params.tenantId,
      remote_jid: params.remoteJid.replace(/\D/g, "").slice(-4),
      agent_id: params.agentId,
      lead_id: guard.leadId,
      form_id: guard.formId,
      reason: guard.reason,
    });
    return null;
  }

  await cancelPendingFollowUpJobs({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    reason: "inbound_reset",
    journeyId: params.journeyId,
  });

  const { data, error } = await sb
    .from("follow_up_jobs")
    .insert({
      tenant_id: params.tenantId,
      agent_id: params.agentId,
      remote_jid: params.remoteJid,
      lead_id: params.leadId ?? null,
      journey_id: exactJourney.id,
      channel: params.channel,
      connection_id: params.connectionId,
      rule_id: exactJourney.ruleId,
      automation_epoch: conversationState.automationEpoch,
      scheduled_at: scheduledAt.toISOString(),
      max_attempts: params.settings.tentativasContato,
      attempts: 0,
      status: "pending",
      follow_up_type: "silence",
      priority: 4,
    })
    .select("id")
    .single();

  if (error || !data) {
    logFollowUp("schedule_failed", {
      tenant_id: params.tenantId,
      remote_jid: params.remoteJid,
      error: error?.message ?? "insert_failed",
    });
    return null;
  }

  const jobId = String((data as { id: string }).id);

  if (params.leadId) {
    await sb
      .from("leads")
      .update({
        follow_up_scheduled_at: scheduledAt.toISOString(),
        follow_up_status: "scheduled",
        updated_at: now.toISOString(),
      })
      .eq("id", params.leadId)
      .eq("tenant_id", params.tenantId);
  }

  logFollowUp("scheduled", {
    tenant_id: params.tenantId,
    job_id: jobId,
    scheduled_at: scheduledAt.toISOString(),
    max_attempts: params.settings.tentativasContato,
  });

  return jobId;
}

export async function processFollowUpJob(
  jobId: string,
  sb?: SupabaseServiceClient,
  claimedJob?: FollowUpJobRow,
): Promise<"sent" | "cancelled" | "exhausted" | "skipped" | "failed"> {
  const client = sb ?? createSupabaseServiceClient();
  const job = claimedJob ?? await claimFollowUpJob(client, jobId);
  if (!job) return "skipped";
  if (job.id !== jobId || job.status !== "processing") return "skipped";
  if (!job.claim_token || !(await heartbeatFollowUpJob(client, job))) return "skipped";
  const isHumanAbandonedJob = job.follow_up_type === "human_abandoned";
  logFollowUp("processing", {
    job_id: job.id,
    tenant_id: job.tenant_id,
    attempts: job.attempts,
    follow_up_type: job.follow_up_type,
    priority: job.priority,
  });

  const commonEventParams = {
    tenantId: job.tenant_id,
    agentId: job.agent_id,
    remoteJid: job.remote_jid,
    jobId: job.id,
  };
  let authorizedJourney: LeadJourney | null = null;
  let authorizedTransport: Extract<FollowUpOutboundTransport, { ok: true }> | null = null;

  {
    if (
      !job.journey_id ||
      !job.rule_id ||
      !job.connection_id ||
      !job.channel ||
      job.automation_epoch == null
    ) {
      const finished = await finishClaimedFollowUpJob({
        sb: client,
        job,
        status: "cancelled",
        lastError: "missing_exact_omnichannel_identity",
      });
      return finished.ok ? "cancelled" : "skipped";
    }
    const storedJourney = job.journey_id
      ? await getLeadJourneyById({
          sb: client,
          tenantId: job.tenant_id,
          journeyId: job.journey_id,
        })
      : null;
    const exactTransport = storedJourney?.connectionId === job.connection_id
      ? await resolveFollowUpOutboundTransport({
          tenantId: job.tenant_id,
          connectionId: job.connection_id,
          channel: job.channel,
        })
      : ({ ok: false, reason: "missing_authorized_connection" } as const);
    if (!exactTransport.ok || exactTransport.channel !== job.channel) {
      const reason = exactTransport.ok ? "channel_identity_mismatch" : exactTransport.reason;
      const finished = await finishClaimedFollowUpJob({
        sb: client,
        job,
        status: "cancelled",
        lastError: reason,
      });
      logFollowUp("cancelled_journey_authorization", {
        job_id: job.id,
        reason,
      });
      return finished.ok ? "cancelled" : "skipped";
    }
    const journeyAuth = await authorizeActiveJourney({
      sb: client,
      tenantId: job.tenant_id,
      remoteJid: job.remote_jid,
      preferredAgentId: job.agent_id,
      connectionId: exactTransport.connectionId,
      channel: exactTransport.channel,
    });
    if (
      !journeyAuth.ok ||
      journeyAuth.journey?.id !== job.journey_id ||
      journeyAuth.journey?.ruleId !== job.rule_id ||
      journeyAuth.journey?.connectionId !== job.connection_id
    ) {
      const reason = journeyAuth.ok ? "journey_identity_mismatch" : journeyAuth.reason;
      const finished = await finishClaimedFollowUpJob({
        sb: client,
        job,
        status: "cancelled",
        lastError: reason,
      });
      logFollowUp("cancelled_journey_authorization", {
        job_id: job.id,
        reason,
      });
      return finished.ok ? "cancelled" : "skipped";
    }
    authorizedJourney = journeyAuth.journey;
    authorizedTransport = exactTransport;

    const currentState = await loadConversationStateForJob(
      client,
      job.tenant_id,
      job.remote_jid,
    );
    if (
      !currentState ||
      currentState.humanPaused ||
      currentState.conversationMode !== "automation" ||
      currentState.automationEpoch !== job.automation_epoch
    ) {
      const finished = await finishClaimedFollowUpJob({
        sb: client,
        job,
        status: "cancelled",
        lastError: "automation_epoch_stale",
      });
      return finished.ok ? "cancelled" : "skipped";
    }
  }

  // Hoisted so the catch block can record events with the real activation state.
  // Starts false (safe default) and is set to settings.ativo once the agent row loads.
  let followUpIsActive = false;
  let outboundDeliveryCommitted = false;

  try {
    // ── check settings ───────────────────────────────────────────────────────
    const initialConfiguration = await loadFollowUpRuntimeConfiguration({
      sb: client,
      tenantId: job.tenant_id,
      agentId: job.agent_id,
    });
    if (!initialConfiguration.ok) {
      if (initialConfiguration.reason === "agent_configuration_unavailable") {
        throw new Error(initialConfiguration.reason);
      }
      const finished = await finishClaimedFollowUpJob({
        sb: client,
        job,
        status: "cancelled",
        lastError: initialConfiguration.reason,
      });
      return finished.ok ? "cancelled" : "skipped";
    }
    const { settings } = initialConfiguration;
    followUpIsActive = settings.ativo;

    if (!settings.ativo) {
      const finished = await finishClaimedFollowUpJob({
        sb: client,
        job,
        status: "cancelled",
        lastError: "follow_up_disabled",
      });
      if (!finished.ok) return "skipped";
      logFollowUp("skipped_disabled", { job_id: job.id, tenant_id: job.tenant_id });
      return "cancelled";
    }

    if (settings.usarHorarioComercial && !isValidIanaTimezone(settings.timezone)) {
      await markFollowUpTimezoneReview({
        sb: client,
        tenantId: job.tenant_id,
        agentId: job.agent_id,
      });
      const finished = await finishClaimedFollowUpJob({
        sb: client,
        job,
        status: "cancelled",
        lastError: "follow_up_timezone_required",
      });
      if (!finished.ok) return "skipped";
      await recordEvent(client, "follow_up_skipped", {
        ...commonEventParams,
        followUpActive: true,
        leadId: job.lead_id,
        payload: { reason: "follow_up_timezone_required" },
      });
      return "cancelled";
    }

    // A previously scheduled job may run after the window closes. If its own
    // stored schedule was inside the configured window, process it once rather
    // than postponing it forever. This is evaluated only with an explicit IANA
    // timezone validated above.
    const jobScheduledAt = new Date(job.scheduled_at);
    const settingsForEval: typeof settings =
      settings.usarHorarioComercial && isWithinBusinessHours(jobScheduledAt, settings)
        ? { ...settings, usarHorarioComercial: false }
        : settings;

    const now = new Date();
    const lead = await loadLeadForFollowUp(client, job.tenant_id, job.remote_jid, job.lead_id);

    const guard = await canAgentAutoContactLead({
      sb: client,
      tenantId: job.tenant_id,
      agentId: job.agent_id,
      leadId: lead?.id ?? job.lead_id,
      phone: phoneFromRemoteJid(job.remote_jid),
      remoteJid: job.remote_jid,
      journeyId: job.journey_id,
      connectionId: authorizedJourney?.connectionId,
      triggerSource: "follow_up_job",
    });
    if (!guard.ok) {
      const finished = await finishClaimedFollowUpJob({
        sb: client,
        job,
        status: "cancelled",
        lastError: guard.reason,
      });
      if (!finished.ok) return "skipped";
      if (lead?.id) {
        await client
          .from("leads")
          .update({
            follow_up_status: "blocked",
            follow_up_blocked_reason: guard.reason,
            updated_at: now.toISOString(),
          })
          .eq("id", lead.id);
      }
      await recordEvent(client, "follow_up_skipped", {
        ...commonEventParams,
        followUpActive: settings.ativo,
        leadId: lead?.id ?? guard.leadId,
        payload: { reason: guard.reason, form_id: guard.formId },
      });
      logFollowUp("blocked_auto_contact_guard", {
        job_id: job.id,
        tenant_id: job.tenant_id,
        agent_id: job.agent_id,
        lead_id: lead?.id ?? guard.leadId,
        form_id: guard.formId,
        reason: guard.reason,
      });
      return "cancelled";
    }

    const evalCtx = await buildFollowUpEvalContext({
      sb: client,
      tenantId: job.tenant_id,
      agentId: job.agent_id,
      remoteJid: job.remote_jid,
      settings: settingsForEval,
      job: {
        id: job.id,
        attempts: job.attempts,
        maxAttempts: job.max_attempts,
        createdAt: new Date(job.created_at),
      },
      leadId: job.lead_id,
      loadLead: loadLeadForFollowUp,
      loadConversationState: loadConversationStateForJob,
      loadMessageTimestamps,
    });

    const retomadaTimeoutMs =
      settingsForEval.retomadaHumanoTempoValor != null
        ? retomadaHumanoMs(
            settingsForEval.retomadaHumanoTempoValor,
            settingsForEval.retomadaHumanoTempoUnidade ?? "horas",
          )
        : null;
    const retomadaTimeoutEsgotado =
      isHumanAbandonedJob &&
      settingsForEval.retomadaApenasSeHumanoAbandonou &&
      evalCtx.lastHumanOutboundAt != null &&
      retomadaTimeoutMs != null &&
      now.getTime() - evalCtx.lastHumanOutboundAt.getTime() >= retomadaTimeoutMs;

    // O timeout nunca devolve uma conversa humana à IA. A retomada exige ação
    // explícita no painel e revalidação da jornada original.
    if (retomadaTimeoutEsgotado) {
      logFollowUp("retomada_requires_manual_return", { job_id: job.id });
    }

    const decision: FollowUpDecision = evaluateFollowUpNeed(evalCtx);
    logFollowUp("retomada_debug", {
      job_id: job.id,
      humanPaused: evalCtx.conversationState?.humanPaused ?? false,
      lastHumanOutboundAt: evalCtx.lastHumanOutboundAt?.toISOString() ?? null,
      timeoutMs: retomadaTimeoutMs,
      retomadaTimeoutEsgotado,
      decision: {
        shouldSend: decision.shouldSend,
        reason: decision.reason,
        skipReason: decision.skipReason,
      },
    });

    await recordEvent(client, "follow_up_evaluated", {
      ...commonEventParams,
      followUpActive: settings.ativo,
      leadId: lead?.id,
      payload: {
        shouldSend: decision.shouldSend,
        reason: decision.reason,
        skipReason: decision.skipReason,
        followUpType: decision.followUpType,
        priority: decision.priority,
        urgency: decision.urgency,
        attempts: job.attempts,
      },
    });

    // ── handle skips ─────────────────────────────────────────────────────────
    if (!decision.shouldSend) {
      const skipReason = decision.skipReason ?? "engine_skip";
      if (
        isHumanAbandonedJob &&
        settingsForEval.retomadaApenasSeHumanoAbandonou &&
        evalCtx.lastHumanOutboundAt == null
      ) {
        const retryAt = new Date(
          now.getTime() + Math.max(1, settingsForEval.intervaloVerificacaoMinutos) * 60_000,
        );
        const finished = await finishClaimedFollowUpJob({
          sb: client,
          job,
          status: "pending",
          scheduledAt: retryAt,
          lastError: "waiting_human_outbound",
        });
        if (!finished.ok) return "skipped";
        logFollowUp("waiting_human_outbound", {
          job_id: job.id,
          tenant_id: job.tenant_id,
          retry_at: retryAt.toISOString(),
        });
        return "skipped";
      }

      // Cooldown is a temporary operator-configured gate, not a terminal
      // rejection. Keep the same attempt pending until the exact end of the
      // effective cooldown instead of cancelling the entire follow-up chain.
      if (decision.cooldownActive && decision.nextRetryAt) {
        const finished = await finishClaimedFollowUpJob({
          sb: client,
          job,
          status: "pending",
          scheduledAt: decision.nextRetryAt,
          lastError: "rescheduled_cooldown",
        });
        if (!finished.ok) return "skipped";
        if (lead?.id) {
          await client
            .from("leads")
            .update({
              follow_up_status: "scheduled",
              follow_up_blocked_reason: null,
              follow_up_scheduled_at: decision.nextRetryAt.toISOString(),
              updated_at: now.toISOString(),
            })
            .eq("tenant_id", job.tenant_id)
            .eq("id", lead.id);
        }
        await recordEvent(client, "cooldown_active", {
          ...commonEventParams,
          followUpActive: settings.ativo,
          leadId: lead?.id,
          payload: {
            reason: skipReason,
            nextRetryAt: decision.nextRetryAt.toISOString(),
          },
        });
        logFollowUp("rescheduled_cooldown", {
          job_id: job.id,
          tenant_id: job.tenant_id,
          retry_at: decision.nextRetryAt.toISOString(),
        });
        return "skipped";
      }

      if (lead?.id) {
        await client
          .from("leads")
          .update({
            follow_up_status: "blocked",
            follow_up_blocked_reason: skipReason,
            updated_at: now.toISOString(),
          })
          .eq("id", lead.id);
      }

      if (decision.humanBlocked) {
        await recordEvent(client, "follow_up_blocked_by_human", {
          ...commonEventParams,
          followUpActive: settings.ativo,
          leadId: lead?.id,
          payload: { reason: skipReason },
        });
      }
      if (decision.cooldownActive || decision.spamRisk) {
        await recordEvent(client, "cooldown_active", {
          ...commonEventParams,
          followUpActive: settings.ativo,
          leadId: lead?.id,
          payload: { reason: skipReason },
        });
      }
      if (decision.businessHoursBlocked) {
        await recordEvent(client, "business_hours_skipped", {
          ...commonEventParams,
          followUpActive: settings.ativo,
          leadId: lead?.id,
          payload: { nextRetryAt: decision.nextRetryAt?.toISOString(), reason: skipReason },
        });
        // Reschedule for next business window
        if (decision.nextRetryAt) {
          const finished = await finishClaimedFollowUpJob({
            sb: client,
            job,
            status: "pending",
            scheduledAt: decision.nextRetryAt,
            lastError: "rescheduled_business_hours",
          });
          if (!finished.ok) return "skipped";
          return "skipped";
        }
      }
      if (skipReason === "customer_replied") {
        await recordEvent(client, "customer_replied", {
          ...commonEventParams,
          followUpActive: settings.ativo,
          leadId: lead?.id,
          payload: {},
        });
      }

      // Reagendar para o momento exato do timeout em vez de cancelar.
      // Quando Gate 5 ou Gate 10 bloqueiam mas o timeout ainda não esgotou,
      // reancoramos o job a lastHumanOutboundAt + timeoutMs para garantir que o
      // engine reavalie no momento correto, independente do caminho de handoff.
      if (
        (skipReason === "human_paused" || skipReason === "humano_nao_abandonou_ainda") &&
        settingsForEval.retomadaApenasSeHumanoAbandonou &&
        settingsForEval.retomadaHumanoTempoValor != null &&
        evalCtx.lastHumanOutboundAt != null
      ) {
        const rawValor = settingsForEval.retomadaHumanoTempoValor;
        const rawUnidade = settingsForEval.retomadaHumanoTempoUnidade ?? "horas";
        const ms = retomadaHumanoMs(rawValor, rawUnidade);
        const retomadaAt = new Date(evalCtx.lastHumanOutboundAt.getTime() + ms);
        const finished = await finishClaimedFollowUpJob({
          sb: client,
          job,
          status: "pending",
          scheduledAt: retomadaAt,
          lastError: "rescheduled_retomada_humano",
        });
        if (!finished.ok) return "skipped";
        await recordEvent(client, "follow_up_rescheduled_retomada", {
          ...commonEventParams,
          followUpActive: settings.ativo,
          leadId: lead?.id,
          payload: { retomadaAt: retomadaAt.toISOString(), reason: skipReason },
        });
        logFollowUp("rescheduled_retomada_humano", {
          job_id: job.id,
          tenant_id: job.tenant_id,
          retomada_at: retomadaAt.toISOString(),
        });
        return "skipped";
      }

      const finished = await finishClaimedFollowUpJob({
        sb: client,
        job,
        status: "cancelled",
        lastError: skipReason,
      });
      if (!finished.ok) return "skipped";

      logFollowUp("skipped", { job_id: job.id, skip_reason: skipReason });

      await recordEvent(client, "follow_up_skipped", {
        ...commonEventParams,
        followUpActive: settings.ativo,
        leadId: lead?.id,
        payload: { reason: skipReason },
      });
      return "cancelled";
    }

    // ── SLA breach flag ───────────────────────────────────────────────────────
    if (decision.followUpType === "sla_breach" && lead?.id && !lead.sla_breached_at) {
      await client
        .from("leads")
        .update({ sla_breached_at: now.toISOString(), updated_at: now.toISOString() })
        .eq("id", lead.id);
      await recordEvent(client, "sla_breached", {
        ...commonEventParams,
        followUpActive: settings.ativo,
        leadId: lead.id,
        payload: {
          sla_hours: settings.slaHorasResposta,
          follow_up_type: decision.followUpType,
        },
      });
    }

    // ── automation gate obrigatório; configuração nunca ignora takeover ─────
    {
      const automationAllowed = await isAgentAutomationAllowed({
        sb: client,
        tenantId: job.tenant_id,
        remoteJid: job.remote_jid,
        agentId: job.agent_id,
      });
      if (!automationAllowed.ok) {
      const finished = await finishClaimedFollowUpJob({
        sb: client,
        job,
        status: "cancelled",
        lastError: automationAllowed.reason,
      });
      if (!finished.ok) return "skipped";
      await recordEvent(client, "follow_up_blocked_by_human", {
        ...commonEventParams,
        followUpActive: settings.ativo,
        leadId: lead?.id,
        payload: { reason: automationAllowed.reason },
      });
      logFollowUp("cancelled_automation", {
        job_id: job.id,
        reason: automationAllowed.reason,
      });
      return "cancelled";
      }
    }

    // Follow-up convencional aguarda enquanto houver compromisso futuro ativo.
    // Jobs de retomada humana possuem lifecycle próprio e não passam por este gate.
    if (!isHumanAbandonedJob) {
      const activeAgendaEvent = await findNextActiveAgendaEvent({
        sb: client,
        tenantId: job.tenant_id,
        remoteJid: job.remote_jid,
      });
      if (activeAgendaEvent) {
        const retryAt = new Date(
          now.getTime() + Math.max(1, settings.intervaloVerificacaoMinutos) * 60_000,
        );
        const finished = await finishClaimedFollowUpJob({
          sb: client,
          job,
          status: "pending",
          scheduledAt: retryAt,
          lastError: "active_agenda_event",
        });
        if (!finished.ok) return "skipped";
        logFollowUp("rescheduled_active_agenda_event", {
          job_id: job.id,
          tenant_id: job.tenant_id,
          event_id: activeAgendaEvent.id,
          retry_at: retryAt.toISOString(),
        });
        return "skipped";
      }
    }

    // ── build AI prompt ───────────────────────────────────────────────────────
    const followUpInstruction = buildFollowUpAiInstruction({
      decision,
      leadName: lead?.name ?? null,
      settings,
      attemptNumber: job.attempts,
    });

    if (!(await heartbeatFollowUpJob(client, job))) return "skipped";
    const aiResult = await generateAgentResponse({
      tenantId: job.tenant_id,
      agentId: job.agent_id,
      conversationId: job.remote_jid,
      journeyId: job.journey_id,
      customerId: job.remote_jid,
      feature: "agent_chat",
      contextSources: {
        whatsappHistory: settings.usarHistoricoWhatsapp,
        includeCrm: settings.usarHistoricoCrm,
        includeMetaForm: settings.usarDadosFormularioMeta,
      },
      // O gerador carrega o histórico canônico uma vez conforme contextSources.
      // Somente a instrução deste turno é obrigatória; reenviar o histórico
      // aqui duplicaria o contexto e poderia causar overflow artificial.
      messages: [{ role: "user", content: followUpInstruction }],
    });
    if (!(await heartbeatFollowUpJob(client, job))) return "skipped";

    if (isAgentMissingInstructionsResult(aiResult)) {
      const finished = await finishClaimedFollowUpJob({
        sb: client,
        job,
        status: "cancelled",
        lastError: "agent_missing_instructions",
      });
      if (!finished.ok) return "skipped";
      await recordEvent(client, "follow_up_failed", {
        ...commonEventParams,
        followUpActive: settings.ativo,
        leadId: lead?.id,
        payload: { reason: "agent_missing_instructions" },
      });
      logFollowUp("cancelled_agent_missing_instructions", {
        job_id: job.id,
        tenant_id: job.tenant_id,
        agent_id: job.agent_id,
      });
      return "cancelled";
    }
    if (!aiResult.ok) {
      const failedAttempts = job.attempts + 1;
      const isExhausted = failedAttempts >= job.max_attempts;
      const generationError = `agent_generation_failed:${aiResult.code}`;
      const retryAt = new Date(
        now.getTime() + Math.max(1, settings.intervaloVerificacaoMinutos) * 60_000,
      );
      const finished = await finishClaimedFollowUpJob({
        sb: client,
        job,
        status: isExhausted ? "exhausted" : "pending",
        attempts: failedAttempts,
        scheduledAt: isExhausted ? null : retryAt,
        lastError: generationError,
      });
      if (!finished.ok) return "skipped";
      await recordEvent(client, "follow_up_failed", {
        ...commonEventParams,
        followUpActive: settings.ativo,
        leadId: lead?.id,
        payload: {
          reason: generationError,
          attempts: failedAttempts,
          exhausted: isExhausted,
        },
      });
      return "failed";
    }
    const safeReply = safeFollowUpReplyFromResult(aiResult);
    if (!safeReply.ok) {
      const failedAttempts = job.attempts + 1;
      const isExhausted = failedAttempts >= job.max_attempts;
      const retryAt = new Date(
        now.getTime() + Math.max(1, settings.intervaloVerificacaoMinutos) * 60_000,
      );
      const finished = await finishClaimedFollowUpJob({
        sb: client,
        job,
        status: isExhausted ? "exhausted" : "pending",
        attempts: failedAttempts,
        scheduledAt: isExhausted ? null : retryAt,
        lastError: safeReply.reason,
      });
      if (!finished.ok) return "skipped";
      await recordEvent(client, "follow_up_failed", {
        ...commonEventParams,
        followUpActive: settings.ativo,
        leadId: lead?.id,
        payload: {
          reason: safeReply.reason,
          attempts: failedAttempts,
          exhausted: isExhausted,
        },
      });
      return "failed";
    }
    const replyText = safeReply.reply;

    // ── resolve exact outbound transport ─────────────────────────────────────
    const authorizedConnectionId = authorizedJourney?.connectionId ?? null;
    if (!authorizedConnectionId) {
      const finished = await finishClaimedFollowUpJob({
        sb: client,
        job,
        status: "cancelled",
        lastError: "missing_authorized_connection",
      });
      if (!finished.ok) return "skipped";
      await recordEvent(client, "follow_up_failed", {
        ...commonEventParams,
        followUpActive: settings.ativo,
        leadId: lead?.id,
        payload: { reason: "missing_authorized_connection" },
      });
      return "failed";
    }

    // O claim v2 já exigiu e validou a identidade omnichannel exata antes da
    // geração. Não faça uma segunda resolução de provedor aqui: além de
    // redundante, ela reabria um union impossível e poderia observar outro
    // estado entre autorização e despacho.
    const transport = authorizedTransport;
    if (!transport) {
      const finished = await finishClaimedFollowUpJob({
        sb: client,
        job,
        status: "cancelled",
        lastError: "missing_authorized_transport",
      });
      if (!finished.ok) return "skipped";
      await recordEvent(client, "follow_up_failed", {
        ...commonEventParams,
        followUpActive: settings.ativo,
        leadId: lead?.id,
        payload: { reason: "missing_authorized_transport" },
      });
      return "failed";
    }

    const number = job.remote_jid.replace(/\D/g, "");
    if (!number || (transport.channel === "evolution" && !remoteJidToEvoNumber(job.remote_jid))) {
      const finished = await finishClaimedFollowUpJob({
        sb: client,
        job,
        status: "cancelled",
        lastError: "invalid_remote_jid",
      });
      if (!finished.ok) return "skipped";
      return "failed";
    }

    if (!authorizedJourney?.id) {
      const finished = await finishClaimedFollowUpJob({
        sb: client,
        job,
        status: "cancelled",
        lastError: "missing_authorized_journey",
      });
      return finished.ok ? "cancelled" : "skipped";
    }
    if (!(await heartbeatFollowUpJob(client, job))) return "skipped";

    // The operator may disable or edit follow-up while the model is running.
    // Re-read the normalized configuration at the last safe point before the
    // outbox/provider boundary so stale generated content can never be sent.
    const liveConfiguration = await loadFollowUpRuntimeConfiguration({
      sb: client,
      tenantId: job.tenant_id,
      agentId: job.agent_id,
    });
    if (!liveConfiguration.ok) {
      if (liveConfiguration.reason === "agent_configuration_unavailable") {
        throw new Error(liveConfiguration.reason);
      }
      const finished = await finishClaimedFollowUpJob({
        sb: client,
        job,
        status: "cancelled",
        lastError: liveConfiguration.reason,
      });
      return finished.ok ? "cancelled" : "skipped";
    }
    if (!liveConfiguration.settings.ativo) {
      const finished = await finishClaimedFollowUpJob({
        sb: client,
        job,
        status: "cancelled",
        lastError: "follow_up_disabled_before_outbound",
      });
      return finished.ok ? "cancelled" : "skipped";
    }
    if (liveConfiguration.fingerprint !== initialConfiguration.fingerprint) {
      const retryAt = new Date(
        Date.now() +
          Math.max(1, liveConfiguration.settings.intervaloVerificacaoMinutos) * 60_000,
      );
      const finished = await finishClaimedFollowUpJob({
        sb: client,
        job,
        status: "pending",
        scheduledAt: retryAt,
        lastError: "follow_up_configuration_changed",
      });
      if (!finished.ok) return "skipped";
      logFollowUp("configuration_changed_before_outbound", {
        job_id: job.id,
        tenant_id: job.tenant_id,
        retry_at: retryAt.toISOString(),
      });
      return "skipped";
    }

    const stateBeforeOutbound = await loadConversationStateForJob(
      client,
      job.tenant_id,
      job.remote_jid,
    );
    if (
      !stateBeforeOutbound ||
      stateBeforeOutbound.humanPaused ||
      stateBeforeOutbound.conversationMode !== "automation" ||
      stateBeforeOutbound.automationEpoch !== job.automation_epoch
    ) {
      const finished = await finishClaimedFollowUpJob({
        sb: client,
        job,
        status: "cancelled",
        lastError: "automation_epoch_stale_before_outbound",
      });
      if (!finished.ok) return "skipped";
      return "cancelled";
    }
    const outbound = await prepareAutomatedOutbound({
      sb: client,
      operationKey: `follow-up:${job.id}:${job.attempts + 1}`,
      tenantId: job.tenant_id,
      remoteJid: job.remote_jid,
      agentId: job.agent_id,
      journeyId: authorizedJourney?.id ?? job.journey_id,
      ruleId: job.rule_id!,
      connectionId: transport.connectionId,
      channel: transport.channel,
      kind: "text",
      content: replyText.slice(0, 4000),
      leadId: lead?.id ?? null,
    });
    const alreadySent = outbound.action === "already_sent";
    outboundDeliveryCommitted = alreadySent;
    if (!alreadySent && outbound.action !== "send") {
      const finished = await finishClaimedFollowUpJob({
        sb: client,
        job,
        status: "cancelled",
        lastError:
          outbound.action === "blocked"
            ? `authorization_blocked:${outbound.reason}`
            : `outbound_${outbound.action}`,
      });
      if (!finished.ok) return "skipped";
      return "cancelled";
    }
    if (!alreadySent && outbound.action === "send") {
      if (!(await heartbeatFollowUpJob(client, job))) {
        await markAgentOutboundFailed({
          sb: client,
          id: outbound.id,
          claimToken: outbound.claimToken,
          error: "follow_up_claim_lost_before_provider",
        });
        return "skipped";
      }
      const stateAtProviderBoundary = await loadConversationStateForJob(
        client,
        job.tenant_id,
        job.remote_jid,
      );
      if (
        !stateAtProviderBoundary ||
        stateAtProviderBoundary.humanPaused ||
        stateAtProviderBoundary.conversationMode !== "automation" ||
        stateAtProviderBoundary.automationEpoch !== job.automation_epoch
      ) {
        await markAgentOutboundFailed({
          sb: client,
          id: outbound.id,
          claimToken: outbound.claimToken,
          error: "automation_epoch_stale_at_provider_boundary",
        });
        const finished = await finishClaimedFollowUpJob({
          sb: client,
          job,
          status: "cancelled",
          lastError: "automation_epoch_stale_at_provider_boundary",
        });
        return finished.ok ? "cancelled" : "skipped";
      }
      const boundaryMessages = await loadMessageTimestamps(
        client,
        job.tenant_id,
        job.remote_jid,
      );
      if (
        boundaryMessages.lastCustomerMessageAt &&
        boundaryMessages.lastCustomerMessageAt > new Date(job.created_at)
      ) {
        await markAgentOutboundFailed({
          sb: client,
          id: outbound.id,
          claimToken: outbound.claimToken,
          error: "customer_replied_before_provider",
        });
        const finished = await finishClaimedFollowUpJob({
          sb: client,
          job,
          status: "cancelled",
          lastError: "customer_replied_before_provider",
        });
        return finished.ok ? "cancelled" : "skipped";
      }
      const send = transport.channel === "meta_cloud"
        ? await sendWhatsAppTextMessage({
            toWaId: number,
            text: replyText.slice(0, 4000),
            phoneNumberId: transport.connection.phone_number_id,
            accessToken: transport.connection.access_token,
          })
        : await evolutionSendText({
            instanceName: transport.instance.instance_name,
            number: remoteJidToEvoNumber(job.remote_jid)!,
            text: replyText.slice(0, 4000),
          });

      if (!send.ok) {
        const sendError = send.error || `${transport.channel}_follow_up_send_failed`;
        await markAgentOutboundFailed({
          sb: client,
          id: outbound.id,
          claimToken: outbound.claimToken,
          error: sendError,
        });
        const failedAttempts = job.attempts + 1;
        const isExhausted = failedAttempts >= job.max_attempts;
        const retryAt = new Date(
          now.getTime() + Math.max(1, settings.intervaloVerificacaoMinutos) * 60_000,
        );
        const finished = await finishClaimedFollowUpJob({
          sb: client,
          job,
          status: isExhausted ? "exhausted" : "pending",
          attempts: failedAttempts,
          scheduledAt: isExhausted ? null : retryAt,
          lastError: sendError,
        });
        if (!finished.ok) return "skipped";
        await recordEvent(client, "follow_up_failed", {
          ...commonEventParams,
          followUpActive: settings.ativo,
          leadId: lead?.id,
          payload: { error: sendError, attempts: failedAttempts, exhausted: isExhausted },
        });
        logFollowUp("send_failed", {
          job_id: job.id,
          channel: transport.channel,
          error: sendError,
          attempts: failedAttempts,
          exhausted: isExhausted,
        });
        return "failed";
      }
      const evolutionReceipt = transport.channel === "evolution"
        ? extractEvolutionSendReceipt("data" in send ? send.data : null)
        : null;
      const providerId = transport.channel === "meta_cloud"
        ? ("messageId" in send ? send.messageId ?? null : null)
        : evolutionReceipt?.messageId ?? null;
      await finalizeAgentOutboundDelivery({
        sb: client,
        id: outbound.id,
        claimToken: outbound.claimToken,
        providerMessageId: providerId,
        kind: "text",
        content: replyText,
        providerRemoteJid: evolutionReceipt?.remoteJid ?? null,
        providerStatus: evolutionReceipt?.providerStatus ?? null,
        deliveryStatus: evolutionReceipt?.deliveryStatus ?? "sent",
      });
      outboundDeliveryCommitted = true;

      // If the database lease was lost while the provider call was in flight,
      // the durable outbox remains the source of truth. A new worker will see
      // `already_sent` and finish the job without dispatching again.
      if (!(await heartbeatFollowUpJob(client, job))) return "skipped";

    }

    const journeyRenewed = await touchLeadJourney({
      sb: client,
      tenantId: job.tenant_id,
      journeyId: authorizedJourney.id,
      leadId: lead?.id ?? job.lead_id,
      occurredAt: now.toISOString(),
    });
    if (!journeyRenewed) {
      throw new Error("journey_activity_renewal_failed_after_send");
    }

    const nextAttempts = job.attempts + 1;
    const exhausted = nextAttempts >= job.max_attempts;
    const nextScheduled = exhausted
      ? null
      : new Date(
          now.getTime() + settings.intervaloVerificacaoMinutos * 60_000,
        );
    const completion = await finishClaimedFollowUpJob({
      sb: client,
      job,
      status: exhausted ? "exhausted" : "sent",
      attempts: nextAttempts,
      followUpType: decision.followUpType,
      priority: decision.priority,
      lastError: null,
      nextScheduledAt: nextScheduled,
    });
    if (!completion.ok) return "skipped";

    if (lead?.id) {
      const cooldownUntil = new Date(
        now.getTime() + settings.cooldownMinutos * 60_000,
      );
      await client
        .from("leads")
        .update({
          follow_up_count: (lead.follow_up_count ?? 0) + 1,
          last_follow_up_at: now.toISOString(),
          follow_up_status: nextAttempts >= job.max_attempts ? "exhausted" : "active",
          follow_up_blocked_reason: null,
          follow_up_cooldown_until:
            settings.cooldownAtivo ? cooldownUntil.toISOString() : null,
          updated_at: now.toISOString(),
        })
        .eq("id", lead.id);
    }

    // O follow-up saiu: se o dono do agente configurou, o card avisa o vendedor
    // que este lead parou de responder. Esgotou tudo? o move do esgotamento
    // (logo abaixo) é quem vale — não este.
    if (lead?.id && nextAttempts < job.max_attempts) {
      await applyAgentCrmMove({
        sb: client,
        tenantId: job.tenant_id,
        action: "follow_up_sent",
        agentId: job.agent_id,
        leadId: lead.id,
      });
    }

    await recordEvent(client, "follow_up_sent", {
      ...commonEventParams,
      followUpActive: settings.ativo,
      leadId: lead?.id,
      payload: {
        attempt: nextAttempts,
        follow_up_type: decision.followUpType,
        urgency: decision.urgency,
        priority: decision.priority,
        model: aiResult.ok ? aiResult.model : null,
      },
    });

    // ── reschedule or exhaust ─────────────────────────────────────────────────
    if (exhausted) {
      if (lead?.id) {
        await client
          .from("leads")
          .update({
            follow_up_scheduled_at: null,
            follow_up_status: settings.desativarAposEncerrar ? "inactive" : "exhausted",
            follow_up_blocked_reason: null,
            updated_at: now.toISOString(),
          })
          .eq("id", lead.id);
      }
      // Todas as tentativas foram usadas e o lead nunca respondeu. Se o dono do
      // agente configurou, o card sai da fila ativa do vendedor. Depois do
      // update de status acima, para que um retorno do lead já seja lido como
      // "voltou depois de esgotado".
      if (lead?.id) {
        await applyAgentCrmMove({
          sb: client,
          tenantId: job.tenant_id,
          action: "follow_up_exhausted",
          agentId: job.agent_id,
          leadId: lead.id,
        });
      }

      await recordEvent(client, "follow_up_exhausted", {
        ...commonEventParams,
        followUpActive: settings.ativo,
        leadId: lead?.id,
        payload: { attempts: nextAttempts },
      });
      logFollowUp("exhausted", { job_id: job.id, attempts: nextAttempts });
      return "exhausted";
    }

    if (!nextScheduled) {
      // The branch above is the only valid null case. Keep this assertion
      // fail-closed if a future refactor changes the scheduling contract.
      throw new Error("follow_up_next_schedule_missing");
    }

    if (lead?.id) {
      await client
        .from("leads")
        .update({
          follow_up_scheduled_at: nextScheduled.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("id", lead.id);
    }

    logFollowUp("sent", {
      job_id: job.id,
      attempts: nextAttempts,
      follow_up_type: decision.followUpType,
      urgency: decision.urgency,
      history_enabled: settings.usarHistoricoWhatsapp,
      next_scheduled_at: nextScheduled.toISOString(),
    });
    return "sent";
  } catch (error) {
    const message = error instanceof Error ? error.message : "process_failed";
    if (outboundDeliveryCommitted) {
      // Keep the same attempt number and operation key. The next worker sees
      // the durable outbox as already_sent, repairs the post-send state and
      // can never dispatch a duplicate provider message.
      const retryAt = new Date(Date.now() + 5 * 60_000);
      const finished = await finishClaimedFollowUpJob({
        sb: client,
        job,
        status: "pending",
        attempts: job.attempts,
        scheduledAt: retryAt,
        lastError: message,
      });
      if (!finished.ok) return "skipped";
      await recordEvent(client, "follow_up_failed", {
        ...commonEventParams,
        followUpActive: followUpIsActive,
        payload: {
          error: message,
          attempts: job.attempts,
          provider_delivery_committed: true,
        },
      });
      logFollowUp("post_delivery_repair_scheduled", {
        job_id: jobId,
        error: message,
        retry_at: retryAt.toISOString(),
      });
      return "failed";
    }
    const failedAttempts = job.attempts + 1;
    const isExhausted = failedAttempts >= job.max_attempts;
    const retryAt = new Date(Date.now() + 5 * 60_000);
    const finished = await finishClaimedFollowUpJob({
      sb: client,
      job,
      status: isExhausted ? "exhausted" : "pending",
      attempts: failedAttempts,
      scheduledAt: isExhausted ? null : retryAt,
      lastError: message,
    });
    if (!finished.ok) return "skipped";
    await recordEvent(client, "follow_up_failed", {
      ...commonEventParams,
      followUpActive: followUpIsActive,
      payload: { error: message, attempts: failedAttempts, exhausted: isExhausted },
    });
    logFollowUp("process_error", { job_id: jobId, error: message, attempts: failedAttempts, exhausted: isExhausted });
    return "failed";
  }
}

export async function processDueFollowUpJobs(sb?: SupabaseServiceClient): Promise<{
  processed: number;
  sent: number;
  cancelled: number;
  exhausted: number;
  failed: number;
}> {
  const client = sb ?? createSupabaseServiceClient();
  const { error: reconcileError } = await client.rpc(
    "reconcile_agent_runtime_state_v1",
    { p_limit: 500 },
  );
  if (reconcileError) {
    logFollowUp("runtime_reconciliation_failed", {
      error: reconcileError.message,
    });
  }
  await reclaimStuckFollowUpJobs(client);
  const { data, error } = await client.rpc("claim_follow_up_jobs_v2", {
    p_limit: FOLLOW_UP_BATCH_LIMIT,
    p_claim_seconds: Math.floor(FOLLOW_UP_CLAIM_TTL_MS / 1000),
  });
  if (error) {
    logFollowUp("batch_claim_failed", { error: error.message });
    return { processed: 0, sent: 0, cancelled: 0, exhausted: 0, failed: 0 };
  }
  const claimedJobs = (Array.isArray(data) ? data : [])
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"))
    .map(rowFromDb);

  const outcomes: Array<Awaited<ReturnType<typeof processFollowUpJob>>> = [];
  let cursor = 0;
  const workerCount = Math.min(FOLLOW_UP_PROCESS_CONCURRENCY, claimedJobs.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < claimedJobs.length) {
        const job = claimedJobs[cursor];
        cursor += 1;
        if (!job) continue;
        outcomes.push(await processFollowUpJob(job.id, client, job));
      }
    }),
  );

  return outcomes.reduce(
    (totals, outcome) => {
      if (outcome === "skipped") return totals;
      totals.processed += 1;
      if (outcome === "sent") totals.sent += 1;
      if (outcome === "cancelled") totals.cancelled += 1;
      if (outcome === "exhausted") totals.exhausted += 1;
      if (outcome === "failed") totals.failed += 1;
      return totals;
    },
    { processed: 0, sent: 0, cancelled: 0, exhausted: 0, failed: 0 },
  );
}
