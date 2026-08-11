import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { cancelPendingAgentResponseJobs } from "@/lib/server/agent-response-jobs";
import {
  type ConversationState,
  getConversationState,
  upsertConversationState,
} from "@/lib/server/conversation-memory";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export function isConversationArchived(state: {
  isHidden?: boolean;
  archivedAt?: string | null;
} | null | undefined): boolean {
  if (!state) return false;
  return state.isHidden === true || Boolean(state.archivedAt);
}

/** Pausa manual do painel (toggle) que pode ser descartada ao reabrir conversa arquivada. */
export function isStaleManualAutomationPause(state: {
  humanPaused?: boolean;
  pausedBy?: string | null;
  pausedReason?: string | null;
} | null | undefined): boolean {
  if (!state?.humanPaused) return false;
  return state.pausedReason === "manual_toggle" || state.pausedBy === "human_manual";
}

/** Bloqueios que não devem ser limpos automaticamente ao reabrir conversa arquivada. */
export function isStructuralAutomationBlock(state: {
  humanPaused?: boolean;
  pausedBy?: string | null;
  pausedReason?: string | null;
  handoffSuggested?: boolean;
} | null | undefined): boolean {
  if (!state?.humanPaused) return false;
  if (state.handoffSuggested) return true;
  if (state.pausedBy === "auto_handoff") return true;
  if (state.pausedBy === "human_command" || state.pausedReason === "manual_pause_command") {
    return true;
  }
  // Lead descartado pelo agente: reabrir uma conversa arquivada não pode
  // ressuscitar o atendimento automático por tabela.
  if (state.pausedBy === "agent_lead_outcome") return true;
  return false;
}

export function shouldResetAutomationOnArchivedReopen(
  previous: ConversationState | null | undefined,
): boolean {
  if (!isConversationArchived(previous)) return false;
  if (!previous?.humanPaused) return false;
  if (isStructuralAutomationBlock(previous)) return false;
  return isStaleManualAutomationPause(previous);
}

type InboundRevealPatch = {
  leadId?: string | null;
  agentId?: string | null;
  lastMessageAt?: string | null;
  isHidden: false;
  archivedAt: null;
  hiddenAt: null;
  hiddenBy: null;
  humanPaused?: false;
  pausedBy?: null;
  pausedReason?: null;
  conversationMode?: "automation";
  activeJourneyId?: string | null;
};

export function buildInboundRevealPatch(
  previous: ConversationState | null | undefined,
  overrides: {
    leadId?: string | null;
    agentId?: string | null;
    lastMessageAt?: string | null;
    activeJourneyId?: string | null;
  } = {},
): InboundRevealPatch {
  const patch: InboundRevealPatch = {
    isHidden: false,
    archivedAt: null,
    hiddenAt: null,
    hiddenBy: null,
    ...overrides,
  };

  if (shouldResetAutomationOnArchivedReopen(previous)) {
    patch.humanPaused = false;
    patch.pausedBy = null;
    patch.pausedReason = null;
    patch.conversationMode = "automation";
  }

  return patch;
}

export async function hideConversationsForTenant(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJids: string[];
  hiddenBy?: string | null;
  archive?: boolean;
}): Promise<number> {
  const jids = [...new Set(params.remoteJids.map((j) => j.trim()).filter(Boolean))];
  if (!jids.length) return 0;

  const sb = params.sb ?? createSupabaseServiceClient();
  const now = new Date().toISOString();
  let affected = 0;

  for (const remoteJid of jids) {
    const state = await upsertConversationState({
      sb,
      tenantId: params.tenantId,
      remoteJid,
      isHidden: true,
      archivedAt: params.archive ? now : undefined,
      hiddenAt: now,
      hiddenBy: params.hiddenBy ?? "conversas_panel",
    });
    if (state) affected += 1;
  }

  return affected;
}

/**
 * Restaura conversa(s) arquivada(s) para a caixa de entrada — a contrapartida
 * manual de `hideConversationsForTenant`. Sem isto, uma conversa arquivada
 * (ex.: por engano, pelo "Limpar tudo") só volta sozinha quando o cliente
 * manda mensagem de novo (`revealConversationOnInbound`); não havia como o
 * operador trazê-la de volta pelo painel.
 */
export async function unhideConversationsForTenant(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJids: string[];
}): Promise<number> {
  const jids = [...new Set(params.remoteJids.map((j) => j.trim()).filter(Boolean))];
  if (!jids.length) return 0;

  const sb = params.sb ?? createSupabaseServiceClient();
  let affected = 0;

  for (const remoteJid of jids) {
    const state = await upsertConversationState({
      sb,
      tenantId: params.tenantId,
      remoteJid,
      isHidden: false,
      archivedAt: null,
      hiddenAt: null,
      hiddenBy: null,
    });
    if (state) affected += 1;
  }

  return affected;
}

export async function revealConversationOnInbound(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  leadId?: string | null;
  agentId?: string | null;
  lastMessageAt?: string | null;
  previousState?: ConversationState | null;
  activeJourneyId?: string | null;
}): Promise<ConversationState | null> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const previous =
    params.previousState ??
    (await getConversationState({
      sb,
      tenantId: params.tenantId,
      remoteJid: params.remoteJid,
    }));

  const resettingAutomation = shouldResetAutomationOnArchivedReopen(previous);
  const state = await upsertConversationState({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    ...buildInboundRevealPatch(previous, {
      leadId: params.leadId,
      agentId: params.agentId,
      lastMessageAt: params.lastMessageAt,
      activeJourneyId: params.activeJourneyId,
    }),
  });

  if (resettingAutomation) {
    await cancelPendingAgentResponseJobs({
      sb,
      tenantId: params.tenantId,
      remoteJid: params.remoteJid,
      reason: "archived_reopen_reset",
    });
  }

  return state;
}

export function isConversationVisibleInInbox(state: {
  isHidden?: boolean;
  archivedAt?: string | null;
} | null | undefined): boolean {
  if (!state) return true;
  if (state.isHidden) return false;
  if (state.archivedAt) return false;
  return true;
}
