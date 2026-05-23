import type { AgentFollowUpInteligente } from "@/lib/types";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  evaluateFollowUpNeed,
  type FollowUpDecision,
  type FollowUpEvalContext,
} from "@/lib/server/follow-up-engine";
import { followUpInteligenteFromMetadata } from "@/lib/server/follow-up-settings";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type FollowUpDryRunResult = {
  settings: AgentFollowUpInteligente;
  decision: FollowUpDecision;
  context: {
    leadId: string | null;
    leadName: string | null;
    leadStatus: string | null;
    hasFutureTask: boolean;
    humanPaused: boolean;
    conversationMode: string | null;
    lastCustomerMessageAt: string | null;
    lastHumanOutboundAt: string | null;
    jobAttempts: number;
    jobMaxAttempts: number;
  };
};

async function loadHasFutureTask(
  sb: SupabaseServiceClient,
  tenantId: string,
  leadId: string | null,
): Promise<boolean> {
  if (!leadId) return false;
  const nowIso = new Date().toISOString();
  const { data } = await sb
    .from("crm_follow_up_timeline")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("lead_id", leadId)
    .gt("scheduled_at", nowIso)
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

export async function buildFollowUpEvalContext(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  remoteJid: string;
  settings: AgentFollowUpInteligente;
  job: { id: string; attempts: number; maxAttempts: number; createdAt: Date };
  leadId?: string | null;
  loadLead: (
    sb: SupabaseServiceClient,
    tenantId: string,
    remoteJid: string,
    leadId?: string | null,
  ) => Promise<{
    id: string;
    name: string | null;
    status: string | null;
    last_message_at: string | null;
    last_follow_up_at: string | null;
    follow_up_count: number;
    follow_up_cooldown_until: string | null;
  } | null>;
  loadConversationState: (
    sb: SupabaseServiceClient,
    tenantId: string,
    remoteJid: string,
  ) => Promise<FollowUpEvalContext["conversationState"]>;
  loadMessageTimestamps: (
    sb: SupabaseServiceClient,
    tenantId: string,
    remoteJid: string,
  ) => Promise<{
    lastCustomerMessageAt: Date | null;
    lastAgentMessageAt: Date | null;
    lastHumanOutboundAt: Date | null;
  }>;
}): Promise<FollowUpEvalContext> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const now = new Date();
  const lead = await params.loadLead(sb, params.tenantId, params.remoteJid, params.leadId);
  const conversationState = await params.loadConversationState(
    sb,
    params.tenantId,
    params.remoteJid,
  );
  const timestamps = await params.loadMessageTimestamps(
    sb,
    params.tenantId,
    params.remoteJid,
  );
  const hasFutureTask =
    params.settings.bloquearTarefaFutura && lead?.id
      ? await loadHasFutureTask(sb, params.tenantId, lead.id)
      : false;

  return {
    now,
    settings: params.settings,
    job: params.job,
    lead: lead
      ? {
          id: lead.id,
          name: lead.name,
          status: lead.status,
          lastMessageAt: lead.last_message_at ? new Date(lead.last_message_at) : null,
          lastFollowUpAt: lead.last_follow_up_at ? new Date(lead.last_follow_up_at) : null,
          followUpCount: lead.follow_up_count,
          followUpCooldownUntil: lead.follow_up_cooldown_until
            ? new Date(lead.follow_up_cooldown_until)
            : null,
        }
      : null,
    conversationState,
    lastCustomerMessageAt: timestamps.lastCustomerMessageAt,
    lastAgentMessageAt: timestamps.lastAgentMessageAt,
    lastHumanOutboundAt: timestamps.lastHumanOutboundAt,
    hasFutureTask,
  };
}

export async function dryRunFollowUpEvaluation(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  remoteJid: string;
  leadId?: string | null;
  settingsOverride?: Partial<AgentFollowUpInteligente>;
  buildContext: {
    tenantId: string;
    agentId: string;
    remoteJid: string;
    leadId?: string | null;
    job?: { id: string; attempts: number; maxAttempts: number; createdAt: Date };
    loadLead: Parameters<typeof buildFollowUpEvalContext>[0]["loadLead"];
    loadConversationState: Parameters<typeof buildFollowUpEvalContext>[0]["loadConversationState"];
    loadMessageTimestamps: Parameters<typeof buildFollowUpEvalContext>[0]["loadMessageTimestamps"];
  };
}): Promise<FollowUpDryRunResult> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const { data: agentRow } = await sb
    .from("tenant_agents")
    .select("metadata")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .maybeSingle();
  const metadata =
    agentRow?.metadata && typeof agentRow.metadata === "object"
      ? (agentRow.metadata as Record<string, unknown>)
      : {};
  const baseSettings = followUpInteligenteFromMetadata(metadata);
  const settings: AgentFollowUpInteligente = {
    ...baseSettings,
    ...(params.settingsOverride ?? {}),
  };

  const job = params.buildContext.job ?? {
    id: "dry-run",
    attempts: 0,
    maxAttempts: settings.tentativasContato,
    createdAt: new Date(Date.now() - settings.intervaloVerificacaoMinutos * 60_000 - 60_000),
  };

  const evalCtx = await buildFollowUpEvalContext({
    sb,
    tenantId: params.buildContext.tenantId,
    agentId: params.buildContext.agentId,
    remoteJid: params.buildContext.remoteJid,
    leadId: params.buildContext.leadId ?? params.leadId,
    settings,
    job,
    loadLead: params.buildContext.loadLead,
    loadConversationState: params.buildContext.loadConversationState,
    loadMessageTimestamps: params.buildContext.loadMessageTimestamps,
  });

  const decision = evaluateFollowUpNeed(evalCtx);

  return {
    settings,
    decision,
    context: {
      leadId: evalCtx.lead?.id ?? null,
      leadName: evalCtx.lead?.name ?? null,
      leadStatus: evalCtx.lead?.status ?? null,
      hasFutureTask: evalCtx.hasFutureTask,
      humanPaused: evalCtx.conversationState?.humanPaused ?? false,
      conversationMode: evalCtx.conversationState?.conversationMode ?? null,
      lastCustomerMessageAt: evalCtx.lastCustomerMessageAt?.toISOString() ?? null,
      lastHumanOutboundAt: evalCtx.lastHumanOutboundAt?.toISOString() ?? null,
      jobAttempts: job.attempts,
      jobMaxAttempts: job.maxAttempts,
    },
  };
}
