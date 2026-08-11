/**
 * Move o card do lead no CRM quando um evento do agente acontece — se (e
 * somente se) o dono da conta tiver configurado aquele destino no agente.
 *
 * Eventos suportados hoje: agendamento criado/remarcado, agendamento
 * cancelado, e a primeira resposta do lead.
 *
 * Efeito colateral deliberadamente isolado: `applyAgentCrmMove` nunca lança.
 * Nem um agendamento confirmado nem uma resposta ao lead podem falhar porque o
 * CRM não pôde ser atualizado.
 */
import { normalizeWhatsAppPhone } from "@/lib/server/auto-lead-upsert";
import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type AgentCrmMoveAction =
  | "scheduled"
  | "rescheduled"
  | "cancelled"
  | "lead_replied"
  | "follow_up_sent"
  | "follow_up_exhausted"
  | "lead_returned_after_exhausted";

export type AgentCrmMoveTarget = {
  funnelId: string;
  columnId: string;
};

const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);

function isMissingColumn(
  error: { code?: string; message?: string } | null | undefined,
  column: string,
): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return Boolean(error?.code && MISSING_COLUMN_CODES.has(error.code)) || message.includes(column);
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Resolve o destino a partir do `metadata` do agente (mesma fonte que já
 * alimenta `agendaAutomationEnabled` no runtime de resposta).
 *
 * Portões, em ordem — qualquer um deles devolve `null` e nada é movido:
 *  1. só para as ações de agenda: o agente não pode mexer na agenda
 *     (`agendaAutomationEnabled`). `lead_replied` não depende da agenda e por
 *     isso NÃO passa por esse portão;
 *  2. o move daquela ação está desligado;
 *  3. funil ou coluna faltando.
 *
 * `rescheduled` reusa o destino de `scheduled`: remarcar mantém o card na
 * coluna de agendado (a escrita é idempotente).
 */
export function resolveAgentCrmMoveTarget(
  metadata: Record<string, unknown> | null | undefined,
  action: AgentCrmMoveAction,
): AgentCrmMoveTarget | null {
  if (!metadata || typeof metadata !== "object") return null;

  if (action === "lead_replied") {
    if (metadata.crmMoveOnLeadReplyEnabled !== true) return null;
    const funnelId = textOrNull(metadata.crmReplyFunnelId);
    const columnId = textOrNull(metadata.crmReplyColumnId);
    if (!funnelId || !columnId) return null;
    return { funnelId, columnId };
  }

  // Destinos do ciclo de follow-up. Ficam dentro de `followUpInteligente`
  // porque é lá que o dono da conta configura o follow-up — e todos dependem
  // do follow-up estar ativo, senão o evento que os dispara nunca acontece.
  if (
    action === "follow_up_sent" ||
    action === "follow_up_exhausted" ||
    action === "lead_returned_after_exhausted"
  ) {
    const followUp =
      metadata.followUpInteligente && typeof metadata.followUpInteligente === "object"
        ? (metadata.followUpInteligente as Record<string, unknown>)
        : null;
    if (!followUp || followUp.ativo !== true) return null;

    const config =
      action === "follow_up_sent"
        ? {
            enabled: followUp.crmMoveOnFollowUpEnabled,
            funnelId: followUp.crmFollowUpFunnelId,
            columnId: followUp.crmFollowUpColumnId,
          }
        : action === "follow_up_exhausted"
          ? {
              enabled: followUp.crmMoveOnExhaustedEnabled,
              funnelId: followUp.crmExhaustedFunnelId,
              columnId: followUp.crmExhaustedColumnId,
            }
          : {
              enabled: followUp.crmMoveOnReturnAfterExhaustedEnabled,
              funnelId: followUp.crmReturnFunnelId,
              columnId: followUp.crmReturnColumnId,
            };

    if (config.enabled !== true) return null;
    const funnelId = textOrNull(config.funnelId);
    const columnId = textOrNull(config.columnId);
    if (!funnelId || !columnId) return null;
    return { funnelId, columnId };
  }

  if (metadata.agendaAutomationEnabled !== true) return null;

  const cancelling = action === "cancelled";
  const enabled = cancelling
    ? metadata.agendaCrmMoveOnCancelEnabled
    : metadata.agendaCrmMoveOnScheduleEnabled;
  if (enabled !== true) return null;

  const funnelId = textOrNull(
    cancelling ? metadata.agendaCrmCancelFunnelId : metadata.agendaCrmScheduleFunnelId,
  );
  const columnId = textOrNull(
    cancelling ? metadata.agendaCrmCancelColumnId : metadata.agendaCrmScheduleColumnId,
  );
  if (!funnelId || !columnId) return null;

  return { funnelId, columnId };
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
 * Descobre o lead do compromisso. `agenda_events.lead_id` é o caminho normal;
 * o telefone do participante é a rede de segurança para eventos antigos ou
 * criados antes de o lead existir.
 */
async function resolveLeadId(
  sb: SupabaseServiceClient,
  tenantId: string,
  leadId: string | null,
  attendeePhone: string | null,
): Promise<string | null> {
  if (leadId) return leadId;

  const phone = normalizeWhatsAppPhone(attendeePhone);
  if (!phone) return null;

  const { data, error } = await sb
    .from("leads")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("phone", phone)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return textOrNull((data as { id?: unknown }).id);
}

type CardOwnership = {
  status: string | null;
  agentColumnId: string | null;
  /** Alguém arrastou o card depois do último move do agente. */
  movedByHuman: boolean;
};

/**
 * Descobre se o card ainda está sob controle da automação.
 *
 * `agent_crm_column_id` guarda a última coluna aplicada pelo agente. Se o
 * `status` atual divergir dela, alguém moveu o card à mão desde então — e a
 * automação para de mexer, para não desfazer a organização da equipe.
 *
 * Nulo (agente nunca moveu, ou base sem a coluna ainda) não é tratado como
 * movimentação manual: sem procedência gravada não há o que respeitar, e
 * bloquear aí desligaria a funcionalidade inteira em quem ainda não migrou.
 */
async function resolveCardOwnership(
  sb: SupabaseServiceClient,
  tenantId: string,
  leadId: string,
): Promise<CardOwnership | "not_found"> {
  const { data, error } = await sb
    .from("leads")
    .select("status, agent_crm_column_id")
    .eq("tenant_id", tenantId)
    .eq("id", leadId)
    .maybeSingle();

  if (error) {
    if (isMissingColumn(error, "agent_crm_column_id")) {
      const legacy = await sb
        .from("leads")
        .select("status")
        .eq("tenant_id", tenantId)
        .eq("id", leadId)
        .maybeSingle();
      if (!legacy.data) return "not_found";
      return {
        status: textOrNull((legacy.data as { status?: unknown }).status),
        agentColumnId: null,
        movedByHuman: false,
      };
    }
    return "not_found";
  }
  if (!data) return "not_found";

  const row = data as { status?: unknown; agent_crm_column_id?: unknown };
  const status = textOrNull(row.status);
  const agentColumnId = textOrNull(row.agent_crm_column_id);
  return {
    status,
    agentColumnId,
    movedByHuman: Boolean(agentColumnId) && status !== agentColumnId,
  };
}

export async function applyAgentCrmMove(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  action: AgentCrmMoveAction;
  agentId?: string | null;
  leadId?: string | null;
  attendeePhone?: string | null;
}): Promise<"moved" | "skipped" | "failed"> {
  try {
    const agentId = textOrNull(params.agentId);
    // Compromisso criado à mão, sem agente vinculado: não há configuração a
    // aplicar. Idem para o agente do sistema ("human" é o autor manual).
    if (!agentId || agentId === "human") return "skipped";

    const metadata = await loadAgentMetadata(params.sb, params.tenantId, agentId);
    const target = resolveAgentCrmMoveTarget(metadata, params.action);
    if (!target) return "skipped";

    const leadId = await resolveLeadId(
      params.sb,
      params.tenantId,
      textOrNull(params.leadId),
      textOrNull(params.attendeePhone),
    );
    if (!leadId) {
      console.info("[agent-crm-move] lead_not_found", {
        tenant_id: params.tenantId,
        agent_id: agentId,
        action: params.action,
      });
      return "skipped";
    }

    const ownership = await resolveCardOwnership(params.sb, params.tenantId, leadId);
    if (ownership === "not_found") return "skipped";
    if (ownership.movedByHuman) {
      console.info("[agent-crm-move] skipped_manual_move", {
        tenant_id: params.tenantId,
        lead_id: leadId,
        action: params.action,
        current_status: ownership.status,
        agent_column: ownership.agentColumnId,
      });
      return "skipped";
    }
    // Já está no destino: não regrava (o move roda a cada resposta do lead).
    if (ownership.status === target.columnId) return "skipped";

    const patch: Record<string, unknown> = {
      status: target.columnId,
      crm_funnel_id: target.funnelId,
      // Procedência: marca que foi o agente que pôs o card aqui, para que um
      // arrasto manual depois disto seja detectável.
      agent_crm_column_id: target.columnId,
      updated_at: new Date().toISOString(),
    };

    const { error } = await params.sb
      .from("leads")
      .update(patch)
      .eq("tenant_id", params.tenantId)
      .eq("id", leadId);

    if (error) {
      // Base sem alguma das colunas opcionais (instalação anterior às
      // migrations): tenta de novo só com o essencial, que é a etapa.
      if (isMissingColumn(error, "crm_funnel_id") || isMissingColumn(error, "agent_crm_column_id")) {
        const {
          crm_funnel_id: _funnel,
          agent_crm_column_id: _agentColumn,
          ...fallback
        } = patch;
        const { error: fallbackError } = await params.sb
          .from("leads")
          .update(fallback)
          .eq("tenant_id", params.tenantId)
          .eq("id", leadId);
        if (!fallbackError) return "moved";
      }
      console.warn("[agent-crm-move] update_failed", {
        tenant_id: params.tenantId,
        lead_id: leadId,
        action: params.action,
        code: error.code,
        error: error.message,
      });
      return "failed";
    }

    console.info("[agent-crm-move] lead_moved", {
      tenant_id: params.tenantId,
      lead_id: leadId,
      agent_id: agentId,
      action: params.action,
      funnel_id: target.funnelId,
      column_id: target.columnId,
    });
    return "moved";
  } catch (err) {
    console.warn("[agent-crm-move] unexpected_error", {
      tenant_id: params.tenantId,
      action: params.action,
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}

/**
 * Move o card quando o lead responde.
 *
 * Duas ações possíveis, decididas pelo estado do follow-up: um lead que já
 * tinha esgotado as tentativas e volta a falar é um lead recuperado, e merece
 * destino próprio — o vendedor precisa ver que não é um lead comum.
 *
 * A idempotência NÃO vem mais de `first_reply_at` (que só permitia mover uma
 * vez na vida e travava o ciclo responder → sumir → follow-up → responder de
 * novo). Quem decide agora é `applyAgentCrmMove`: não move card arrastado à
 * mão, e não regrava quando já está no destino. `first_reply_at` continua
 * sendo carimbado porque é dado útil por si só.
 */
export async function applyCrmMoveOnLeadReply(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId?: string | null;
  leadId?: string | null;
}): Promise<"moved" | "skipped" | "failed"> {
  try {
    const leadId = textOrNull(params.leadId);
    if (!leadId) return "skipped";

    const followUpStatus = await loadFollowUpStatus(params.sb, params.tenantId, leadId);
    const action: AgentCrmMoveAction =
      followUpStatus === "exhausted" || followUpStatus === "inactive"
        ? "lead_returned_after_exhausted"
        : "lead_replied";

    // Carimbo da primeira resposta: dado, não trava. Falha aqui não impede o move.
    await stampFirstReply(params.sb, params.tenantId, leadId);

    return await applyAgentCrmMove({
      sb: params.sb,
      tenantId: params.tenantId,
      action,
      agentId: params.agentId,
      leadId,
    });
  } catch (err) {
    console.warn("[agent-crm-move] lead_reply_unexpected_error", {
      tenant_id: params.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}

/**
 * Estado do follow-up do lead — é o que distingue "respondeu" de "voltou depois
 * de a gente já ter desistido". Escrito por `processFollowUpJob`.
 */
async function loadFollowUpStatus(
  sb: SupabaseServiceClient,
  tenantId: string,
  leadId: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from("leads")
    .select("follow_up_status")
    .eq("tenant_id", tenantId)
    .eq("id", leadId)
    .maybeSingle();
  if (error || !data) return null;
  return textOrNull((data as { follow_up_status?: unknown }).follow_up_status);
}

/**
 * Carimba `first_reply_at` na primeira resposta. Escrita condicional para não
 * sobrescrever o valor original em respostas seguintes.
 *
 * É só registro histórico: não decide mais se o card pode ser movido (quem
 * decide é a procedência em `agent_crm_column_id`). Por isso falhar aqui é
 * silencioso e não impede nada.
 */
async function stampFirstReply(
  sb: SupabaseServiceClient,
  tenantId: string,
  leadId: string,
): Promise<void> {
  const { error } = await sb
    .from("leads")
    .update({ first_reply_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", leadId)
    .is("first_reply_at", null);

  if (error && !isMissingColumn(error, "first_reply_at")) {
    console.warn("[agent-crm-move] first_reply_stamp_failed", {
      tenant_id: tenantId,
      lead_id: leadId,
      code: error.code,
      error: error.message,
    });
  }
}
