import type { AgentResponseJobRow } from "@/lib/server/agent-response-jobs";
import {
  getAgentResponseJobById,
  tryProcessAgentResponseJob,
} from "@/lib/server/agent-response-jobs";
import { maskRemoteJidForLog } from "@/lib/server/agent-response-schedule";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type AgentResponseFallbackReason =
  | "job_create_failed"
  | "job_stuck"
  | "job_failed"
  | "processor_timeout"
  | "processor_not_called"
  | "auth_error"
  | "pipeline_error"
  | "missing_inbound_key"
  | "max_wait_exceeded";

const TERMINAL_STATUSES = new Set([
  "completed",
  "completed_with_fallback",
  "failed_with_fallback",
  "cancelled",
]);

function logFallback(event: string, payload: Record<string, unknown>): void {
  console.info("[agent-response-jobs]", { event, ...payload });
}

export function isSmartWaitGloballyDisabled(): boolean {
  return process.env.SMART_WAIT_DISABLED?.trim().toLowerCase() === "true";
}

export async function loadAgentResponseJob(
  sb: SupabaseServiceClient,
  jobId: string,
): Promise<AgentResponseJobRow | null> {
  return getAgentResponseJobById(sb, jobId);
}

async function hasOutboundForBurst(
  sb: SupabaseServiceClient,
  job: Pick<AgentResponseJobRow, "tenant_id" | "remote_jid" | "first_message_at" | "agent_id">,
): Promise<boolean> {
  const { data } = await sb
    .from("whatsapp_messages")
    .select("id")
    .eq("tenant_id", job.tenant_id)
    .eq("remote_jid", job.remote_jid)
    .eq("direction", "outbound")
    .eq("agent_id", job.agent_id)
    .gte("created_at", job.first_message_at)
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

export async function executeAgentResponseFallback(params: {
  sb?: SupabaseServiceClient;
  job: AgentResponseJobRow;
  reason: AgentResponseFallbackReason;
  skipDuplicateCheck?: boolean;
}): Promise<"completed" | "skipped_duplicate" | "failed"> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const { job, reason } = params;

  if (TERMINAL_STATUSES.has(job.status)) {
    logFallback("fallback_skipped_duplicate", {
      job_id: job.id,
      status: job.status,
      reason,
    });
    return "skipped_duplicate";
  }

  if (!params.skipDuplicateCheck && (await hasOutboundForBurst(sb, job))) {
    await sb
      .from("agent_response_jobs")
      .update({
        status: "completed_with_fallback",
        completed_at: new Date().toISOString(),
        failed_reason: `duplicate_outbound:${reason}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .in("status", ["pending", "failed"]);
    logFallback("fallback_skipped_duplicate", {
      job_id: job.id,
      reason,
      detail: "outbound_already_sent",
    });
    return "skipped_duplicate";
  }

  if (job.status === "failed") {
    await sb
      .from("agent_response_jobs")
      .update({
        status: "pending",
        locked_at: null,
        claim_token: null,
        claim_expires_at: null,
        scheduled_for: new Date().toISOString(),
        failed_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("status", "failed");
  }

  const fresh = await loadAgentResponseJob(sb, job.id);
  if (!fresh || fresh.status !== "pending") {
    logFallback("fallback_skipped_duplicate", {
      job_id: job.id,
      reason,
      detail: "claim_conflict",
    });
    return "skipped_duplicate";
  }

  logFallback("fallback_triggered", {
    job_id: job.id,
    tenant_id: job.tenant_id,
    remote_jid: maskRemoteJidForLog(job.remote_jid),
    reason,
  });

  try {
    const outcome = await tryProcessAgentResponseJob(job.id, sb);
    if (outcome === "processed") {
      await sb
        .from("agent_response_jobs")
        .update({
          status: "completed_with_fallback",
          completed_at: new Date().toISOString(),
          failed_reason: reason,
          locked_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("status", "completed");
      logFallback("fallback_completed", { job_id: job.id, reason });
      logFallback("final_outbound_sent", { job_id: job.id, mode: "fallback" });
      return "completed";
    }

    const after = await loadAgentResponseJob(sb, job.id);
    const detail = after?.failed_reason ?? outcome;
    if (outcome === "failed") {
      await sb
        .from("agent_response_jobs")
        .update({
          status: "failed_with_fallback",
          completed_at: new Date().toISOString(),
          failed_reason: `${reason}:${detail}`,
          locked_at: null,
          claim_token: null,
          claim_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("status", "failed");
    }
    logFallback("final_outbound_failed", { job_id: job.id, reason, error: detail });
    return "failed";
  } catch (error) {
    const message = error instanceof Error ? error.message : "fallback_pipeline_error";
    await sb
      .from("agent_response_jobs")
      .update({
        status: "failed_with_fallback",
        completed_at: new Date().toISOString(),
        failed_reason: `${reason}:${message}`,
        locked_at: null,
        claim_token: null,
        claim_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .in("status", ["pending", "failed"]);
    logFallback("final_outbound_failed", { job_id: job.id, reason, error: message });
    return "failed";
  }
}

export function isJobStuckPastGrace(job: AgentResponseJobRow, graceMs = 20_000): boolean {
  const maxWait = new Date(job.max_wait_until).getTime();
  return Date.now() > maxWait + graceMs;
}

export async function maybeFallbackStuckJob(params: {
  sb: SupabaseServiceClient;
  jobId: string;
  reason: AgentResponseFallbackReason;
}): Promise<"completed" | "skipped_duplicate" | "failed" | "not_needed"> {
  const job = await loadAgentResponseJob(params.sb, params.jobId);
  if (!job) return "not_needed";
  if (TERMINAL_STATUSES.has(job.status)) return "not_needed";
  if (job.status === "completed") return "not_needed";

  const stuck =
    job.status === "failed" ||
    (job.status === "pending" && isJobStuckPastGrace(job));

  if (!stuck) return "not_needed";

  if (job.status === "pending" && isJobStuckPastGrace(job)) {
    logFallback("job_stuck", {
      job_id: job.id,
      scheduled_for: job.scheduled_for,
      max_wait_until: job.max_wait_until,
    });
  }

  const outcome = await executeAgentResponseFallback({
    sb: params.sb,
    job,
    reason: params.reason,
  });
  return outcome;
}
