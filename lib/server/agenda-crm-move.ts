/**
 * Move o card do lead no CRM quando um agendamento é criado, remarcado ou
 * cancelado — se (e somente se) o dono da conta tiver configurado isso no
 * agente.
 *
 * Efeito colateral deliberadamente isolado: `applyAgendaCrmMove` nunca lança.
 * Um agendamento válido jamais pode falhar porque o CRM não pôde ser
 * atualizado — o compromisso já foi confirmado ao cliente nesse ponto.
 */
import { normalizeWhatsAppPhone } from "@/lib/server/auto-lead-upsert";
import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type AgendaCrmMoveAction = "scheduled" | "rescheduled" | "cancelled";

export type AgendaCrmMoveTarget = {
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
 *  1. o agente não pode mexer na agenda (`agendaAutomationEnabled`);
 *  2. o move daquele lado está desligado;
 *  3. funil ou coluna faltando.
 *
 * `rescheduled` reusa o destino de `scheduled`: remarcar mantém o card na
 * coluna de agendado (a escrita é idempotente).
 */
export function resolveAgendaCrmMoveTarget(
  metadata: Record<string, unknown> | null | undefined,
  action: AgendaCrmMoveAction,
): AgendaCrmMoveTarget | null {
  if (!metadata || typeof metadata !== "object") return null;
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

export async function applyAgendaCrmMove(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  action: AgendaCrmMoveAction;
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
    const target = resolveAgendaCrmMoveTarget(metadata, params.action);
    if (!target) return "skipped";

    const leadId = await resolveLeadId(
      params.sb,
      params.tenantId,
      textOrNull(params.leadId),
      textOrNull(params.attendeePhone),
    );
    if (!leadId) {
      console.info("[agenda-crm-move] lead_not_found", {
        tenant_id: params.tenantId,
        agent_id: agentId,
        action: params.action,
      });
      return "skipped";
    }

    const patch: Record<string, unknown> = {
      status: target.columnId,
      crm_funnel_id: target.funnelId,
      updated_at: new Date().toISOString(),
    };

    const { error } = await params.sb
      .from("leads")
      .update(patch)
      .eq("tenant_id", params.tenantId)
      .eq("id", leadId);

    if (error) {
      // Base sem a coluna de funil (instalações antigas): move só a etapa.
      if (isMissingColumn(error, "crm_funnel_id")) {
        const { crm_funnel_id: _funnel, ...fallback } = patch;
        const { error: fallbackError } = await params.sb
          .from("leads")
          .update(fallback)
          .eq("tenant_id", params.tenantId)
          .eq("id", leadId);
        if (!fallbackError) return "moved";
      }
      console.warn("[agenda-crm-move] update_failed", {
        tenant_id: params.tenantId,
        lead_id: leadId,
        action: params.action,
        code: error.code,
        error: error.message,
      });
      return "failed";
    }

    console.info("[agenda-crm-move] lead_moved", {
      tenant_id: params.tenantId,
      lead_id: leadId,
      agent_id: agentId,
      action: params.action,
      funnel_id: target.funnelId,
      column_id: target.columnId,
    });
    return "moved";
  } catch (err) {
    console.warn("[agenda-crm-move] unexpected_error", {
      tenant_id: params.tenantId,
      action: params.action,
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}
