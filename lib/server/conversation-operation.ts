import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { cancelPendingAgentResponseJobs } from "@/lib/server/agent-response-jobs";
import { cancelPendingFollowUpJobs } from "@/lib/server/follow-up-jobs";
import {
  getConversationState,
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
  event?: {
    type: string;
    title: string;
    detail?: string | null;
    actorType?: string | null;
    actorId?: string | null;
    actorName?: string | null;
  };
  /** Takeover humano vence uma alteração concorrente de epoch. */
  retryOnEpochStale?: boolean;
}): Promise<ConversationState> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const maxAttempts = params.retryOnEpochStale ? 3 : 1;
  let data: unknown = null;
  let error: { code?: string; message: string } | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const current = await getConversationState({
      sb,
      tenantId: params.tenantId,
      remoteJid: params.remoteJid,
    });
    // Outro takeover já venceu a corrida. Para a proteção automática isso é
    // sucesso idempotente: não incrementa o epoch nem duplica evento.
    if (
      attempt > 0 &&
      params.mode === "human" &&
      params.humanPaused &&
      current?.humanPaused &&
      current.conversationMode === "human"
    ) {
      return current;
    }
    const response = await sb.rpc("set_conversation_operation_v3", {
      p_tenant_id: params.tenantId,
      p_remote_jid: params.remoteJid,
      p_lead_id: params.leadId ?? null,
      p_agent_id: params.agentId ?? null,
      p_mode: params.mode,
      p_human_paused: params.humanPaused,
      p_paused_reason: params.pausedReason ?? null,
      p_paused_by: params.pausedBy ?? null,
      p_handoff_suggested: params.handoffSuggested ?? false,
      p_handoff_reason: params.handoffReason ?? null,
      p_assigned_human_id: params.assignedHumanId ?? null,
      p_assigned_human_name: params.assignedHumanName ?? null,
      p_transferred_from: params.transferredFrom ?? null,
      p_transferred_to: params.transferredTo ?? null,
      p_transfer_reason: params.transferReason ?? null,
      p_expected_epoch: current?.automationEpoch ?? null,
      p_event_type: params.event?.type ?? null,
      p_event_title: params.event?.title ?? null,
      p_event_detail: params.event?.detail ?? null,
      p_actor_type: params.event?.actorType ?? null,
      p_actor_id: params.event?.actorId ?? null,
      p_actor_name: params.event?.actorName ?? null,
    });
    data = response.data;
    error = response.error;
    if (
      error?.message.includes("automation_epoch_stale") &&
      params.retryOnEpochStale &&
      attempt + 1 < maxAttempts
    ) {
      continue;
    }
    break;
  }
  if (error) {
    console.error("[conversation-operation] atomic_state_failed", {
      tenant_id: params.tenantId,
      code: error.code,
      message: error.message,
    });
    throw new Error(`conversation_operation_failed:${error.message}`);
  }
  const result = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const row = result?.state && typeof result.state === "object"
    ? (result.state as Record<string, unknown>)
    : null;
  if (!row) throw new Error("conversation_operation_failed:missing_state");
  return {
        id: String(row.id),
        tenantId: String(row.tenant_id),
        remoteJid: String(row.remote_jid),
        leadId: textOrNull(row.lead_id),
        agentId: textOrNull(row.agent_id),
        channel: String(row.channel ?? "whatsapp"),
        status: String(row.status ?? "active"),
        humanPaused: row.human_paused === true,
        pausedReason: textOrNull(row.paused_reason),
        pausedBy: textOrNull(row.paused_by),
        handoffSuggested: row.handoff_suggested === true,
        handoffReason: textOrNull(row.handoff_reason),
        lastSummaryAt: textOrNull(row.last_summary_at),
        isHidden: row.is_hidden === true,
        archivedAt: textOrNull(row.archived_at),
        conversationMode: textOrNull(row.conversation_mode),
        activeJourneyId: textOrNull(row.active_journey_id),
        automationEpoch: Number(row.automation_epoch ?? 0),
      };
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
    retryOnEpochStale: true,
    event: {
      type: "takeover",
      title: `Lead transferido da ${fromLabel} para ${params.actorName}`,
      actorType: "human",
      actorId: params.actorId,
      actorName: params.actorName,
    },
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
    event: {
      type: "return_automation",
      title: "Lead retornou para automação",
      detail: fromName ? `Transferido de ${fromName}` : null,
      actorType: "human",
      actorId: params.actorId,
      actorName: params.actorName,
    },
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
  targetEmployeeId?: string | null;
  targetEmployeeName?: string | null;
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
    assignedHumanId: params.targetEmployeeId ?? null,
    assignedHumanName: params.targetEmployeeName ?? null,
    event: {
      type: "human_transfer",
      title: `Conversa transferida para fila de espera por ${params.actorName}`,
      actorType: "human",
      actorId: params.actorId,
      actorName: params.actorName,
    },
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
  await patchConversationOperation({
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
    event: {
      type: "handoff_requested",
      title: "Cliente solicitou atendimento humano",
      detail: params.reason ?? null,
      actorType: "system",
    },
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

/** Motivo de pausa gravado quando o AGENTE descarta o lead. */
export const LEAD_OUTCOME_PAUSED_BY = "agent_lead_outcome";

export type LeadOutcomePauseReason = "disqualified" | "lost_interest";

/**
 * Encerra o atendimento automático de um lead descartado pelo agente.
 *
 * Espelha `markWaitingForHuman`, com uma diferença de intenção: ali alguém é
 * chamado para assumir; aqui ninguém é. Por isso `mode: "human"` e
 * `handoffSuggested: false` — o vendedor pode escrever se quiser, mas nada fica
 * pendurado na fila dele pedindo atenção.
 *
 * Cancelar os dois tipos de job é obrigatório, não higiene: sem isso um
 * follow-up já agendado dispara depois e o lead "descartado" continua recebendo
 * mensagem.
 */
export async function pauseConversationForLeadOutcome(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  leadId?: string | null;
  agentId?: string | null;
  outcome: LeadOutcomePauseReason;
  /** Justificativa dada pelo agente, exibida na timeline para a equipe auditar. */
  detail?: string | null;
  /** WhatsApp do atendente responsável. Só notifica quando o operador pediu. */
  notifyNumero?: string | null;
}): Promise<void> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const title =
    params.outcome === "disqualified"
      ? "Agente marcou o lead como desqualificado"
      : "Agente marcou que o lead perdeu o interesse";

  await patchConversationOperation({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    leadId: params.leadId,
    agentId: params.agentId,
    mode: "human",
    humanPaused: true,
    pausedReason: params.outcome,
    pausedBy: LEAD_OUTCOME_PAUSED_BY,
    handoffSuggested: false,
    handoffReason: null,
    event: {
      type: "lead_outcome",
      title,
      detail: params.detail ?? null,
      actorType: "agent",
      actorId: params.agentId ?? null,
    },
  });

  await cancelPendingAgentResponseJobs({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    reason: `lead_outcome_${params.outcome}`,
  });

  await cancelPendingFollowUpJobs({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    reason: `lead_outcome_${params.outcome}`,
  });

  const notifyDigits = (params.notifyNumero ?? "").replace(/\D/g, "");
  if (notifyDigits.length < 10) return;
  try {
    const instanceName = await getSystemAgentInstanceName();
    if (!instanceName) return;
    await sendSystemNotification(notifyDigits, buildLeadOutcomeNotificationText(params), instanceName, {
      type: "lead_outcome_alert",
      metadata: {
        tenant_id: params.tenantId,
        remote_jid: params.remoteJid,
        outcome: params.outcome,
        agent_id: params.agentId ?? null,
      },
    });
  } catch (error) {
    console.warn("[conversation-operation] lead_outcome_notify_error", {
      tenant_id: params.tenantId,
      error: error instanceof Error ? error.message : "notify_failed",
    });
  }
}

function buildLeadOutcomeNotificationText(params: {
  remoteJid: string;
  outcome: LeadOutcomePauseReason;
  detail?: string | null;
}): string {
  const label = params.outcome === "disqualified" ? "desqualificado" : "sem interesse";
  const phone = params.remoteJid.split("@")[0] ?? params.remoteJid;
  const reason = params.detail?.trim();
  return [
    `Lead marcado como ${label} pelo agente.`,
    `Contato: ${phone}`,
    reason ? `Motivo: ${reason}` : null,
    "O atendimento automático deste contato foi encerrado. Abra a conversa no painel para retomar.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Motivo de pausa gravado quando um disparo em massa é configurado como "mensagem única". */
export const CAMPAIGN_ONE_SHOT_PAUSED_BY = "whatsapp_campaign_one_shot";

/**
 * Encerra a automação logo após um disparo configurado como "só essa
 * mensagem" — a campanha manda o texto normalmente, mas quem responder não é
 * atendido automaticamente; um humano precisa assumir. Espelha
 * `pauseConversationForLeadOutcome`, sem as partes de notificação e sem
 * `outcome` (aqui não há descarte, só decisão de não continuar a conversa).
 *
 * Não precisa de retomada própria: o botão genérico de "reativar automação"
 * do CRM (`syncAutomationMode`) não filtra por `pausedBy`, então já destrava
 * esta pausa como qualquer outra.
 */
export async function pauseConversationAfterCampaignSend(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  leadId?: string | null;
  agentId?: string | null;
}): Promise<void> {
  const sb = params.sb ?? createSupabaseServiceClient();

  await patchConversationOperation({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    leadId: params.leadId,
    agentId: params.agentId,
    mode: "human",
    humanPaused: true,
    pausedReason: "campaign_one_shot",
    pausedBy: CAMPAIGN_ONE_SHOT_PAUSED_BY,
    handoffSuggested: false,
    handoffReason: null,
    event: {
      type: "campaign_one_shot",
      title: "Disparo configurado como mensagem única — atendimento automático não continua",
      actorType: "agent",
      actorId: params.agentId ?? null,
    },
  });
}

/**
 * Devolve a conversa à automação depois de um descarte — e SOMENTE nesse caso.
 *
 * A guarda em `pausedBy` é a parte importante: uma conversa pausada por handoff
 * ou pelo próprio vendedor jamais pode ser destravada por aqui. Devolve `true`
 * quando efetivamente retomou, para o chamador seguir com o turno.
 */
export async function resumeConversationAfterLeadOutcome(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  leadId?: string | null;
  agentId?: string | null;
}): Promise<boolean> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const state = await getConversationState({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
  });
  if (!state?.humanPaused) return false;
  if (state.pausedBy !== LEAD_OUTCOME_PAUSED_BY) return false;

  const resumed = await patchConversationOperation({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    leadId: params.leadId,
    agentId: params.agentId,
    mode: "automation",
    humanPaused: false,
    pausedReason: null,
    pausedBy: null,
    handoffSuggested: false,
    handoffReason: null,
    event: {
      type: "return_automation",
      title: "Lead descartado voltou a falar e o agente retomou",
      detail: state.pausedReason,
      actorType: "agent",
      actorId: params.agentId ?? null,
    },
  });
  if (!resumed) return false;
  return true;
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
    event: {
      type: params.enabled ? "automation_resumed" : "automation_paused",
      title: params.enabled ? "Automação reativada" : "Automação pausada",
      actorType: "human",
      actorId: params.actorId ?? null,
      actorName: params.actorName ?? null,
    },
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
