import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import { resolveAgentCrmMoveTarget } from "@/lib/server/auto-lead-upsert";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export const CRM_KANBAN_STATUS_NOVO = "novo";
export const CRM_KANBAN_STATUS_CONTATO = "contato";

export async function resolveAgentCrmFunnelForLeadInsert(
  sb: SupabaseServiceClient,
  params: { tenantId: string; agentId: string | null },
): Promise<{ crm_funnel_id?: string }> {
  const target = await resolveAgentCrmMoveTarget(sb, params);
  if (!target.enabled || !target.funnelId) return {};
  return { crm_funnel_id: target.funnelId };
}

/**
 * Novo lead Meta/WhatsApp entra sempre em "novo"; funil opcional do agente.
 */
export function buildNewLeadCrmFields(crmFunnelId?: string | null): {
  status: string;
  crm_funnel_id?: string;
} {
  return {
    status: CRM_KANBAN_STATUS_NOVO,
    ...(crmFunnelId?.trim() ? { crm_funnel_id: crmFunnelId.trim() } : {}),
  };
}

/**
 * Quando o agente passa a atender, tira o lead de "novo".
 *
 * O destino é a coluna configurada no agente em «Destino do lead no CRM».
 * Antes era sempre `CRM_KANBAN_STATUS_CONTATO` fixo, o que fazia a tela
 * prometer uma escolha que este caminho ignorava: quem apontasse para outra
 * coluna via o lead cair em "contato" do mesmo jeito. `contato` continua sendo
 * o destino de quem não configurou nada, então nada muda para esses.
 *
 * A guarda de status continua: só promove quem ainda está em "novo" (ou sem
 * status). Um card que a equipe já moveu não é puxado de volta.
 */
export async function promoteLeadToContatoOnAgentEngagement(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  leadId: string | null | undefined;
  /** Sem agente resolvido, cai no destino padrão. */
  agentId?: string | null;
}): Promise<boolean> {
  const leadId = params.leadId?.trim();
  if (!leadId) return false;

  const { data: row } = await params.sb
    .from("leads")
    .select("id, status")
    .eq("tenant_id", params.tenantId)
    .eq("id", leadId)
    .maybeSingle();

  if (!row) return false;
  const current = typeof row.status === "string" ? row.status.trim() : "";
  if (current && current !== CRM_KANBAN_STATUS_NOVO) return false;

  const configured = await resolveAgentCrmMoveTarget(params.sb, {
    tenantId: params.tenantId,
    agentId: params.agentId ?? null,
  });
  const targetStatus =
    configured.enabled && configured.columnId ? configured.columnId : CRM_KANBAN_STATUS_CONTATO;

  // Já está onde deveria ficar: nada a fazer.
  if (current === targetStatus) return false;

  const patch: Record<string, unknown> = {
    status: targetStatus,
    updated_at: new Date().toISOString(),
  };
  if (configured.enabled && configured.funnelId) {
    patch.crm_funnel_id = configured.funnelId;
  }

  const { error } = await params.sb
    .from("leads")
    .update(patch)
    .eq("tenant_id", params.tenantId)
    .eq("id", leadId);

  if (error) {
    console.warn("[crm-lead-lifecycle] promote_to_contato_failed", {
      tenant_id: params.tenantId,
      lead_id: leadId,
      error: error.message,
    });
    return false;
  }

  console.info("[crm-lead-lifecycle] lead_promoted_on_engagement", {
    tenant_id: params.tenantId,
    lead_id: leadId,
    from_status: current || CRM_KANBAN_STATUS_NOVO,
    to_status: targetStatus,
    configured: configured.enabled,
  });
  return true;
}
