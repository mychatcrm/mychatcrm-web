/**
 * Saúde dos agentes referenciados por uma regra de distribuição.
 *
 * Uma regra ativa pode apontar para um agente que foi apagado ou pausado. Nos
 * dois casos o lead entra e simplesmente não é atendido: a resolução do prompt
 * (`getInferenceProfileByTenantAgent`) só enxerga agentes com `active = true`,
 * então a geração devolve `agent_missing_instructions` e a automação é
 * bloqueada — sem erro visível para o operador. Auditoria de 2026-07-28 achou
 * exatamente isso em produção: regra ativa apontando para um `agent_id`
 * inexistente, com leads daquele formulário nunca respondidos.
 */
import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { LeadRuleAgentIssue } from "@/lib/lead-distribution-rules";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/** `agent_id` → está ativo. Agentes ausentes do mapa não existem no tenant. */
export type TenantAgentActivation = Map<string, boolean>;

export async function loadTenantAgentActivation(
  sb: SupabaseServiceClient,
  tenantId: string,
): Promise<TenantAgentActivation | null> {
  const { data, error } = await sb
    .from("tenant_agents")
    .select("agent_id, active")
    .eq("tenant_id", tenantId);

  if (error) {
    console.warn("[lead-rule-agent-health] activation_query_failed", error.code ?? "", error.message);
    return null;
  }

  const activation: TenantAgentActivation = new Map();
  for (const row of (data ?? []) as Array<{ agent_id?: unknown; active?: unknown }>) {
    if (typeof row.agent_id !== "string") continue;
    activation.set(row.agent_id, row.active === true);
  }
  return activation;
}

/**
 * Problemas dos agentes desta regra. Lista vazia quando a regra não roteia
 * para agente (distribuição por colaborador) ou quando está tudo certo.
 */
export function classifyRuleAgentIssues(
  agentIds: readonly string[],
  activation: TenantAgentActivation,
): LeadRuleAgentIssue[] {
  const issues: LeadRuleAgentIssue[] = [];
  const seen = new Set<string>();

  for (const rawId of agentIds) {
    const agentId = typeof rawId === "string" ? rawId.trim() : "";
    if (!agentId || seen.has(agentId)) continue;
    seen.add(agentId);

    if (!activation.has(agentId)) {
      issues.push({ agentId, problem: "missing" });
      continue;
    }
    if (activation.get(agentId) !== true) {
      issues.push({ agentId, problem: "paused" });
    }
  }

  return issues;
}
