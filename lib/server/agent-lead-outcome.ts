/**
 * Descarte de lead pelo agente: desqualificado ou sem interesse.
 *
 * É a única automação TERMINAL do agente. As outras movem um card; se errarem,
 * alguém arrasta de volta. Esta encerra o atendimento automático daquele lead:
 * o agente para de responder e nenhum follow-up é enviado. Por isso todo o
 * caminho aqui é conservador — nada acontece sem configuração explícita do dono
 * do agente, e tudo que acontece fica registrado.
 *
 * A decisão vem do campo `leadOutcome` do contrato estruturado do turno
 * (`lib/ai/agent-turn-plan.ts`), não de leitura de sentimento sobre a prosa.
 *
 * Como `applyAgentCrmMove`, nunca lança: a resposta ao lead já foi enviada
 * quando isto roda, e falhar aqui não pode derrubar nada.
 */
import type { AgentLeadOutcome } from "@/lib/ai/agent-turn-plan";
import { applyAgentCrmMove, type AgentCrmMoveAction } from "@/lib/server/agent-crm-move";
import { getConversationState } from "@/lib/server/conversation-memory";
import {
  LEAD_OUTCOME_PAUSED_BY,
  pauseConversationForLeadOutcome,
  resumeConversationAfterLeadOutcome,
  type LeadOutcomePauseReason,
} from "@/lib/server/conversation-operation";
import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type ResolvedLeadOutcomeConfig = {
  ativo: boolean;
  criterios: string;
  funnelId: string | null;
  columnId: string | null;
  retomarAoVoltar: boolean;
  notificar: boolean;
};

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const METADATA_KEY: Record<LeadOutcomePauseReason, string> = {
  disqualified: "leadOutcomeDisqualified",
  lost_interest: "leadOutcomeLostInterest",
};

const CRM_ACTION: Record<LeadOutcomePauseReason, AgentCrmMoveAction> = {
  disqualified: "lead_disqualified",
  lost_interest: "lead_lost_interest",
};

/**
 * Lê a config de uma das duas automações no metadata do agente.
 *
 * `criterios` vazio invalida a automação inteira, mesmo com `ativo: true`. Sem
 * os critérios do negócio o prompt não autoriza o modelo a declarar o desfecho —
 * se um desfecho chegou assim mesmo, ele não tem lastro e não deve produzir
 * efeito.
 */
export function resolveLeadOutcomeConfig(
  metadata: Record<string, unknown> | null | undefined,
  outcome: LeadOutcomePauseReason,
): ResolvedLeadOutcomeConfig | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = metadata[METADATA_KEY[outcome]];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const config = raw as Record<string, unknown>;
  if (config.ativo !== true) return null;
  const criterios = textOrNull(config.criterios);
  if (!criterios) return null;
  return {
    ativo: true,
    criterios,
    funnelId: textOrNull(config.funnelId),
    columnId: textOrNull(config.columnId),
    retomarAoVoltar: config.retomarAoVoltar === true,
    notificar: config.notificar === true,
  };
}

/** Traduz a ação do contrato estruturado para o desfecho interno. */
export function leadOutcomePauseReason(
  outcome: AgentLeadOutcome | null | undefined,
): LeadOutcomePauseReason | null {
  if (!outcome) return null;
  if (outcome.action === "disqualified") return "disqualified";
  if (outcome.action === "lost_interest") return "lost_interest";
  return null;
}

async function loadAgentMetadata(
  sb: SupabaseServiceClient,
  tenantId: string,
  agentId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await sb
    .from("tenant_agents")
    .select("metadata")
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const metadata = (data as { metadata?: unknown }).metadata;
  return metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : null;
}

/**
 * Aplica o desfecho declarado pelo agente.
 *
 * Chamar SEMPRE depois de enviar a resposta do turno: o lead recebe a última
 * mensagem e só então o silêncio começa. Cortar antes parece defeito.
 */
export async function applyAgentLeadOutcome(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  agentId?: string | null;
  leadId?: string | null;
  outcome: AgentLeadOutcome | null | undefined;
  /** Metadata já carregado pelo chamador; evita uma leitura extra no caminho quente. */
  metadata?: Record<string, unknown> | null;
}): Promise<"applied" | "skipped" | "failed"> {
  try {
    const reason = leadOutcomePauseReason(params.outcome);
    if (!reason) return "skipped";

    const agentId = textOrNull(params.agentId);
    if (!agentId || agentId === "human") return "skipped";

    const metadata =
      params.metadata ?? (await loadAgentMetadata(params.sb, params.tenantId, agentId));
    const config = resolveLeadOutcomeConfig(metadata, reason);
    // O modelo declarou um desfecho que este agente não tem configurado.
    // Acontece com prompt customizado do cliente; ignorar é o certo.
    if (!config) {
      console.info("[agent-lead-outcome] not_configured", {
        tenant_id: params.tenantId,
        agent_id: agentId,
        outcome: reason,
      });
      return "skipped";
    }

    await applyAgentCrmMove({
      sb: params.sb,
      tenantId: params.tenantId,
      action: CRM_ACTION[reason],
      agentId,
      leadId: params.leadId,
    });

    await pauseConversationForLeadOutcome({
      sb: params.sb,
      tenantId: params.tenantId,
      remoteJid: params.remoteJid,
      leadId: params.leadId,
      agentId,
      outcome: reason,
      detail: params.outcome?.reason ?? null,
      notifyNumero: config.notificar ? textOrNull(metadata?.handoffNumero) : null,
    });

    console.info("[agent-lead-outcome] lead_discarded", {
      tenant_id: params.tenantId,
      agent_id: agentId,
      lead_id: params.leadId ?? null,
      outcome: reason,
    });
    return "applied";
  } catch (err) {
    console.warn("[agent-lead-outcome] unexpected_error", {
      tenant_id: params.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}

/**
 * Destrava um lead descartado que voltou a falar — quando o operador escolheu
 * isso na automação que o descartou.
 *
 * Roda ANTES do portão `isAgentAutomationAllowed`: com a conversa pausada o
 * agente nunca chegaria a ver a mensagem, e o lead ficaria falando sozinho para
 * sempre.
 *
 * Quem decide é a config da automação que causou a pausa — `paused_reason`
 * guarda qual foi. Desligado (padrão) devolve `false` e a pausa continua de pé,
 * esperando o vendedor liberar no painel.
 */
export async function resumeAfterLeadOutcomeIfConfigured(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  agentId?: string | null;
  leadId?: string | null;
  /**
   * Estado da pausa, quando o chamador já o tem em mãos. Sem isso a função lê
   * do banco — necessário no processamento de job, que não passa pelo webhook.
   */
  pausedBy?: string | null;
  pausedReason?: string | null;
}): Promise<boolean> {
  try {
    const agentId = textOrNull(params.agentId);
    if (!agentId) return false;

    let pausedBy = params.pausedBy;
    let pausedReason = params.pausedReason;
    if (pausedBy === undefined) {
      const state = await getConversationState({
        sb: params.sb,
        tenantId: params.tenantId,
        remoteJid: params.remoteJid,
      });
      if (!state?.humanPaused) return false;
      pausedBy = state.pausedBy;
      pausedReason = state.pausedReason;
    }
    if (pausedBy !== LEAD_OUTCOME_PAUSED_BY) return false;

    const reason =
      pausedReason === "disqualified" || pausedReason === "lost_interest"
        ? (pausedReason as LeadOutcomePauseReason)
        : null;
    if (!reason) return false;

    const metadata = await loadAgentMetadata(params.sb, params.tenantId, agentId);
    const config = resolveLeadOutcomeConfig(metadata, reason);
    if (!config?.retomarAoVoltar) return false;

    const resumed = await resumeConversationAfterLeadOutcome({
      sb: params.sb,
      tenantId: params.tenantId,
      remoteJid: params.remoteJid,
      leadId: params.leadId,
      agentId,
    });
    if (!resumed) return false;

    // O card volta pelo destino de "quando o lead responder" que o operador já
    // configurou — reaproveitar evita inventar mais um campo para a mesma ideia.
    await applyAgentCrmMove({
      sb: params.sb,
      tenantId: params.tenantId,
      action: "lead_replied",
      agentId,
      leadId: params.leadId,
    });

    console.info("[agent-lead-outcome] resumed_after_return", {
      tenant_id: params.tenantId,
      agent_id: agentId,
      outcome: reason,
    });
    return true;
  } catch (err) {
    console.warn("[agent-lead-outcome] resume_unexpected_error", {
      tenant_id: params.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
