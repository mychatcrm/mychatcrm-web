import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { cancelPendingAgentResponseJobs } from "@/lib/server/agent-response-jobs";
import { cancelPendingFollowUpJobs } from "@/lib/server/follow-up-jobs";
import {
  getConversationState,
  upsertConversationState,
  type ConversationState,
} from "@/lib/server/conversation-memory";
import { getSystemAgentInstanceName, sendSystemNotification } from "@/lib/server/system-agent";
import { buildHandoffNotificationText } from "@/lib/server/handoff-notification-builder";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type ConversationMode = "automation" | "waiting_human" | "human";

export type ConversationOperationSnapshot = {
  conversation_mode: ConversationMode;
  assigned_human_id: string | null;
  assigned_human_name: string | null;
  agent_id: string | null;
  handoff_suggested: boolean;
  can_human_send: boolean;
  human_paused: boolean;
  paused_reason: string | null;
};

export type ConversationEventRecord = {
  id: string;
  event_type: string;
  title: string;
  detail: string | null;
  actor_type: string | null;
  actor_id: string | null;
  actor_name: string | null;
  transferred_from: string | null;
  transferred_to: string | null;
  transfer_reason: string | null;
  created_at: string;
};

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function deriveConversationMode(input: {
  conversationMode?: string | null;
  humanPaused?: boolean;
  handoffSuggested?: boolean;
  pausedReason?: string | null;
}): ConversationMode {
  const explicit = textOrNull(input.conversationMode);
  if (explicit === "automation" || explicit === "waiting_human" || explicit === "human") {
    return explicit;
  }
  if (input.handoffSuggested) return "waiting_human";
  if (input.humanPaused) return "human";
  return "automation";
}

export function canHumanSendMessage(mode: ConversationMode): boolean {
  return mode !== "automation";
}

/** Gate unificado: webhook e scheduler usam a mesma regra. */
export async function isAgentAutomationAllowed(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  agentId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const state = await getConversationState({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
  });
  const opRow = await loadStateOperationRow({
    sb,
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
  const status = typeof metadata.status === "string" ? metadata.status : "ativo";
  if (status === "inativo" || status === "pausado") {
    return { ok: false, reason: "agent_inactive" };
  }
  return { ok: true };
}

export function buildOperationSnapshot(
  state: ConversationState | null,
  extra?: {
    conversationMode?: string | null;
    assignedHumanId?: string | null;
    assignedHumanName?: string | null;
  },
): ConversationOperationSnapshot {
  const conversation_mode = deriveConversationMode({
    conversationMode: extra?.conversationMode ?? null,
    humanPaused: state?.humanPaused,
    handoffSuggested: state?.handoffSuggested,
    pausedReason: state?.pausedReason,
  });
  return {
    conversation_mode,
    assigned_human_id: extra?.assignedHumanId ?? null,
    assigned_human_name: extra?.assignedHumanName ?? null,
    agent_id: state?.agentId ?? null,
    handoff_suggested: state?.handoffSuggested ?? false,
    can_human_send: canHumanSendMessage(conversation_mode),
    human_paused: state?.humanPaused ?? false,
    paused_reason: state?.pausedReason ?? null,
  };
}

export async function logConversationEvent(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  leadId?: string | null;
  stateId?: string | null;
  eventType: string;
  title: string;
  detail?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  transferredFrom?: string | null;
  transferredTo?: string | null;
  transferReason?: string | null;
}): Promise<ConversationEventRecord | null> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const { data, error } = await sb
    .from("conversation_events")
    .insert({
      tenant_id: params.tenantId,
      remote_jid: params.remoteJid,
      lead_id: params.leadId ?? null,
      conversation_state_id: params.stateId ?? null,
      event_type: params.eventType,
      title: params.title,
      detail: params.detail ?? null,
      actor_type: params.actorType ?? null,
      actor_id: params.actorId ?? null,
      actor_name: params.actorName ?? null,
      transferred_from: params.transferredFrom ?? null,
      transferred_to: params.transferredTo ?? null,
      transfer_reason: params.transferReason ?? null,
    })
    .select(
      "id, event_type, title, detail, actor_type, actor_id, actor_name, transferred_from, transferred_to, transfer_reason, created_at",
    )
    .single();

  if (error) {
    console.warn("[conversation-operation] log event", error.code, error.message);
    return null;
  }
  return data as ConversationEventRecord;
}

async function patchConversationOperation(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  leadId?: string | null;
  agentId?: string | null;
  mode: ConversationMode;
  humanPaused: boolean;
  pausedReason?: string | null;
  pausedBy?: string | null;
  handoffSuggested?: boolean;
  handoffReason?: string | null;
  assignedHumanId?: string | null;
  assignedHumanName?: string | null;
  transferredFrom?: string | null;
  transferredTo?: string | null;
  transferReason?: string | null;
}): Promise<ConversationState | null> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    tenant_id: params.tenantId,
    remote_jid: params.remoteJid,
    channel: "whatsapp",
    updated_at: now,
    conversation_mode: params.mode,
    human_paused: params.humanPaused,
    paused_reason: params.pausedReason ?? null,
    paused_by: params.pausedBy ?? null,
    handoff_suggested: params.handoffSuggested ?? false,
    handoff_reason: params.handoffReason ?? null,
    assigned_human_id: params.assignedHumanId ?? null,
    assigned_human_name: params.assignedHumanName ?? null,
    transferred_from: params.transferredFrom ?? null,
    transferred_to: params.transferredTo ?? null,
    transfer_reason: params.transferReason ?? null,
    status: params.humanPaused ? "human_paused" : "active",
  };
  if (params.leadId !== undefined) patch.lead_id = params.leadId;
  if (params.agentId !== undefined) patch.agent_id = params.agentId;
  if (params.humanPaused) patch.paused_at = now;
  else patch.resumed_at = now;

  const { data, error } = await sb
    .from("conversation_states")
    .upsert(patch, { onConflict: "tenant_id,remote_jid,channel" })
    .select("*")
    .single();
  if (error) {
    console.warn("[conversation-operation] patch state", error.code, error.message);
    return null;
  }
  return data
    ? {
        id: String(data.id),
        tenantId: String(data.tenant_id),
        remoteJid: String(data.remote_jid),
        leadId: textOrNull(data.lead_id),
        agentId: textOrNull(data.agent_id),
        channel: String(data.channel ?? "whatsapp"),
        status: String(data.status ?? "active"),
        humanPaused: data.human_paused === true,
        pausedReason: textOrNull(data.paused_reason),
        pausedBy: textOrNull(data.paused_by),
        handoffSuggested: data.handoff_suggested === true,
        handoffReason: textOrNull(data.handoff_reason),
        lastSummaryAt: textOrNull(data.last_summary_at),
        isHidden: data.is_hidden === true,
        archivedAt: textOrNull(data.archived_at),
      }
    : null;
}

export async function takeoverConversation(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  actorId: string;
  actorName: string;
  agentId?: string | null;
  leadId?: string | null;
}): Promise<{ state: ConversationState | null; operation: ConversationOperationSnapshot }> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const previous = await getConversationState({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
  });
  const previousRow = await loadStateOperationRow({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
  });
  const fromLabel =
    deriveConversationMode({
      conversationMode: typeof previousRow?.conversation_mode === "string" ? previousRow.conversation_mode : null,
      humanPaused: previous?.humanPaused,
      handoffSuggested: previous?.handoffSuggested,
      pausedReason: previous?.pausedReason,
    }) === "automation"
      ? "automação"
      : (typeof previousRow?.assigned_human_name === "string" ? previousRow.assigned_human_name : null) ??
        "atendimento anterior";

  const state = await patchConversationOperation({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    leadId: params.leadId ?? previous?.leadId ?? null,
    agentId: params.agentId ?? previous?.agentId ?? null,
    mode: "human",
    humanPaused: true,
    pausedReason: "human_takeover",
    pausedBy: "human_manual",
    handoffSuggested: false,
    handoffReason: null,
    assignedHumanId: params.actorId,
    assignedHumanName: params.actorName,
    transferredFrom: fromLabel,
    transferredTo: params.actorName,
    transferReason: "takeover",
  });

  await logConversationEvent({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    leadId: params.leadId ?? previous?.leadId ?? null,
    stateId: state?.id ?? null,
    eventType: "takeover",
    title: `Lead transferido da ${fromLabel} para ${params.actorName}`,
    actorType: "human",
    actorId: params.actorId,
    actorName: params.actorName,
    transferredFrom: fromLabel,
    transferredTo: params.actorName,
    transferReason: "takeover",
  });

  await cancelPendingAgentResponseJobs({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    reason: "human_takeover",
  });

  return {
    state,
    operation: buildOperationSnapshot(state, {
      conversationMode: "human",
      assignedHumanId: params.actorId,
      assignedHumanName: params.actorName,
    }),
  };
}

export async function returnConversationToAutomation(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  actorId: string;
  actorName: string;
  agentId?: string | null;
  leadId?: string | null;
}): Promise<{ state: ConversationState | null; operation: ConversationOperationSnapshot }> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const previous = await getConversationState({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
  });
  const previousRow = await loadStateOperationRow({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
  });
  const fromName =
    (typeof previousRow?.assigned_human_name === "string" ? previousRow.assigned_human_name : null) ??
    params.actorName;

  const state = await patchConversationOperation({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    leadId: params.leadId ?? previous?.leadId ?? null,
    agentId: params.agentId ?? previous?.agentId ?? null,
    mode: "automation",
    humanPaused: false,
    pausedReason: null,
    pausedBy: null,
    handoffSuggested: false,
    handoffReason: null,
    assignedHumanId: null,
    assignedHumanName: null,
    transferredFrom: fromName,
    transferredTo: "automação",
    transferReason: "return_automation",
  });

  await logConversationEvent({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    leadId: params.leadId ?? previous?.leadId ?? null,
    stateId: state?.id ?? null,
    eventType: "return_automation",
    title: "Lead retornou para automação",
    detail: fromName ? `Transferido de ${fromName}` : null,
    actorType: "human",
    actorId: params.actorId,
    actorName: params.actorName,
    transferredFrom: fromName,
    transferredTo: "automação",
    transferReason: "return_automation",
  });

  return {
    state,
    operation: buildOperationSnapshot(state, { conversationMode: "automation" }),
  };
}

export async function transferConversationToWaiting(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  actorId: string;
  actorName: string;
}): Promise<{ state: ConversationState | null; operation: ConversationOperationSnapshot }> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const state = await patchConversationOperation({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    mode: "waiting_human",
    humanPaused: true,
    pausedReason: "human_transfer",
    pausedBy: "human_manual",
    handoffSuggested: false,
    assignedHumanId: null,
    assignedHumanName: null,
  });
  await logConversationEvent({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    leadId: null,
    stateId: state?.id ?? null,
    eventType: "human_transfer",
    title: `Conversa transferida para fila de espera por ${params.actorName}`,
    detail: null,
    actorType: "human",
    actorId: params.actorId,
    actorName: params.actorName,
  });
  return {
    state,
    operation: buildOperationSnapshot(state, { conversationMode: "waiting_human" }),
  };
}

export async function markWaitingForHuman(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  leadId?: string | null;
  agentId?: string | null;
  reason?: string | null;
  handoffNumero?: string | null;
  lastMessage?: string | null;
}): Promise<void> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const state = await patchConversationOperation({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    leadId: params.leadId,
    agentId: params.agentId,
    mode: "waiting_human",
    humanPaused: true,
    pausedReason: params.reason ?? "handoff",
    pausedBy: "auto_handoff",
    handoffSuggested: true,
    handoffReason: params.reason ?? "handoff",
  });

  await logConversationEvent({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    leadId: params.leadId ?? null,
    stateId: state?.id ?? null,
    eventType: "handoff_requested",
    title: "Cliente solicitou atendimento humano",
    detail: params.reason ?? null,
    actorType: "system",
    transferReason: params.reason ?? "handoff",
  });

  await cancelPendingAgentResponseJobs({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    reason: "handoff_waiting_human",
  });

  await cancelPendingFollowUpJobs({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    reason: "handoff_waiting_human",
  });

  const handoffDigits = (params.handoffNumero ?? "").replace(/\D/g, "");
  console.log("[HANDOFF_DEBUG] markWaitingForHuman", {
    tenant_id: params.tenantId,
    remote_jid: params.remoteJid,
    handoffNumero_raw: params.handoffNumero ?? "(null)",
    handoffDigits,
    handoffDigits_length: handoffDigits.length,
    reason: params.reason ?? "handoff",
  });
  if (handoffDigits.length >= 10) {
    try {
      // A notificação ao atendente SEMPRE usa a instância do system agent (/admin/system-agent).
      // Nunca usa a instância do agente que atendeu o lead (job.instance_name).
      const instanceName = await getSystemAgentInstanceName();
      console.log("[HANDOFF_DEBUG] system agent instance:", instanceName ?? "(null — notificação não será enviada)");
      if (!instanceName) {
        console.warn("[conversation-operation] handoff_notify_skipped — system agent instance not configured", {
          tenant_id: params.tenantId,
        });
        return;
      }
      const notifyText = await buildHandoffNotificationText({
        sb,
        tenantId: params.tenantId,
        remoteJid: params.remoteJid,
        reason: params.reason,
      });
      await sendSystemNotification(handoffDigits, notifyText, instanceName, {
        type: "handoff_alert",
        metadata: {
          tenant_id: params.tenantId,
          remote_jid: params.remoteJid,
          reason: params.reason ?? "handoff",
          agent_id: params.agentId ?? null,
        },
      });
    } catch (error) {
      console.warn("[conversation-operation] handoff_notify_error", {
        tenant_id: params.tenantId,
        error: error instanceof Error ? error.message : "notify_failed",
      });
    }
  }
}

export async function syncAutomationMode(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  enabled: boolean;
  actorId?: string | null;
  actorName?: string | null;
  leadId?: string | null;
  agentId?: string | null;
}): Promise<ConversationMode> {
  const mode: ConversationMode = params.enabled ? "automation" : "human";
  await patchConversationOperation({
    sb: params.sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    leadId: params.leadId,
    agentId: params.agentId,
    mode,
    humanPaused: !params.enabled,
    pausedReason: params.enabled ? null : "manual_toggle",
    pausedBy: params.enabled ? null : "human_manual",
    handoffSuggested: false,
    handoffReason: null,
    assignedHumanId: params.enabled ? null : params.actorId ?? null,
    assignedHumanName: params.enabled ? null : params.actorName ?? null,
  });

  await logConversationEvent({
    sb: params.sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    leadId: params.leadId ?? null,
    eventType: params.enabled ? "automation_resumed" : "automation_paused",
    title: params.enabled ? "Automação reativada" : "Automação pausada",
    actorType: "human",
    actorId: params.actorId ?? null,
    actorName: params.actorName ?? null,
  });

  if (!params.enabled) {
    await cancelPendingAgentResponseJobs({
      sb: params.sb,
      tenantId: params.tenantId,
      remoteJid: params.remoteJid,
      reason: "automation_paused",
    });
  }

  return mode;
}

export async function loadConversationEvents(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  leadId?: string | null;
  remoteJid?: string | null;
  limit?: number;
}): Promise<ConversationEventRecord[]> {
  const sb = params.sb ?? createSupabaseServiceClient();
  let query = sb
    .from("conversation_events")
    .select(
      "id, event_type, title, detail, actor_type, actor_id, actor_name, transferred_from, transferred_to, transfer_reason, created_at",
    )
    .eq("tenant_id", params.tenantId)
    .order("created_at", { ascending: true })
    .limit(params.limit ?? 200);

  if (params.leadId) query = query.eq("lead_id", params.leadId);
  else if (params.remoteJid) query = query.eq("remote_jid", params.remoteJid);
  else return [];

  const { data, error } = await query;
  if (error) {
    console.warn("[conversation-operation] load events", error.code, error.message);
    return [];
  }
  return (data ?? []) as ConversationEventRecord[];
}

export async function loadStateOperationRow(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
}): Promise<Record<string, unknown> | null> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const { data } = await sb
    .from("conversation_states")
    .select(
      "id, agent_id, human_paused, paused_reason, paused_by, handoff_suggested, handoff_reason, conversation_mode, assigned_human_id, assigned_human_name",
    )
    .eq("tenant_id", params.tenantId)
    .eq("remote_jid", params.remoteJid)
    .eq("channel", "whatsapp")
    .maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}

export function operationFromStateRow(row: Record<string, unknown> | null): ConversationOperationSnapshot {
  return buildOperationSnapshot(
    row
      ? {
          id: String(row.id ?? ""),
          tenantId: "",
          remoteJid: "",
          leadId: null,
          agentId: textOrNull(row.agent_id),
          channel: "whatsapp",
          status: "active",
          humanPaused: row.human_paused === true,
          pausedReason: textOrNull(row.paused_reason),
          pausedBy: textOrNull(row.paused_by),
          handoffSuggested: row.handoff_suggested === true,
          handoffReason: textOrNull(row.handoff_reason),
          lastSummaryAt: null,
          isHidden: false,
          archivedAt: null,
        }
      : null,
    {
      conversationMode: textOrNull(row?.conversation_mode),
      assignedHumanId: textOrNull(row?.assigned_human_id),
      assignedHumanName: textOrNull(row?.assigned_human_name),
    },
  );
}
