import type { AgentSmartWaitSettings } from "@/lib/agents/smart-wait-settings";
import { maskRemoteJidForLog } from "@/lib/server/agent-response-schedule";
import {
  scheduleAgentResponseJob,
  triggerAgentResponseJobProcessor,
} from "@/lib/server/agent-response-jobs";

export type InboundAgentFlowDecision =
  | { mode: "smart_wait"; jobId: string | null; reason?: string }
  | { mode: "immediate"; reason: string };

export function resolveInboundAgentFlowDecision(params: {
  smartWait: AgentSmartWaitSettings;
  inboundMessageKey: string | null;
}): InboundAgentFlowDecision {
  if (!params.smartWait.enabled) {
    return { mode: "immediate", reason: "smart_wait_disabled" };
  }
  if (!params.inboundMessageKey) {
    return { mode: "smart_wait", jobId: null, reason: "missing_inbound_message_key" };
  }
  return { mode: "smart_wait", jobId: null };
}

export function queueAgentResponseJobProcessor(jobId: string): void {
  triggerAgentResponseJobProcessor(jobId);
}

export async function runInboundSmartWaitFlow(params: {
  tenantId: string;
  remoteJid: string;
  leadId?: string | null;
  agentId: string;
  instanceName: string;
  inboundMessageKey: string;
  occurredAt: string;
  smartWait: AgentSmartWaitSettings;
  sb: ReturnType<typeof import("@/lib/supabase/server").createSupabaseServiceClient>;
}): Promise<InboundAgentFlowDecision> {
  const job = await scheduleAgentResponseJob({
    sb: params.sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    leadId: params.leadId,
    agentId: params.agentId,
    instanceName: params.instanceName,
    whatsappMessageId: params.inboundMessageKey,
    occurredAt: params.occurredAt,
    settings: params.smartWait,
  });

  console.info("[agent-response-jobs] webhook_smart_wait", {
    action: job ? "scheduled" : "schedule_failed",
    smart_wait_enabled: true,
    immediate_flow_blocked: true,
    tenant_id: params.tenantId,
    remote_jid: maskRemoteJidForLog(params.remoteJid),
    job_id: job?.id ?? null,
    scheduled_for: job?.scheduled_for ?? null,
    messages_count: job?.message_ids.length ?? 0,
    reason: job ? null : "schedule_returned_null",
  });

  if (job) queueAgentResponseJobProcessor(job.id);
  return { mode: "smart_wait", jobId: job?.id ?? null, reason: job ? undefined : "schedule_returned_null" };
}
