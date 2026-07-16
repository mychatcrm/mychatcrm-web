import type { AgentSmartWaitSettings } from "@/lib/agents/smart-wait-settings";
import {
  executeAgentResponseFallback,
  isJobStuckPastGrace,
  isSmartWaitGloballyDisabled,
  loadAgentResponseJob,
  type AgentResponseFallbackReason,
} from "@/lib/server/agent-response-fallback";

export { isSmartWaitGloballyDisabled };
import { maskRemoteJidForLog } from "@/lib/server/agent-response-schedule";
import {
  hasAgentResponseProcessorSecret,
  processDueJobsForConversation,
  scheduleAgentResponseJob,
  triggerAgentResponseJobProcessor,
  waitAndProcessAgentResponseJob,
} from "@/lib/server/agent-response-jobs";

export type InboundAgentFlowDecision =
  | { mode: "smart_wait"; jobId: string | null; reason?: string; fallback?: boolean }
  | { mode: "immediate"; reason: string };

export function resolveInboundAgentFlowDecision(params: {
  smartWait: AgentSmartWaitSettings;
  inboundMessageKey: string | null;
}): InboundAgentFlowDecision {
  if (isSmartWaitGloballyDisabled()) {
    return { mode: "immediate", reason: "smart_wait_disabled" };
  }
  if (!params.inboundMessageKey) {
    return { mode: "smart_wait", jobId: null, reason: "missing_inbound_message_key" };
  }
  return { mode: "smart_wait", jobId: null };
}

export function queueAgentResponseJobProcessor(jobId: string): boolean {
  return triggerAgentResponseJobProcessor(jobId);
}

async function runFallbackForJob(params: {
  sb: ReturnType<typeof import("@/lib/supabase/server").createSupabaseServiceClient>;
  jobId: string;
  reason: AgentResponseFallbackReason;
}): Promise<void> {
  const job = await loadAgentResponseJob(params.sb, params.jobId);
  if (!job) return;
  await executeAgentResponseFallback({
    sb: params.sb,
    job,
    reason: params.reason,
  });
}

export async function runInboundSmartWaitFlow(params: {
  tenantId: string;
  remoteJid: string;
  leadId?: string | null;
  journeyId?: string | null;
  agentId: string;
  instanceName: string;
  channel?: "evolution" | "meta_cloud";
  connectionId?: string | null;
  inboundMessageKey: string;
  occurredAt: string;
  smartWait: AgentSmartWaitSettings;
  sb: ReturnType<typeof import("@/lib/supabase/server").createSupabaseServiceClient>;
}): Promise<InboundAgentFlowDecision> {
  console.info("[agent-response-jobs]", {
    event: "smart_wait_started",
    tenant_id: params.tenantId,
    remote_jid: maskRemoteJidForLog(params.remoteJid),
    inbound_message_id: params.inboundMessageKey,
  });

  const job = await scheduleAgentResponseJob({
    sb: params.sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    leadId: params.leadId,
    journeyId: params.journeyId,
    agentId: params.agentId,
    instanceName: params.instanceName,
    channel: params.channel,
    connectionId: params.connectionId,
    whatsappMessageId: params.inboundMessageKey,
    occurredAt: params.occurredAt,
    settings: params.smartWait,
  });

  if (!job) {
    console.info("[agent-response-jobs]", {
      event: "job_create_failed",
      tenant_id: params.tenantId,
      remote_jid: maskRemoteJidForLog(params.remoteJid),
    });
    // Falhar fechado preserva a garantia de uma resposta por burst. Responder
    // imediatamente aqui recriaria exatamente o defeito de respostas separadas.
    return { mode: "smart_wait", jobId: null, reason: "job_create_failed" };
  }

  console.info("[agent-response-jobs]", {
    event: "webhook_smart_wait_scheduled",
    tenant_id: params.tenantId,
    remote_jid: maskRemoteJidForLog(params.remoteJid),
    job_id: job.id,
    scheduled_for: job.scheduled_for,
    messages_count: job.message_ids.length,
  });

  const processorSecretOk = hasAgentResponseProcessorSecret();
  if (!processorSecretOk) {
    console.info("[agent-response-jobs]", {
      event: "processor_not_called",
      reason: "missing_internal_secret",
      job_id: job.id,
    });
  } else {
    queueAgentResponseJobProcessor(job.id);
  }

  const waitOutcome = await waitAndProcessAgentResponseJob(job.id, params.sb);
  const current = await loadAgentResponseJob(params.sb, job.id);

  if (current?.status === "completed" || current?.status === "completed_with_fallback") {
    return { mode: "smart_wait", jobId: job.id };
  }

  const needsFallback =
    waitOutcome === "timeout" ||
    waitOutcome === "failed" ||
    current?.status === "failed" ||
    (current?.status === "pending" && current && isJobStuckPastGrace(current));

  if (needsFallback && current) {
    const reason: AgentResponseFallbackReason =
      waitOutcome === "timeout"
        ? "processor_timeout"
        : current.status === "failed"
          ? "max_wait_exceeded"
          : !processorSecretOk
            ? "processor_not_called"
            : "job_stuck";
    await runFallbackForJob({ sb: params.sb, jobId: current.id, reason });
    return { mode: "smart_wait", jobId: job.id, fallback: true, reason };
  }

  if (waitOutcome === "timeout" || waitOutcome === "failed") {
    await runFallbackForJob({
      sb: params.sb,
      jobId: job.id,
      reason: waitOutcome === "timeout" ? "processor_timeout" : "job_failed",
    });
    return { mode: "smart_wait", jobId: job.id, fallback: true };
  }

  const processedDue = await processDueJobsForConversation({
    sb: params.sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
  });
  if (processedDue > 0) {
    console.info("[agent-response-jobs]", {
      event: "inline_due_processed",
      tenant_id: params.tenantId,
      remote_jid: maskRemoteJidForLog(params.remoteJid),
      processed: processedDue,
    });
  }

  return { mode: "smart_wait", jobId: job.id };
}
