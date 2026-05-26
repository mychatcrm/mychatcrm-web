import { generateAgentResponse } from "@/lib/ai/generate-agent-response";
import { evolutionSendText, remoteJidToEvoNumber } from "@/lib/integrations/evolution-api";
import type { AgentFollowUpInteligente } from "@/lib/types";
import { phoneFromRemoteJid } from "@/lib/server/auto-lead-upsert";
import { isAgentAutomationAllowed } from "@/lib/server/conversation-operation";
import {
  conversationMessagesToAi,
  getRecentConversationMessages,
} from "@/lib/server/conversation-memory";
import { followUpInteligenteFromMetadata } from "@/lib/server/follow-up-settings";
import { getEvolutionInstanceByTenantId } from "@/lib/server/tenant-evolution-instance-db";
import { canAgentAutoContactLead } from "@/lib/server/agent-auto-contact-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  buildFollowUpAiInstruction,
  evaluateFollowUpNeed,
  isWithinBusinessHours,
  type FollowUpDecision,
} from "@/lib/server/follow-up-engine";
import { buildFollowUpEvalContext } from "@/lib/server/follow-up-evaluate";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type FollowUpJobRow = {
  id: string;
  tenant_id: string;
  agent_id: string;
  remote_jid: string;
  lead_id: string | null;
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

function rowFromDb(data: Record<string, unknown>): FollowUpJobRow {
  return {
    id: String(data.id),
    tenant_id: String(data.tenant_id),
    agent_id: String(data.agent_id),
    remote_jid: String(data.remote_jid),
    lead_id: typeof data.lead_id === "string" ? data.lead_id : null,
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

// ─── outbound helper ─────────────────────────────────────────────────────────

async function saveOutboundFollowUp(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  agentId: string;
  content: string;
  leadId?: string | null;
}): Promise<void> {
  await params.sb.from("whatsapp_messages").insert({
    tenant_id: params.tenantId,
    remote_jid: params.remoteJid,
    direction: "outbound",
    kind: "text",
    content: params.content.slice(0, 4000),
    agent_id: params.agentId,
    lead_id: params.leadId ?? null,
  });
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
      if (row.agent_id) {
        if (!lastAgentMessageAt) lastAgentMessageAt = ts;
      } else {
        if (!lastHumanOutboundAt) lastHumanOutboundAt = ts;
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
} | null> {
  const { data } = await sb
    .from("conversation_states")
    .select("human_paused,paused_reason,handoff_suggested,conversation_mode,archived_at")
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
  };
}

// ─── public exports ──────────────────────────────────────────────────────────

export async function cancelPendingFollowUpJobs(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  reason?: string;
}): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await params.sb
    .from("follow_up_jobs")
    .update({
      status: "cancelled",
      last_error: params.reason ?? "cancelled",
      updated_at: now,
    })
    .eq("tenant_id", params.tenantId)
    .eq("remote_jid", params.remoteJid)
    .eq("status", "pending")
    .select("id");
  if (error) {
    logFollowUp("cancel_failed", { tenant_id: params.tenantId, error: error.message });
    return 0;
  }
  const count = Array.isArray(data) ? data.length : 0;
  if (count > 0) logFollowUp("cancelled_pending", { tenant_id: params.tenantId, count });
  return count;
}

export async function scheduleFollowUpAfterInbound(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  remoteJid: string;
  leadId?: string | null;
  settings: AgentFollowUpInteligente;
}): Promise<string | null> {
  if (!params.settings.ativo) return null;

  const sb = params.sb ?? createSupabaseServiceClient();
  const now = new Date();
  const scheduledAt = new Date(
    now.getTime() + params.settings.intervaloVerificacaoMinutos * 60_000,
  );

  await cancelPendingFollowUpJobs({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    reason: "inbound_reset",
  });

  const guard = await canAgentAutoContactLead({
    sb,
    tenantId: params.tenantId,
    agentId: params.agentId,
    leadId: params.leadId,
    phone: phoneFromRemoteJid(params.remoteJid),
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

  const { data, error } = await sb
    .from("follow_up_jobs")
    .insert({
      tenant_id: params.tenantId,
      agent_id: params.agentId,
      remote_jid: params.remoteJid,
      lead_id: params.leadId ?? null,
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
): Promise<"sent" | "cancelled" | "exhausted" | "skipped" | "failed"> {
  const client = sb ?? createSupabaseServiceClient();
  const nowIso = new Date().toISOString();

  const { data: claimed, error: claimError } = await client
    .from("follow_up_jobs")
    .update({ status: "processing", updated_at: nowIso })
    .eq("id", jobId)
    .eq("status", "pending")
    .lte("scheduled_at", nowIso)
    .select("*")
    .maybeSingle();

  if (claimError) {
    logFollowUp("claim_failed", { job_id: jobId, error: claimError.message });
    return "failed";
  }
  if (!claimed) return "skipped";

  const job = rowFromDb(claimed as Record<string, unknown>);
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

  // Hoisted so the catch block can record events with the real activation state.
  // Starts false (safe default) and is set to settings.ativo once the agent row loads.
  let followUpIsActive = false;

  try {
    // ── check settings ───────────────────────────────────────────────────────
    const { data: agentRow } = await client
      .from("tenant_agents")
      .select("metadata")
      .eq("tenant_id", job.tenant_id)
      .eq("agent_id", job.agent_id)
      .maybeSingle();
    const metadata =
      agentRow?.metadata && typeof agentRow.metadata === "object"
        ? (agentRow.metadata as Record<string, unknown>)
        : {};
    const settings = followUpInteligenteFromMetadata(metadata);
    followUpIsActive = settings.ativo;

    // Quando o cron roda fora da janela comercial (ex: 4 AM UTC) e pega um job
    // que foi agendado para dentro da janela (ex: scheduled_at = 8 AM UTC do dia
    // anterior), o job deve ser processado normalmente — ele já foi "pré-qualificado"
    // para o horário correto. Sem esse bypass, o job entra em loop infinito:
    // o cron sempre rebloqueia e reagenda, nunca executando de fato.
    const jobScheduledAt = new Date(job.scheduled_at);
    const settingsForEval: typeof settings =
      settings.usarHorarioComercial && isWithinBusinessHours(jobScheduledAt, settings)
        ? { ...settings, usarHorarioComercial: false }
        : settings;

    if (!settings.ativo) {
      await client
        .from("follow_up_jobs")
        .update({
          status: "cancelled",
          last_error: "follow_up_disabled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      logFollowUp("skipped_disabled", { job_id: job.id, tenant_id: job.tenant_id });
      return "cancelled";
    }

    const now = new Date();
    const lead = await loadLeadForFollowUp(client, job.tenant_id, job.remote_jid, job.lead_id);

    const guard = await canAgentAutoContactLead({
      sb: client,
      tenantId: job.tenant_id,
      agentId: job.agent_id,
      leadId: lead?.id ?? job.lead_id,
      phone: phoneFromRemoteJid(job.remote_jid),
      triggerSource: "follow_up_job",
    });
    if (!guard.ok) {
      await client
        .from("follow_up_jobs")
        .update({
          status: "cancelled",
          last_error: guard.reason,
          updated_at: now.toISOString(),
        })
        .eq("id", job.id);
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

    const decision: FollowUpDecision = evaluateFollowUpNeed(evalCtx);

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
          await client
            .from("follow_up_jobs")
            .update({
              status: "pending",
              scheduled_at: decision.nextRetryAt.toISOString(),
              last_error: "rescheduled_business_hours",
              updated_at: now.toISOString(),
            })
            .eq("id", job.id);
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

      await client
        .from("follow_up_jobs")
        .update({
          status: "cancelled",
          last_error: skipReason,
          updated_at: now.toISOString(),
        })
        .eq("id", job.id);

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

    // ── automation gate (só quando respeitar humano ativo) ───────────────────
    if (settings.respeitarHumanoAtivo) {
      const automationAllowed = await isAgentAutomationAllowed({
        sb: client,
        tenantId: job.tenant_id,
        remoteJid: job.remote_jid,
        agentId: job.agent_id,
      });
      if (!automationAllowed.ok) {
      await client
        .from("follow_up_jobs")
        .update({
          status: "cancelled",
          last_error: automationAllowed.reason,
          updated_at: now.toISOString(),
        })
        .eq("id", job.id);
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

    // ── build AI prompt ───────────────────────────────────────────────────────
    const history = settings.usarHistoricoWhatsapp
      ? await getRecentConversationMessages({
          sb: client,
          tenantId: job.tenant_id,
          remoteJid: job.remote_jid,
          limit: 20,
        })
      : [];

    const followUpInstruction = buildFollowUpAiInstruction({
      decision,
      leadName: lead?.name ?? null,
      settings,
      attemptNumber: job.attempts,
    });

    const aiResult = await generateAgentResponse({
      tenantId: job.tenant_id,
      agentId: job.agent_id,
      conversationId: job.remote_jid,
      customerId: job.remote_jid,
      feature: "agent_chat",
      contextSources: {
        whatsappHistory: settings.usarHistoricoWhatsapp,
        includeCrm: settings.usarHistoricoCrm,
        includeMetaForm: settings.usarDadosFormularioMeta,
      },
      messages: [
        ...(settings.usarHistoricoWhatsapp ? conversationMessagesToAi(history) : []),
        { role: "user", content: followUpInstruction },
      ],
    });

    const replyText = aiResult.ok
      ? aiResult.text
      : "Oi! Passando para saber se ainda posso te ajudar com algo. Fico à disposição.";

    // ── send via Evolution ────────────────────────────────────────────────────
    const instance = await getEvolutionInstanceByTenantId(job.tenant_id);
    if (!instance?.instance_name) {
      await client
        .from("follow_up_jobs")
        .update({
          status: "cancelled",
          last_error: "missing_evolution_instance",
          updated_at: now.toISOString(),
        })
        .eq("id", job.id);
      await recordEvent(client, "follow_up_failed", {
        ...commonEventParams,
        followUpActive: settings.ativo,
        leadId: lead?.id,
        payload: { reason: "missing_evolution_instance" },
      });
      return "failed";
    }

    const number = remoteJidToEvoNumber(job.remote_jid);
    if (!number) {
      await client
        .from("follow_up_jobs")
        .update({
          status: "cancelled",
          last_error: "invalid_remote_jid",
          updated_at: now.toISOString(),
        })
        .eq("id", job.id);
      return "failed";
    }

    const send = await evolutionSendText({
      instanceName: instance.instance_name,
      number,
      text: replyText.slice(0, 4000),
    });

    if (!send.ok) {
      const failedAttempts = job.attempts + 1;
      const isExhausted = failedAttempts >= job.max_attempts;
      await client
        .from("follow_up_jobs")
        .update({
          status: isExhausted ? "exhausted" : "pending",
          attempts: failedAttempts,
          last_error: send.error,
          updated_at: now.toISOString(),
        })
        .eq("id", job.id);
      await recordEvent(client, "follow_up_failed", {
        ...commonEventParams,
        followUpActive: settings.ativo,
        leadId: lead?.id,
        payload: { error: send.error, attempts: failedAttempts, exhausted: isExhausted },
      });
      logFollowUp("send_failed", { job_id: job.id, error: send.error, attempts: failedAttempts, exhausted: isExhausted });
      return "failed";
    }

    // ── persist outbound + update lead ────────────────────────────────────────
    await saveOutboundFollowUp({
      sb: client,
      tenantId: job.tenant_id,
      remoteJid: job.remote_jid,
      agentId: job.agent_id,
      content: replyText,
      leadId: lead?.id ?? null,
    });

    const nextAttempts = job.attempts + 1;

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
    if (nextAttempts >= job.max_attempts) {
      await client
        .from("follow_up_jobs")
        .update({
          status: "exhausted",
          attempts: nextAttempts,
          follow_up_type: decision.followUpType,
          priority: decision.priority,
          last_error: null,
          updated_at: now.toISOString(),
        })
        .eq("id", job.id);
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
      await recordEvent(client, "follow_up_exhausted", {
        ...commonEventParams,
        followUpActive: settings.ativo,
        leadId: lead?.id,
        payload: { attempts: nextAttempts },
      });
      logFollowUp("exhausted", { job_id: job.id, attempts: nextAttempts });
      return "exhausted";
    }

    const nextScheduled = new Date(
      now.getTime() + settings.intervaloVerificacaoMinutos * 60_000,
    );

    await client
      .from("follow_up_jobs")
      .update({
        status: "sent",
        attempts: nextAttempts,
        follow_up_type: decision.followUpType,
        priority: decision.priority,
        last_error: null,
        updated_at: now.toISOString(),
      })
      .eq("id", job.id);

    const { error: rescheduleError } = await client.from("follow_up_jobs").insert({
      tenant_id: job.tenant_id,
      agent_id: job.agent_id,
      remote_jid: job.remote_jid,
      lead_id: lead?.id ?? null,
      scheduled_at: nextScheduled.toISOString(),
      attempts: nextAttempts,
      max_attempts: job.max_attempts,
      status: "pending",
      follow_up_type: "silence",
      priority: decision.priority,
    });

    if (rescheduleError) {
      logFollowUp("reschedule_failed", {
        job_id: job.id,
        error: rescheduleError.message,
      });
    } else if (lead?.id) {
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
      history_messages: history.length,
      next_scheduled_at: nextScheduled.toISOString(),
    });
    return "sent";
  } catch (error) {
    const message = error instanceof Error ? error.message : "process_failed";
    const failedAttempts = job.attempts + 1;
    const isExhausted = failedAttempts >= job.max_attempts;
    await client
      .from("follow_up_jobs")
      .update({
        status: isExhausted ? "exhausted" : "pending",
        attempts: failedAttempts,
        last_error: message,
        updated_at: nowIso,
      })
      .eq("id", jobId);
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
  const nowIso = new Date().toISOString();
  const { data } = await client
    .from("follow_up_jobs")
    .select("id")
    .eq("status", "pending")
    .lte("scheduled_at", nowIso)
    .order("priority", { ascending: true })
    .order("scheduled_at", { ascending: true })
    .limit(30);

  let processed = 0;
  let sent = 0;
  let cancelled = 0;
  let exhausted = 0;
  let failed = 0;

  for (const row of data ?? []) {
    const outcome = await processFollowUpJob(
      String((row as { id: string }).id),
      client,
    );
    if (outcome === "skipped") continue;
    processed += 1;
    if (outcome === "sent") sent += 1;
    if (outcome === "cancelled") cancelled += 1;
    if (outcome === "exhausted") exhausted += 1;
    if (outcome === "failed") failed += 1;
  }

  return { processed, sent, cancelled, exhausted, failed };
}
