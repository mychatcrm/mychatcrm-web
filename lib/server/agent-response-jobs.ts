import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  smartWaitFromMetadata,
  type AgentSmartWaitSettings,
} from "@/lib/agents/smart-wait-settings";
import {
  computeAgentResponseSchedule,
  isJobReadyToProcess,
  maskRemoteJidForLog,
  sleep,
} from "@/lib/server/agent-response-schedule";
import {
  isAgentAutomationAllowed,
} from "@/lib/server/conversation-operation";
import { canAgentAutoContactLead } from "@/lib/server/agent-auto-contact-guard";
import { processAgentResponseJob } from "@/lib/server/evolution-agent-reply";
import { getInternalApiToken, internalApiAuthHeaders } from "@/lib/server/internal-api-auth";
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
  remote_jid: string;
  agent_id: string;
  instance_name: string;
  status: string;
  first_message_at: string;
  last_message_at: string;
  scheduled_for: string;
  max_wait_until: string;
  message_ids: string[];
  inbound_message_count: number;
  attempt_count: number;
  burst_generation: number;
  locked_at: string | null;
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
    remote_jid: String(data.remote_jid),
    agent_id: String(data.agent_id),
    instance_name: String(data.instance_name),
    status: String(data.status),
    first_message_at: String(data.first_message_at),
    last_message_at: String(data.last_message_at),
    scheduled_for: String(data.scheduled_for),
    max_wait_until: String(data.max_wait_until),
    message_ids: parseMessageIds(data.message_ids),
    inbound_message_count: Number(data.inbound_message_count ?? 1),
    attempt_count: Number(data.attempt_count ?? 0),
    burst_generation: Number(data.burst_generation ?? 1),
    locked_at: typeof data.locked_at === "string" ? data.locked_at : null,
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
    e.includes("timeout") ||
    e.includes("fetch") ||
    e.includes("network") ||
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
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (isJourneyIsolationEnabled()) {
    if (!params.journeyId) return { ok: false, reason: "missing_active_journey" };
    const journey = await authorizeActiveJourney({
      sb: params.sb,
      tenantId: params.tenantId,
      remoteJid: params.remoteJid,
      preferredAgentId: params.agentId,
    });
    if (!journey.ok || journey.journey?.id !== params.journeyId) {
      return {
        ok: false,
        reason: journey.ok ? "journey_id_mismatch" : journey.reason,
      };
    }
  }
  const allowed = await isAgentAutomationAllowed({
    sb: params.sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    agentId: params.agentId,
  });
  if (!allowed.ok) return { ok: false, reason: allowed.reason };
  return { ok: true };
}

export async function reclaimStuckProcessingJobs(sb?: SupabaseServiceClient): Promise<number> {
  const client = sb ?? createSupabaseServiceClient();
  const cutoff = new Date(Date.now() - STUCK_PROCESSING_MS).toISOString();
  const { data, error } = await client
    .from("agent_response_jobs")
    .update({
      status: "pending",
      locked_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("status", "processing")
    .lt("locked_at", cutoff)
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

async function rescheduleExistingJob(params: {
  sb: SupabaseServiceClient;
  current: AgentResponseJobRow;
  tenantId: string;
  remoteJid: string;
  leadId?: string | null;
  journeyId?: string | null;
  agentId: string;
  instanceName: string;
  whatsappMessageId: string;
  occurredAt: Date;
  settings: AgentSmartWaitSettings;
  now: Date;
}): Promise<AgentResponseJobRow | null> {
  const { current, sb, settings, now, occurredAt } = params;
  if (!UUID_RE.test(params.whatsappMessageId)) {
    logJobEvent("failed_reason", {
      scope: "reschedule",
      reason: "invalid_message_uuid",
      tenant_id: params.tenantId,
    });
    return null;
  }

  const messageIds = Array.from(new Set([...current.message_ids, params.whatsappMessageId]));
  const inboundMessageCount = current.inbound_message_count + 1;
  const firstMessageAt = new Date(current.first_message_at);
  const { scheduledFor, maxWaitUntil } = computeAgentResponseSchedule({
    now,
    firstMessageAt,
    lastMessageAt: occurredAt,
    inboundMessageCount,
    settings,
  });
  const nextGeneration = current.burst_generation + 1;
  const isProcessing = current.status === "processing";

  const patch: Record<string, unknown> = {
    lead_id: params.leadId ?? current.lead_id,
    journey_id: params.journeyId ?? current.journey_id,
    agent_id: params.agentId,
    instance_name: params.instanceName,
    last_message_at: occurredAt.toISOString(),
    scheduled_for: scheduledFor.toISOString(),
    max_wait_until: maxWaitUntil.toISOString(),
    message_ids: messageIds,
    inbound_message_count: inboundMessageCount,
    burst_generation: nextGeneration,
    updated_at: now.toISOString(),
  };

  if (!isProcessing) {
    patch.status = "pending";
    patch.locked_at = null;
  }

  const { data, error } = await sb
    .from("agent_response_jobs")
    .update(patch)
    .eq("id", current.id)
    .in("status", ["pending", "processing"])
    .select("*")
    .maybeSingle();

  if (error || !data) {
    logJobEvent("failed_reason", {
      tenant_id: params.tenantId,
      remote_jid: maskRemoteJidForLog(params.remoteJid),
      scope: "reschedule",
      reason: error?.message ?? "reschedule_conflict",
    });
    return null;
  }

  if (isProcessing) {
    logJobEvent("generation_bumped", {
      job_id: current.id,
      from: current.burst_generation,
      to: nextGeneration,
    });
  }

  logJobEvent("job_rescheduled", {
    tenant_id: params.tenantId,
    remote_jid: maskRemoteJidForLog(params.remoteJid),
    job_id: current.id,
    messages_count: messageIds.length,
    scheduled_for: scheduledFor.toISOString(),
    processing: isProcessing,
  });
  return rowFromDb(data as Record<string, unknown>);
}

export async function getAgentResponseJobById(
  sb: SupabaseServiceClient,
  jobId: string,
): Promise<AgentResponseJobRow | null> {
  const { data } = await sb.from("agent_response_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!data) return null;
  return rowFromDb(data as Record<string, unknown>);
}

export async function scheduleAgentResponseJob(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  leadId?: string | null;
  journeyId?: string | null;
  agentId: string;
  instanceName: string;
  whatsappMessageId: string;
  occurredAt?: string;
  settings?: AgentSmartWaitSettings;
}): Promise<AgentResponseJobRow | null> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const settings = params.settings ?? (await loadAgentSmartWaitSettings(sb, params.tenantId, params.agentId));
  if (!settings.enabled) return null;

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

  const now = new Date();
  const occurredAt = params.occurredAt ? new Date(params.occurredAt) : now;

  let existingQuery = sb
    .from("agent_response_jobs")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .eq("remote_jid", params.remoteJid)
    .in("status", ["pending", "processing"]);
  existingQuery = params.journeyId
    ? existingQuery.eq("journey_id", params.journeyId)
    : existingQuery.is("journey_id", null);
  const { data: existing } = await existingQuery.maybeSingle();

  if (existing) {
    return rescheduleExistingJob({
      sb,
      current: rowFromDb(existing as Record<string, unknown>),
      tenantId: params.tenantId,
      remoteJid: params.remoteJid,
      leadId: params.leadId,
      journeyId: params.journeyId,
      agentId: params.agentId,
      instanceName: params.instanceName,
      whatsappMessageId: params.whatsappMessageId,
      occurredAt,
      settings,
      now,
    });
  }

  const { scheduledFor, maxWaitUntil } = computeAgentResponseSchedule({
    now,
    firstMessageAt: occurredAt,
    lastMessageAt: occurredAt,
    inboundMessageCount: 1,
    settings,
  });

  const { data, error } = await sb
    .from("agent_response_jobs")
    .insert({
      tenant_id: params.tenantId,
      lead_id: params.leadId ?? null,
      journey_id: params.journeyId ?? null,
      remote_jid: params.remoteJid,
      agent_id: params.agentId,
      instance_name: params.instanceName,
      status: "pending",
      first_message_at: occurredAt.toISOString(),
      last_message_at: occurredAt.toISOString(),
      scheduled_for: scheduledFor.toISOString(),
      max_wait_until: maxWaitUntil.toISOString(),
      message_ids: [params.whatsappMessageId],
      inbound_message_count: 1,
      burst_generation: 1,
    })
    .select("*")
    .single();

  if (error) {
    const isConflict = error.code === "23505" || error.message.includes("duplicate");
    if (isConflict) {
      logJobEvent("schedule_conflict", { tenant_id: params.tenantId });
      let retryQuery = sb
        .from("agent_response_jobs")
        .select("*")
        .eq("tenant_id", params.tenantId)
        .eq("remote_jid", params.remoteJid)
        .in("status", ["pending", "processing"]);
      retryQuery = params.journeyId
        ? retryQuery.eq("journey_id", params.journeyId)
        : retryQuery.is("journey_id", null);
      const { data: retryExisting } = await retryQuery.maybeSingle();
      if (retryExisting) {
        return rescheduleExistingJob({
          sb,
          current: rowFromDb(retryExisting as Record<string, unknown>),
          tenantId: params.tenantId,
          remoteJid: params.remoteJid,
          leadId: params.leadId,
          journeyId: params.journeyId,
          agentId: params.agentId,
          instanceName: params.instanceName,
          whatsappMessageId: params.whatsappMessageId,
          occurredAt,
          settings,
          now,
        });
      }
    }
    logJobEvent("failed_reason", {
      tenant_id: params.tenantId,
      remote_jid: maskRemoteJidForLog(params.remoteJid),
      scope: "insert",
      reason: error.message ?? "insert_failed",
    });
    return null;
  }

  logJobEvent("job_created", {
    tenant_id: params.tenantId,
    remote_jid: maskRemoteJidForLog(params.remoteJid),
    job_id: (data as Record<string, unknown>).id,
    messages_count: 1,
    scheduled_for: scheduledFor.toISOString(),
  });
  return rowFromDb(data as Record<string, unknown>);
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
  const now = new Date();
  const nowIso = now.toISOString();
  const { data: current } = await sb
    .from("agent_response_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("status", "pending")
    .maybeSingle();
  if (!current) return null;
  const pending = rowFromDb(current as Record<string, unknown>);

  const maxWait = new Date(pending.max_wait_until).getTime();
  if (now.getTime() > maxWait) {
    logJobEvent("not_ready", { job_id: jobId, reason: "past_max_wait_until" });
    await sb
      .from("agent_response_jobs")
      .update({ status: "failed", failed_reason: "max_wait_exceeded", updated_at: nowIso })
      .eq("id", jobId);
    return null;
  }

  if (!isJobReadyToProcess(pending.scheduled_for, now)) {
    logJobEvent("not_ready", {
      job_id: jobId,
      scheduled_for: pending.scheduled_for,
      now: nowIso,
    });
    return null;
  }

  const { data, error } = await sb
    .from("agent_response_jobs")
    .update({
      status: "processing",
      locked_at: nowIso,
      attempt_count: pending.attempt_count + 1,
      updated_at: nowIso,
    })
    .eq("id", jobId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
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
  if (!data) return true;
  const row = data as { burst_generation?: number; status?: string };
  return Number(row.burst_generation ?? 1) !== claimedGeneration || row.status === "cancelled";
}

export async function tryProcessAgentResponseJob(
  jobId: string,
  sb?: SupabaseServiceClient,
): Promise<"processed" | "skipped" | "failed"> {
  const client = sb ?? createSupabaseServiceClient();
  const job = await claimJob(client, jobId);
  if (!job) return "skipped";
  const claimedGeneration = job.burst_generation;

  try {
    const eligible = await shouldScheduleAgentResponse({
      sb: client,
      tenantId: job.tenant_id,
      remoteJid: job.remote_jid,
      agentId: job.agent_id,
    });
    if (!eligible.ok) {
      await client
        .from("agent_response_jobs")
        .update({
          status: "cancelled",
          failed_reason: eligible.reason,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      logJobEvent("job_cancelled", { job_id: job.id, reason: eligible.reason });
      return "skipped";
    }

    const result = await processAgentResponseJob(client, job, claimedGeneration);

    if (await isJobGenerationStale(client, job.id, claimedGeneration)) {
      logJobEvent("generation_stale", { job_id: job.id, claimed_generation: claimedGeneration });
      await client
        .from("agent_response_jobs")
        .update({
          status: "pending",
          locked_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      return "skipped";
    }

    if (result.ok === false && result.error === "generation_stale") {
      await client
        .from("agent_response_jobs")
        .update({ status: "pending", locked_at: null, updated_at: new Date().toISOString() })
        .eq("id", job.id);
      return "skipped";
    }

    const finalStatus = result.ok
      ? "completed"
      : !result.ok && isTransientFailure(result.error) && job.attempt_count < MAX_JOB_ATTEMPTS
        ? "pending"
        : "failed";

    const failedError = !result.ok ? result.error : null;

    const patch: Record<string, unknown> = {
      status: finalStatus,
      updated_at: new Date().toISOString(),
    };
    if (finalStatus === "completed") {
      patch.completed_at = new Date().toISOString();
      patch.failed_reason = null;
    } else if (finalStatus === "pending") {
      patch.locked_at = null;
      patch.scheduled_for = new Date(Date.now() + 5_000).toISOString();
      patch.failed_reason = failedError;
    } else {
      patch.completed_at = new Date().toISOString();
      patch.failed_reason = failedError;
    }

    await client.from("agent_response_jobs").update(patch).eq("id", job.id);

    logJobEvent("completed", {
      job_id: job.id,
      ok: result.ok,
      deduped_count: result.ok ? result.dedupedCount : (result.dedupedCount ?? 0),
      final_status: finalStatus,
    });
    if (!result.ok) logJobEvent("failed_reason", { job_id: job.id, reason: result.error });
    return result.ok ? "processed" : finalStatus === "pending" ? "skipped" : "failed";
  } catch (error) {
    const message = error instanceof Error ? error.message : "process_failed";
    await client
      .from("agent_response_jobs")
      .update({
        status: job.attempt_count < MAX_JOB_ATTEMPTS ? "pending" : "failed",
        failed_reason: message,
        locked_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
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
  | "timeout"
  | "not_found";

export async function waitAndProcessAgentResponseJob(
  jobId: string,
  sb?: SupabaseServiceClient,
): Promise<WaitAndProcessOutcome> {
  const client = sb ?? createSupabaseServiceClient();
  const { data: initial } = await client.from("agent_response_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!initial) return "not_found";
  const job = rowFromDb(initial as Record<string, unknown>);
  const deadline = Math.min(
    new Date(job.max_wait_until).getTime() + 20_000,
    Date.now() + Math.max(60_000, job.inbound_message_count * 5_000),
  );

  while (Date.now() < deadline) {
    const { data } = await client.from("agent_response_jobs").select("*").eq("id", jobId).maybeSingle();
    if (!data) return "not_found";
    const current = rowFromDb(data as Record<string, unknown>);
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
  logJobEvent("wait_timeout", { job_id: jobId });
  return "timeout";
}

export function hasAgentResponseProcessorSecret(): boolean {
  return Boolean(getInternalApiToken());
}

export function triggerAgentResponseJobProcessor(jobId?: string): boolean {
  const secret = getInternalApiToken();
  if (!secret) {
    logJobEvent("processor_not_called", { scope: "processor_trigger", reason: "missing_internal_secret" });
    return false;
  }
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "https://mychatcrm.vercel.app";
  const url = new URL("/api/internal/process-agent-job", base);
  if (jobId) url.searchParams.set("jobId", jobId);
  void fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...internalApiAuthHeaders(),
    },
    body: JSON.stringify(jobId ? { jobId } : {}),
  }).catch((error) => {
    logJobEvent("processor_not_called", {
      scope: "processor_trigger",
      job_id: jobId ?? null,
      reason: error instanceof Error ? error.message : "fetch_failed",
    });
  });
  return true;
}
