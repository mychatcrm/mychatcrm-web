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
 * Quando o agente passa a atender (primeira resposta automática), move de "novo" → "contato".
 */
export async function promoteLeadToContatoOnAgentEngagement(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  leadId: string | null | undefined;
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
  if (current === CRM_KANBAN_STATUS_CONTATO) return false;
  if (current && current !== CRM_KANBAN_STATUS_NOVO) return false;

  const { error } = await params.sb
    .from("leads")
    .update({ status: CRM_KANBAN_STATUS_CONTATO, updated_at: new Date().toISOString() })
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

  console.info("[crm-lead-lifecycle] lead_promoted_to_contato", {
    tenant_id: params.tenantId,
    lead_id: leadId,
    from_status: current || CRM_KANBAN_STATUS_NOVO,
  });
  return true;
}
