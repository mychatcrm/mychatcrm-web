import "server-only";

import type { AgentResponseJobRow } from "@/lib/server/agent-response-jobs";
import {
  buildDeterministicHandoffSummary,
  getRecentConversationMessages,
  saveConversationSummary,
  shouldTriggerHandoffAI,
  validConfiguredHandoffKeywords,
} from "@/lib/server/conversation-memory";
import { markWaitingForHuman } from "@/lib/server/conversation-operation";
import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type AgentHandoffSettings = {
  enabled: boolean;
  keywords: string[];
  message: string | null;
  notificationNumber: string | null;
};

export function resolveAgentHandoffSettings(
  metadata: Record<string, unknown>,
): AgentHandoffSettings {
  const rawKeywords = Array.isArray(metadata.handoffKeywords)
    ? metadata.handoffKeywords.filter((item): item is string => typeof item === "string")
    : [];
  const keywords = validConfiguredHandoffKeywords(rawKeywords);
  const message =
    typeof metadata.handoffMensagem === "string" && metadata.handoffMensagem.trim()
      ? metadata.handoffMensagem.trim()
      : null;
  const notificationNumber =
    typeof metadata.handoffNumero === "string" && metadata.handoffNumero.trim()
      ? metadata.handoffNumero.trim()
      : null;
  const notificationDigits = notificationNumber?.replace(/\D/g, "") ?? "";
  const enabled =
    metadata.ctaHandoffAtivo === true &&
    keywords.length > 0 &&
    Boolean(message) &&
    notificationDigits.length >= 8 &&
    notificationDigits.length <= 15;
  return {
    enabled,
    keywords,
    message: enabled ? message : null,
    notificationNumber: enabled ? notificationNumber : null,
  };
}

export async function detectAgentHandoff(params: {
  settings: AgentHandoffSettings;
  customerText: string;
  modelText: string;
  modelRequested?: boolean;
  modelReason?: string | null;
}): Promise<{ triggered: boolean; reason: string | null; cleanModelText: string }> {
  const cleanModelText = params.modelText.replace(/\[\[HANDOFF\]\]/gi, "").trim();
  if (!params.settings.enabled) {
    return { triggered: false, reason: null, cleanModelText };
  }
  const inbound = await shouldTriggerHandoffAI(
    params.customerText,
    params.settings.keywords,
  );
  if (inbound.trigger) {
    return {
      triggered: true,
      reason: inbound.reason ?? "handoff",
      cleanModelText,
    };
  }
  const marker = params.modelRequested === true;
  return {
    triggered: marker,
    reason: marker ? params.modelReason?.trim() || "configured_handoff" : null,
    cleanModelText,
  };
}

/** Persiste resumo e takeover do mesmo modo para Evolution e Meta Cloud. */
export async function completeAgentHandoff(params: {
  sb: SupabaseServiceClient;
  job: AgentResponseJobRow;
  reason: string;
  lastCustomerMessage: string;
  notificationNumber: string | null;
}): Promise<void> {
  const messages = await getRecentConversationMessages({
    sb: params.sb,
    tenantId: params.job.tenant_id,
    remoteJid: params.job.remote_jid,
    journeyId: params.job.journey_id,
  });
  const summary = buildDeterministicHandoffSummary({
    lead: params.job.lead_id
      ? {
          id: params.job.lead_id,
          name: null,
          phone:
            params.job.remote_jid.split("@")[0]?.replace(/\D/g, "") ?? null,
          source: params.job.channel,
          status: null,
          crmFunnelId: null,
          notes: null,
          agentId: params.job.agent_id,
          aiSummary: null,
          leadTemperature: null,
          suggestedNextAction: null,
          profileMetadata: {},
        }
      : null,
    messages,
    reason: params.reason,
  });
  await saveConversationSummary({
    sb: params.sb,
    tenantId: params.job.tenant_id,
    remoteJid: params.job.remote_jid,
    leadId: params.job.lead_id,
    agentId: params.job.agent_id,
    journeyId: params.job.journey_id,
    summary,
  });
  await markWaitingForHuman({
    sb: params.sb,
    tenantId: params.job.tenant_id,
    remoteJid: params.job.remote_jid,
    leadId: params.job.lead_id,
    agentId: params.job.agent_id,
    reason: params.reason,
    handoffNumero: params.notificationNumber,
    lastMessage: params.lastCustomerMessage,
  });
}
