import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  smartWaitFromMetadata,
  type AgentSmartWaitSettings,
} from "@/lib/agents/smart-wait-settings";
import {
  isJobReadyToProcess,
  isStaleBurstGenerationRow,
  maskRemoteJidForLog,
  sleep,
} from "@/lib/server/agent-response-schedule";
import {
  isAgentAutomationAllowed,
} from "@/lib/server/conversation-operation";
import { canAgentAutoContactLead } from "@/lib/server/agent-auto-contact-guard";
import { processAgentResponseJobByChannel } from "@/lib/server/agent-response-job-dispatcher";
import { getInternalApiToken, internalApiAuthHeaders } from "@/lib/server/internal-api-auth";
import { resumeAfterLeadOutcomeIfConfigured } from "@/lib/server/agent-lead-outcome";
import {
  authorizeActiveJourney,
  isJourneyIsolationEnabled,
} from "@/lib/server/lead-journeys";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

const STUCK_PROCESSING_MS = 5 * 60 * 1000;
const MAX_JOB_ATTEMPTS = 3;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AgentResponseJobRow = {
  id: string;
  tenant_id: string;
  lead_id: string | null;
  journey_id: string | null;
  rule_id: string | null;
  remote_jid: string;
  agent_id: string;
  instance_name: string;
  channel: "evolution" | "meta_cloud";
  connection_id: string | null;
  status: string;
  first_message_at: string;
  last_message_at: string;
  scheduled_for: string;
  max_wait_until: string;
  message_ids: string[];
  inbound_message_count: number;
  attempt_count: number;
  burst_generation: number;
  /** Monotonic sequence shared by every job/outbox operation in this conversation. */
  conversation_sequence?: number;
  provider_first_message_at?: string | null;
  provider_last_message_at?: string | null;
  is_late_fragment?: boolean;
  locked_at: string | null;
  claim_token: string | null;
  claim_expires_at: string | null;
  completed_at: string | null;
  failed_reason: string | null;
  created_at: string;
  updated_at: string;
};

function parseMessageIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && UUID_RE.test(item));
}

function rowFromDb(data: Record<string, unknown>): AgentResponseJobRow {
  return {
    id: String(data.id),
    tenant_id: String(data.tenant_id),
    lead_id: typeof data.lead_id === "string" ? data.lead_id : null,
    journey_id: typeof data.journey_id === "string" ? data.journey_id : null,
    rule_id: typeof data.rule_id === "string" ? data.rule_id : null,
    remote_jid: String(data.remote_jid),
    agent_id: String(data.agent_id),
    instance_name: String(data.instance_name),
    channel: data.channel === "meta_cloud" ? "meta_cloud" : "evolution",
    connection_id: typeof data.connection_id === "string" ? data.connection_id : null,
    status: String(data.status),
    first_message_at: String(data.first_message_at),
    last_message_at: String(data.last_message_at),
    scheduled_for: String(data.scheduled_for),
    max_wait_until: String(data.max_wait_until),
    message_ids: parseMessageIds(data.message_ids),
    inbound_message_count: Number(data.inbound_message_count ?? 1),
    attempt_count: Number(data.attempt_count ?? 0),
    burst_generation: Number(data.burst_generation ?? 1),
    conversation_sequence: Number(data.conversation_sequence ?? 0),
    provider_first_message_at: typeof data.provider_first_message_at === "string" ? data.provider_first_message_at : null,
    provider_last_message_at: typeof data.provider_last_message_at === "string" ? data.provider_last_message_at : null,
    is_late_fragment: data.is_late_fragment === true,
    locked_at: typeof data.locked_at === "string" ? data.locked_at : null,
    claim_token: typeof data.claim_token === "string" ? data.claim_token : null,
    claim_expires_at: typeof data.claim_expires_at === "string" ? data.claim_expires_at : null,
    completed_at: typeof data.completed_at === "string" ? data.completed_at : null,
    failed_reason: typeof data.failed_reason === "string" ? data.failed_reason : null,
    created_at: String(data.created_at),
    updated_at: String(data.updated_at),
  };
}

function logJobEvent(event: string, payload: Record<string, unknown>): void {
  console.info("[agent-response-jobs]", { event, ...payload });
}

function isTransientFailure(error: string): boolean {
  const e = error.toLowerCase();
  return (
    e.includes("evolution") ||
    e.includes("meta") ||
    e.includes("whatsapp") ||
    e.includes("timeout") ||
    e.includes("fetch") ||
    e.includes("network") ||
    e.includes("in_progress") ||
    e.includes("rate")
  );
}

export async function loadAgentSmartWaitSettings(
  sb: SupabaseServiceClient,
  tenantId: string,
  agentId: string,
): Promise<AgentSmartWaitSettings> {
  const { data } = await sb
    .from("tenant_agents")
    .select("metadata")
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .maybeSingle();
  const metadata =
    data?.metadata && typeof data.metadata === "object"
      ? (data.metadata as Record<string, unknown>)
      : {};
  return smartWaitFromMetadata(metadata);
}

export async function shouldScheduleAgentResponse(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  agentId: string;
  journeyId?: string | null;
  connectionId?: string | null;
  channel?: "evolution" | "meta_cloud";
}): Promise<{ ok: true; ruleId: string | null } | { ok: false; reason: string }> {
  let ruleId: string | null = null;
  if (isJourneyIsolationEnabled()) {
    if (!params.journeyId) return { ok: false, reason: "missing_active_journey" };
    const journey = await authorizeActiveJourney({
      sb: params.sb,
      tenantId: params.tenantId,
      remoteJid: params.remoteJid,
      preferredAgentId: params.agentId,
      connectionId: params.connectionId,
      channel: params.channel,
    });
    if (!journey.ok || journey.journey?.id !== params.journeyId) {
      return {
        ok: false,
        reason: journey.ok ? "journey_id_mismatch" : journey.reason,
      };
    }
    ruleId = journey.journey.ruleId;
    if (!ruleId) {
      return { ok: false, reason: "rule_missing" };
    }
  }
  const allowed = await isAgentAutomationAllowed({
    sb: params.sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    agentId: params.agentId,
  });
  if (!allowed.ok) return { ok: false, reason: allowed.reason };
  return { ok: true, ruleId };
}

export async function reclaimStuckProcessingJobs(sb?: SupabaseServiceClient): Promise<number> {
  const client = sb ?? createSupabaseServiceClient();
  const cutoff = new Date(Date.now() - STUCK_PROCESSING_MS).toISOString();
  const { data, error } = await client
    .from("agent_response_jobs")
    .update({
      status: "pending",
      locked_at: null,
      claim_token: null,
      claim_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("status", "processing")
    .or(`claim_expires_at.lt.${new Date().toISOString()},and(claim_expires_at.is.null,locked_at.lt.${cutoff})`)
    .lt("attempt_count", MAX_JOB_ATTEMPTS)
    .select("id");
  if (error) {
    logJobEvent("failed_reason", { scope: "reclaim_stuck", reason: error.message });
    return 0;
  }
  const count = Array.isArray(data) ? data.length : 0;
  if (count > 0) logJobEvent("reclaimed_stuck", { count });
  return count;
}

export async function getAgentResponseJobById(
  sb: SupabaseServiceClient,
  jobId: string,
): Promise<AgentResponseJobRow | null> {
  const { data } = await sb.from("agent_response_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!data) return null;
  return rowFromDb(data as Record<string, unknown>);
}

export function resolveAgentJobSchedulingTimestamp(
  occurredAt: string | undefined,
  receivedAt = new Date(),
): string | null {
  const providerTime = occurredAt ? new Date(occurredAt) : receivedAt;
  if (Number.isNaN(providerTime.getTime()) || Number.isNaN(receivedAt.getTime())) return null;
  // O timestamp do provedor continua gravado em whatsapp_messages. O relógio
  // do Smart Wait começa no recebimento real do webhook; usar o horário
  // original fazia uma mensagem atrasada já nascer vencida e ser respondida
  // antes de o próximo fragmento sair da fila da Evolution.
  return receivedAt.toISOString();
}

export async function scheduleAgentResponseJob(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  leadId?: string | null;
  journeyId?: string | null;
  agentId: string;
  instanceName: string;
  channel: "evolution" | "meta_cloud";
  connectionId: string;
  whatsappMessageId: string;
  occurredAt?: string;
  receivedAt?: string;
  settings?: AgentSmartWaitSettings;
}): Promise<AgentResponseJobRow | null> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const settings = params.settings ?? (await loadAgentSmartWaitSettings(sb, params.tenantId, params.agentId));

  const connectionId = params.connectionId.trim();
  if (!connectionId) {
    logJobEvent("failed_reason", {
      scope: "schedule",
      reason: "connection_missing",
      tenant_id: params.tenantId,
      channel: params.channel,
    });
    return null;
  }

  if (!UUID_RE.test(params.whatsappMessageId)) {
    logJobEvent("failed_reason", {
      scope: "schedule",
      reason: "invalid_message_uuid",
      tenant_id: params.tenantId,
    });
    return null;
  }

  const eligible = await shouldScheduleAgentResponse({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    agentId: params.agentId,
    journeyId: params.journeyId,
    connectionId,
    channel: params.channel,
  });
  if (!eligible.ok) {
    logJobEvent("schedule_skipped", {
      tenant_id: params.tenantId,
      remote_jid: maskRemoteJidForLog(params.remoteJid),
      reason: eligible.reason,
    });
    return null;
  }

  const autoContactGuard = await canAgentAutoContactLead({
    sb,
    tenantId: params.tenantId,
    agentId: params.agentId,
    leadId: params.leadId,
    phone: params.remoteJid,
    remoteJid: params.remoteJid,
    journeyId: params.journeyId,
    triggerSource: "agent_response_job_schedule",
  });
  if (!autoContactGuard.ok) {
    logJobEvent("schedule_blocked", {
      tenant_id: params.tenantId,
      remote_jid: maskRemoteJidForLog(params.remoteJid),
      agent_id: params.agentId,
      lead_id: autoContactGuard.leadId,
      form_id: autoContactGuard.formId,
      reason: autoContactGuard.reason,
    });
    return null;
  }

  const receivedAt = params.receivedAt ? new Date(params.receivedAt) : new Date();
  const schedulingTimestamp = resolveAgentJobSchedulingTimestamp(params.occurredAt, receivedAt);
  if (!schedulingTimestamp) {
    logJobEvent("failed_reason", {
      tenant_id: params.tenantId,
      remote_jid: maskRemoteJidForLog(params.remoteJid),
      scope: "schedule",
      reason: "invalid_occurred_at",
    });
    return null;
  }

  // Uma única transação no Postgres faz create-or-append sob lock. O antigo
  // SELECT + UPDATE no TypeScript perdia message_ids quando dois webhooks
  // chegavam juntos (lost update), exatamente o caso de 2–3 mensagens seguidas.
  const channel = params.channel;
  if (!eligible.ruleId) {
    logJobEvent("schedule_skipped", {
      tenant_id: params.tenantId,
      remote_jid: maskRemoteJidForLog(params.remoteJid),
      reason: "rule_missing",
    });
    return null;
  }
  const rpcParams = {
    p_tenant_id: params.tenantId,
    p_remote_jid: params.remoteJid,
    p_agent_id: params.agentId,
    p_instance_name: params.instanceName,
    p_channel: channel,
    p_connection_id: connectionId,
    p_message_id: params.whatsappMessageId,
    p_provider_occurred_at: params.occurredAt ?? schedulingTimestamp,
    p_received_at: schedulingTimestamp,
    p_initial_seconds: settings.initialSeconds,
    p_followup_seconds: settings.followupSeconds,
    p_max_seconds: settings.maxSeconds,
    p_lead_id: params.leadId ?? null,
    p_journey_id: params.journeyId ?? null,
    p_rule_id: eligible.ruleId,
  };
  const { data, error } = await sb.rpc("upsert_agent_response_job_burst_v5", rpcParams);

  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    logJobEvent("failed_reason", {
      tenant_id: params.tenantId,
      remote_jid: maskRemoteJidForLog(params.remoteJid),
      scope: "atomic_schedule",
      reason: error?.message ?? "empty_atomic_schedule_result",
    });
    return null;
  }

  const job = rowFromDb(data as Record<string, unknown>);
  logJobEvent(job.inbound_message_count > 1 ? "job_rescheduled" : "job_created", {
    tenant_id: params.tenantId,
    remote_jid: maskRemoteJidForLog(params.remoteJid),
    job_id: job.id,
    messages_count: job.message_ids.length,
    burst_generation: job.burst_generation,
    scheduled_for: job.scheduled_for,
    atomic: true,
  });
  return job;
}

/** Conversation-wide staleness guard. Sequence 0 keeps pre-migration jobs compatible. */
export async function isAgentConversationSequenceCurrent(
  sb: SupabaseServiceClient,
  job: Pick<AgentResponseJobRow, "tenant_id" | "remote_jid" | "conversation_sequence">,
): Promise<boolean> {
  const sequence = Number(job.conversation_sequence ?? 0);
  if (!Number.isSafeInteger(sequence) || sequence <= 0) return true;
  const { data, error } = await sb.rpc("is_agent_conversation_sequence_current", {
    p_tenant_id: job.tenant_id,
    p_remote_jid: job.remote_jid,
    p_sequence: sequence,
  });
  return !error && data === true;
}

export async function cancelPendingAgentResponseJobs(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  reason: string;
}): Promise<number> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("agent_response_jobs")
    .update({
      status: "cancelled",
      failed_reason: params.reason,
      updated_at: now,
    })
    .eq("tenant_id", params.tenantId)
    .eq("remote_jid", params.remoteJid)
    .in("status", ["pending", "processing"])
    .select("id");
  if (error) {
    logJobEvent("failed_reason", { scope: "cancel", reason: error.message });
    return 0;
  }
  const count = Array.isArray(data) ? data.length : 0;
  if (count > 0) logJobEvent("job_cancelled", { count, reason: params.reason });
  return count;
}

async function claimJob(sb: SupabaseServiceClient, jobId: string): Promise<AgentResponseJobRow | null> {
  const claimToken = crypto.randomUUID();
  const { data, error } = await sb.rpc("claim_agent_response_job_v2", {
    p_job_id: jobId,
    p_claim_token: claimToken,
    p_claim_ttl_seconds: 180,
  });
  if (error || !data) return null;
  const claimed = rowFromDb(data as Record<string, unknown>);
  logJobEvent("claimed", {
    job_id: claimed.id,
    burst_generation: claimed.burst_generation,
    tenant_id: claimed.tenant_id,
    remote_jid: maskRemoteJidForLog(claimed.remote_jid),
    scheduled_for: claimed.scheduled_for,
  });
  return claimed;
}

async function isJobGenerationStale(
  sb: SupabaseServiceClient,
  jobId: string,
  claimedGeneration: number,
): Promise<boolean> {
  const { data } = await sb.from("agent_response_jobs").select("burst_generation, status").eq("id", jobId).maybeSingle();
  return isStaleBurstGenerationRow(
    data as { burst_generation?: number; status?: string } | null,
    claimedGeneration,
  );
}

/**
 * Finaliza/cancela somente a geração que este worker realmente reivindicou.
 * Se uma mensagem nova avançar burst_generation entre o último check e este
 * UPDATE, a condição falha e a geração nova não é sobrescrita.
 */
async function updateClaimedJobGeneration(
  sb: SupabaseServiceClient,
  jobId: string,
  claimedGeneration: number,
  claimToken: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await sb
    .from("agent_response_jobs")
    .update(patch)
    .eq("id", jobId)
    .eq("status", "processing")
    .eq("burst_generation", claimedGeneration)
    .eq("claim_token", claimToken)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

/** Coloca em pending apenas o mesmo job cuja geração foi avançada no banco. */
async function requeueSupersededJobGeneration(
  sb: SupabaseServiceClient,
  jobId: string,
  claimedGeneration: number,
): Promise<void> {
  const { error } = await sb
    .from("agent_response_jobs")
    .update({
      status: "pending",
      locked_at: null,
      claim_token: null,
      claim_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "processing")
    .gt("burst_generation", claimedGeneration);
  if (error) throw new Error(error.message);
}

export async function tryProcessAgentResponseJob(
  jobId: string,
  sb?: SupabaseServiceClient,
): Promise<"processed" | "skipped" | "failed"> {
  const client = sb ?? createSupabaseServiceClient();
  const job = await claimJob(client, jobId);
  if (!job) return "skipped";
  const claimedGeneration = job.burst_generation;
  const claimToken = job.claim_token;
  if (!claimToken) return "skipped";

  try {
    if (!(await isAgentConversationSequenceCurrent(client, job))) {
      await updateClaimedJobGeneration(client, job.id, claimedGeneration, claimToken, {
        status: "cancelled",
        failed_reason: "conversation_sequence_stale",
        completed_at: new Date().toISOString(),
        locked_at: null,
        claim_token: null,
        claim_expires_at: null,
        updated_at: new Date().toISOString(),
      });
      logJobEvent("conversation_sequence_stale", {
        job_id: job.id,
        conversation_sequence: job.conversation_sequence,
      });
      return "skipped";
    }
    // Lead descartado que voltou a falar. Precisa vir ANTES do portão de
    // automação: senão o job é cancelado e o agente nunca vê a mensagem. Este
    // processamento é compartilhado pelos dois transportes (QR e API Meta), o
    // que faz deste o ponto certo. Só destrava pausa do próprio descarte, e só
    // quando o operador configurou a retomada.
    await resumeAfterLeadOutcomeIfConfigured({
      sb: client,
      tenantId: job.tenant_id,
      remoteJid: job.remote_jid,
      agentId: job.agent_id,
      leadId: job.lead_id,
    });

    // journeyId do próprio job é obrigatório aqui: sem ele, com isolamento de
    // jornadas ligado (produção), a revalidação devolve "missing_active_journey"
    // e cancela TODO job — o agente ficava mudo depois da resposta do lead.
    const eligible = await shouldScheduleAgentResponse({
      sb: client,
      tenantId: job.tenant_id,
      remoteJid: job.remote_jid,
      agentId: job.agent_id,
      journeyId: job.journey_id,
      connectionId: job.connection_id,
      channel: job.channel,
    });
    if (!eligible.ok) {
      const cancelled = await updateClaimedJobGeneration(
        client,
        job.id,
        claimedGeneration,
        claimToken,
        {
          status: "cancelled",
          failed_reason: eligible.reason,
          locked_at: null,
          claim_token: null,
          claim_expires_at: null,
          updated_at: new Date().toISOString(),
        },
      );
      if (!cancelled) await requeueSupersededJobGeneration(client, job.id, claimedGeneration);
      logJobEvent("job_cancelled", { job_id: job.id, reason: eligible.reason });
      return "skipped";
    }
    if (!job.rule_id || job.rule_id !== eligible.ruleId) {
      const blocked = await updateClaimedJobGeneration(
        client,
        job.id,
        claimedGeneration,
        claimToken,
        {
          status: "cancelled",
          failed_reason: "job_rule_mismatch",
          completed_at: new Date().toISOString(),
          locked_at: null,
          claim_token: null,
          claim_expires_at: null,
          updated_at: new Date().toISOString(),
        },
      );
      if (!blocked) await requeueSupersededJobGeneration(client, job.id, claimedGeneration);
      logJobEvent("job_cancelled", { job_id: job.id, reason: "job_rule_mismatch" });
      return "skipped";
    }

    const result = await processAgentResponseJobByChannel(client, job, claimedGeneration);

    if (
      await isJobGenerationStale(client, job.id, claimedGeneration) ||
      !(await isAgentConversationSequenceCurrent(client, job))
    ) {
      logJobEvent("generation_stale", { job_id: job.id, claimed_generation: claimedGeneration });
      await requeueSupersededJobGeneration(client, job.id, claimedGeneration);
      return "skipped";
    }

    if (result.ok === false && result.error === "generation_stale") {
      await requeueSupersededJobGeneration(client, job.id, claimedGeneration);
      return "skipped";
    }

    const authorizationBlocked = !result.ok && result.error.startsWith("authorization_blocked:");
    const finalStatus = result.ok
      ? "completed"
      : authorizationBlocked
        ? "cancelled"
      : !result.ok && isTransientFailure(result.error) && job.attempt_count < MAX_JOB_ATTEMPTS
        ? "pending"
        : "failed";

    const failedError = !result.ok ? result.error : null;

    const patch: Record<string, unknown> = {
      status: finalStatus,
      locked_at: null,
      claim_token: null,
      claim_expires_at: null,
      updated_at: new Date().toISOString(),
    };
    if (finalStatus === "completed") {
      patch.completed_at = new Date().toISOString();
      patch.failed_reason = null;
    } else if (finalStatus === "pending") {
      patch.scheduled_for = new Date(Date.now() + 5_000).toISOString();
      patch.failed_reason = failedError;
    } else {
      patch.completed_at = new Date().toISOString();
      patch.failed_reason = failedError;
    }

    const finalized = await updateClaimedJobGeneration(
      client,
      job.id,
      claimedGeneration,
      claimToken,
      patch,
    );
    if (!finalized) {
      // Uma mensagem chegou exatamente entre o último check e a finalização.
      // Preserve a geração nova e deixe-a voltar ao processador.
      await requeueSupersededJobGeneration(client, job.id, claimedGeneration);
      logJobEvent("generation_stale", {
        job_id: job.id,
        claimed_generation: claimedGeneration,
        phase: "finalize",
      });
      return "skipped";
    }

    logJobEvent("completed", {
      job_id: job.id,
      ok: result.ok,
      deduped_count: result.ok ? result.dedupedCount : (result.dedupedCount ?? 0),
      final_status: finalStatus,
    });
    if (!result.ok) logJobEvent("failed_reason", { job_id: job.id, reason: result.error });
    return result.ok ? "processed" : finalStatus === "pending" || finalStatus === "cancelled" ? "skipped" : "failed";
  } catch (error) {
    const message = error instanceof Error ? error.message : "process_failed";
    const updated = await updateClaimedJobGeneration(
      client,
      job.id,
      claimedGeneration,
      claimToken,
      {
        status: job.attempt_count < MAX_JOB_ATTEMPTS ? "pending" : "failed",
        failed_reason: message,
        locked_at: null,
        claim_token: null,
        claim_expires_at: null,
        updated_at: new Date().toISOString(),
      },
    ).catch(() => false);
    if (!updated) {
      await requeueSupersededJobGeneration(client, job.id, claimedGeneration).catch(() => undefined);
    }
    logJobEvent("failed_reason", { job_id: job.id, reason: message });
    return "failed";
  }
}

export async function processDueAgentResponseJobs(sb?: SupabaseServiceClient): Promise<number> {
  const client = sb ?? createSupabaseServiceClient();
  await reclaimStuckProcessingJobs(client);
  const now = new Date().toISOString();
  const { data } = await client
    .from("agent_response_jobs")
    .select("id")
    .eq("status", "pending")
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(20);
  let processed = 0;
  for (const row of data ?? []) {
    const outcome = await tryProcessAgentResponseJob(String((row as { id: string }).id), client);
    if (outcome === "processed") processed += 1;
  }
  return processed;
}

export async function processDueJobsForConversation(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
}): Promise<number> {
  const client = params.sb ?? createSupabaseServiceClient();
  await reclaimStuckProcessingJobs(client);
  const now = new Date().toISOString();
  const { data } = await client
    .from("agent_response_jobs")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .eq("remote_jid", params.remoteJid)
    .eq("status", "pending")
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(5);
  let processed = 0;
  for (const row of data ?? []) {
    const outcome = await tryProcessAgentResponseJob(String((row as { id: string }).id), client);
    if (outcome === "processed") processed += 1;
  }
  return processed;
}

export type WaitAndProcessOutcome =
  | "completed"
  | "failed"
  | "cancelled"
  | "rescheduled"
  | "timeout"
  | "not_found";

export function computeAgentResponseProcessorDeadline(params: {
  invocationStartedAt: Date;
  scheduledFor: string;
  maxWaitUntil: string;
}): number {
  const scheduled = new Date(params.scheduledFor).getTime();
  const maxWait = new Date(params.maxWaitUntil).getTime();
  return Math.min(
    maxWait + 20_000,
    Math.max(params.invocationStartedAt.getTime() + 60_000, scheduled + 30_000),
    // Return before the 180s Vercel function ceiling. Every appended inbound
    // triggers another dispatcher, so an older invocation can exit cleanly as
    // "rescheduled" instead of timing out or executing fallback.
    params.invocationStartedAt.getTime() + 150_000,
  );
}

export async function waitAndProcessAgentResponseJob(
  jobId: string,
  sb?: SupabaseServiceClient,
): Promise<WaitAndProcessOutcome> {
  const client = sb ?? createSupabaseServiceClient();
  const { data: initial } = await client.from("agent_response_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!initial) return "not_found";
  const job = rowFromDb(initial as Record<string, unknown>);
  const invocationStartedAt = new Date();
  let deadline = computeAgentResponseProcessorDeadline({
    invocationStartedAt,
    scheduledFor: job.scheduled_for,
    maxWaitUntil: job.max_wait_until,
  });

  while (Date.now() < deadline) {
    const { data } = await client.from("agent_response_jobs").select("*").eq("id", jobId).maybeSingle();
    if (!data) return "not_found";
    const current = rowFromDb(data as Record<string, unknown>);
    // Uma nova mensagem pode estender scheduled_for enquanto este dispatcher
    // está dormindo. Acompanhe a geração mais recente; a RPC v4 mantém o
    // silêncio deslizante da Evolution e cada append dispara outro worker.
    deadline = computeAgentResponseProcessorDeadline({
      invocationStartedAt,
      scheduledFor: current.scheduled_for,
      maxWaitUntil: current.max_wait_until,
    });
    if (current.status === "completed" || current.status === "completed_with_fallback") return "completed";
    if (current.status === "cancelled") return "cancelled";
    if (current.status === "failed" || current.status === "failed_with_fallback") return "failed";
    if (current.status === "pending" && isJobReadyToProcess(current.scheduled_for)) {
      const outcome = await tryProcessAgentResponseJob(jobId, client);
      if (outcome === "processed") return "completed";
      const { data: after } = await client.from("agent_response_jobs").select("status").eq("id", jobId).maybeSingle();
      const status = (after as { status?: string } | null)?.status;
      if (status === "completed" || status === "completed_with_fallback") return "completed";
      if (status === "failed" || status === "failed_with_fallback") return "failed";
    }
    const waitMs = new Date(current.scheduled_for).getTime() - Date.now();
    await sleep(Math.min(1000, Math.max(250, waitMs)));
  }
  const { data: finalData } = await client
    .from("agent_response_jobs")
    .select("status,scheduled_for")
    .eq("id", jobId)
    .maybeSingle();
  const finalStatus = (finalData as { status?: string; scheduled_for?: string } | null)?.status;
  const finalScheduledFor = (finalData as { status?: string; scheduled_for?: string } | null)?.scheduled_for;
  if (
    finalStatus === "pending" &&
    finalScheduledFor &&
    new Date(finalScheduledFor).getTime() > Date.now()
  ) {
    logJobEvent("dispatch_rescheduled", { job_id: jobId, scheduled_for: finalScheduledFor });
    return "rescheduled";
  }
  logJobEvent("wait_timeout", { job_id: jobId });
  return "timeout";
}

export function hasAgentResponseProcessorSecret(): boolean {
  return Boolean(getInternalApiToken());
}

export async function triggerAgentResponseJobProcessor(
  jobId?: string,
  processorBaseUrl?: string,
): Promise<boolean> {
  const secret = getInternalApiToken();
  if (!secret) {
    logJobEvent("processor_not_called", { scope: "processor_trigger", reason: "missing_internal_secret" });
    return false;
  }
  const base =
    processorBaseUrl?.trim().replace(/\/+$/, "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ||
    "https://mychatcrm.vercel.app";
  const url = new URL("/api/internal/agent-response-jobs/dispatch", base);
  if (jobId) url.searchParams.set("jobId", jobId);
  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...internalApiAuthHeaders(),
      },
      body: JSON.stringify(jobId ? { jobId } : {}),
      signal: AbortSignal.timeout(8_000),
    });
    if (response.ok) return true;
    logJobEvent("processor_not_called", {
      scope: "processor_trigger",
      job_id: jobId ?? null,
      reason: `dispatch_http_${response.status}`,
    });
  } catch (error) {
    logJobEvent("processor_not_called", {
      scope: "processor_trigger",
      job_id: jobId ?? null,
      reason: error instanceof Error ? error.message : "fetch_failed",
    });
  }
  return false;
}
