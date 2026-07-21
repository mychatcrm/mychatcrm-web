import type { AgentSmartWaitSettings } from "@/lib/agents/smart-wait-settings";
import { isSmartWaitGloballyDisabled } from "@/lib/server/agent-response-fallback";

export { isSmartWaitGloballyDisabled };
import { maskRemoteJidForLog } from "@/lib/server/agent-response-schedule";
import {
  hasAgentResponseProcessorSecret,
  scheduleAgentResponseJob,
  triggerAgentResponseJobProcessor,
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

export async function queueAgentResponseJobProcessor(
  jobId: string,
  processorBaseUrl?: string,
): Promise<boolean> {
  return triggerAgentResponseJobProcessor(jobId, processorBaseUrl);
}

export async function runInboundSmartWaitFlow(params: {
  tenantId: string;
  remoteJid: string;
  leadId?: string | null;
  journeyId?: string | null;
  agentId: string;
  instanceName: string;
  channel: "evolution" | "meta_cloud";
  connectionId: string;
  inboundMessageKey: string;
  occurredAt: string;
  receivedAt?: string;
  smartWait: AgentSmartWaitSettings;
  processorBaseUrl?: string;
  /** Registra o disparo fora do caminho crítico do ACK do webhook. */
  deferProcessor?: (task: Promise<boolean>) => void;
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
    receivedAt: params.receivedAt,
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
    const processorTask = queueAgentResponseJobProcessor(job.id, params.processorBaseUrl);
    if (params.deferProcessor) {
      params.deferProcessor(processorTask);
    } else {
      await processorTask;
    }
  }
  // O webhook termina aqui. Esperar o Smart Wait/LLM no mesmo request segura
  // o ACK da Evolution e serializa mensagens consecutivas em intervalos de
  // um minuto. O endpoint de dispatch assumiu o processamento longo.
  return { mode: "smart_wait", jobId: job.id };
}
