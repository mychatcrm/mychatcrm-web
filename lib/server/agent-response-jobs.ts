import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  smartWaitFromMetadata,
  type AgentSmartWaitSettings,
} from "@/lib/agents/smart-wait-settings";
import {
  computeAgentResponseSchedule,
  maskRemoteJidForLog,
  sleep,
} from "@/lib/server/agent-response-schedule";
import {
  deriveConversationMode,
  loadStateOperationRow,
} from "@/lib/server/conversation-operation";
import { getConversationState } from "@/lib/server/conversation-memory";
import { processAgentResponseJob } from "@/lib/server/evolution-agent-reply";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type AgentResponseJobRow = {
  id: string;
  tenant_id: string;
  lead_id: string | null;
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
  locked_at: string | null;
  completed_at: string | null;
  failed_reason: string | null;
  created_at: string;
  updated_at: string;
};

function parseMessageIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function rowFromDb(data: Record<string, unknown>): AgentResponseJobRow {
  return {
    id: String(data.id),
    tenant_id: String(data.tenant_id),
    lead_id: typeof data.lead_id === "string" ? data.lead_id : null,
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
    locked_at: typeof data.locked_at === "string" ? data.locked_at : null,
    completed_at: typeof data.completed_at === "string" ? data.completed_at : null,
    failed_reason: typeof data.failed_reason === "string" ? data.failed_reason : null,
    created_at: String(data.created_at),
    updated_at: String(data.updated_at),
  };
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
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const state = await getConversationState({
    sb: params.sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
  });
  const opRow = await loadStateOperationRow({
    sb: params.sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
  });
  const mode = deriveConversationMode({
    conversationMode: typeof opRow?.conversation_mode === "string" ? opRow.conversation_mode : null,
    humanPaused: state?.humanPaused,
    handoffSuggested: state?.handoffSuggested,
    pausedReason: state?.pausedReason,
  });
  if (mode !== "automation") return { ok: false, reason: "conversation_mode_not_automation" };
  if (state?.humanPaused) return { ok: false, reason: "human_paused" };

  const { data: agentRow } = await params.sb
    .from("tenant_agents")
    .select("metadata")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .maybeSingle();
  const metadata =
    agentRow?.metadata && typeof agentRow.metadata === "object"
      ? (agentRow.metadata as Record<string, unknown>)
      : {};
  const status = typeof metadata.status === "string" ? metadata.status : "ativo";
  if (status === "inativo" || status === "pausado") {
    return { ok: false, reason: "agent_inactive" };
  }
  return { ok: true };
}

export async function scheduleAgentResponseJob(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  leadId?: string | null;
  agentId: string;
  instanceName: string;
  whatsappMessageId: string;
  occurredAt?: string;
  settings?: AgentSmartWaitSettings;
}): Promise<AgentResponseJobRow | null> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const settings = params.settings ?? (await loadAgentSmartWaitSettings(sb, params.tenantId, params.agentId));
  if (!settings.enabled) return null;

  const eligible = await shouldScheduleAgentResponse({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    agentId: params.agentId,
  });
  if (!eligible.ok) return null;

  const now = new Date();
  const occurredAt = params.occurredAt ? new Date(params.occurredAt) : now;

  const { data: existing } = await sb
    .from("agent_response_jobs")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .eq("remote_jid", params.remoteJid)
    .in("status", ["pending", "processing"])
    .maybeSingle();

  if (existing) {
    const current = rowFromDb(existing as Record<string, unknown>);
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
    const { data, error } = await sb
      .from("agent_response_jobs")
      .update({
        lead_id: params.leadId ?? current.lead_id,
        agent_id: params.agentId,
        instance_name: params.instanceName,
        status: "pending",
        last_message_at: occurredAt.toISOString(),
        scheduled_for: scheduledFor.toISOString(),
        max_wait_until: maxWaitUntil.toISOString(),
        message_ids: messageIds,
        inbound_message_count: inboundMessageCount,
        locked_at: null,
        updated_at: now.toISOString(),
      })
      .eq("id", current.id)
      .eq("status", current.status)
      .select("*")
      .maybeSingle();
    if (error || !data) {
      console.warn("[agent-response-jobs] job_reschedule_failed", {
        tenant_id: params.tenantId,
        remote_jid: maskRemoteJidForLog(params.remoteJid),
        error: error?.message,
      });
      return null;
    }
    console.info("[agent-response-jobs] job_rescheduled", {
      tenant_id: params.tenantId,
      remote_jid: maskRemoteJidForLog(params.remoteJid),
      job_id: current.id,
      messages_count: messageIds.length,
      scheduled_for: scheduledFor.toISOString(),
    });
    return rowFromDb(data as Record<string, unknown>);
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
    })
    .select("*")
    .single();
  if (error || !data) {
    console.warn("[agent-response-jobs] job_create_failed", {
      tenant_id: params.tenantId,
      remote_jid: maskRemoteJidForLog(params.remoteJid),
      error: error?.message,
    });
    return null;
  }
  console.info("[agent-response-jobs] job_created", {
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
    console.warn("[agent-response-jobs] job_cancel_failed", {
      tenant_id: params.tenantId,
      remote_jid: maskRemoteJidForLog(params.remoteJid),
      error: error.message,
    });
    return 0;
  }
  const count = Array.isArray(data) ? data.length : 0;
  if (count > 0) {
    console.info("[agent-response-jobs] job_cancelled", {
      tenant_id: params.tenantId,
      remote_jid: maskRemoteJidForLog(params.remoteJid),
      count,
      reason: params.reason,
    });
  }
  return count;
}

async function claimJob(sb: SupabaseServiceClient, jobId: string): Promise<AgentResponseJobRow | null> {
  const nowIso = new Date().toISOString();
  const { data: current } = await sb
    .from("agent_response_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("status", "pending")
    .lte("scheduled_for", nowIso)
    .maybeSingle();
  if (!current) return null;
  const previous = rowFromDb(current as Record<string, unknown>);
  const { data, error } = await sb
    .from("agent_response_jobs")
    .update({
      status: "processing",
      locked_at: nowIso,
      attempt_count: previous.attempt_count + 1,
      updated_at: nowIso,
    })
    .eq("id", jobId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error || !data) return null;
  return rowFromDb(data as Record<string, unknown>);
}

export async function tryProcessAgentResponseJob(
  jobId: string,
  sb?: SupabaseServiceClient,
): Promise<"processed" | "skipped" | "failed"> {
  const client = sb ?? createSupabaseServiceClient();
  const job = await claimJob(client, jobId);
  if (!job) return "skipped";

  console.info("[agent-response-jobs] job_processing", {
    tenant_id: job.tenant_id,
    remote_jid: maskRemoteJidForLog(job.remote_jid),
    job_id: job.id,
    messages_count: job.message_ids.length,
  });

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
      console.info("[agent-response-jobs] job_cancelled", {
        tenant_id: job.tenant_id,
        remote_jid: maskRemoteJidForLog(job.remote_jid),
        job_id: job.id,
        reason: eligible.reason,
      });
      return "skipped";
    }

    const result = await processAgentResponseJob(client, job);
    await client
      .from("agent_response_jobs")
      .update({
        status: result.ok ? "completed" : "failed",
        completed_at: new Date().toISOString(),
        failed_reason: result.ok ? null : result.error,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    console.info("[agent-response-jobs] job_completed", {
      tenant_id: job.tenant_id,
      remote_jid: maskRemoteJidForLog(job.remote_jid),
      job_id: job.id,
      ok: result.ok,
      deduped_count: result.dedupedCount ?? 0,
    });
    return result.ok ? "processed" : "failed";
  } catch (error) {
    const message = error instanceof Error ? error.message : "process_failed";
    await client
      .from("agent_response_jobs")
      .update({
        status: "failed",
        failed_reason: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    console.warn("[agent-response-jobs] job_failed", {
      tenant_id: job.tenant_id,
      remote_jid: maskRemoteJidForLog(job.remote_jid),
      job_id: job.id,
      error: message,
    });
    return "failed";
  }
}

export async function processDueAgentResponseJobs(sb?: SupabaseServiceClient): Promise<number> {
  const client = sb ?? createSupabaseServiceClient();
  const now = new Date().toISOString();
  const { data } = await client
    .from("agent_response_jobs")
    .select("id")
    .eq("status", "pending")
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(20);
  const ids = (data ?? []).map((row) => String((row as { id: string }).id));
  let processed = 0;
  for (const id of ids) {
    const outcome = await tryProcessAgentResponseJob(id, client);
    if (outcome === "processed") processed += 1;
  }
  return processed;
}

export async function waitAndProcessAgentResponseJob(jobId: string): Promise<void> {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    const sb = createSupabaseServiceClient();
    const { data } = await sb.from("agent_response_jobs").select("*").eq("id", jobId).maybeSingle();
    if (!data) return;
    const job = rowFromDb(data as Record<string, unknown>);
    if (job.status !== "pending") return;
    const now = Date.now();
    const scheduledAt = new Date(job.scheduled_for).getTime();
    if (now >= scheduledAt) {
      await tryProcessAgentResponseJob(jobId, sb);
      return;
    }
    await sleep(Math.min(750, Math.max(250, scheduledAt - now)));
  }
  await tryProcessAgentResponseJob(jobId);
}

export function triggerAgentResponseJobProcessor(jobId?: string): void {
  const secret =
    process.env.AGENT_RESPONSE_JOBS_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim();
  if (!secret) return;
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
  const url = new URL("/api/internal/agent-response-jobs/process", base);
  if (jobId) url.searchParams.set("jobId", jobId);
  void fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "x-agent-jobs-secret": secret,
    },
  }).catch(() => {});
}
