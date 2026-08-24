import "server-only";

import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;
export type AgentMutationKind = "pause" | "archive";

export type AgentDependencyBlock = {
  code: "AGENT_HAS_ACTIVE_RULES" | "AGENT_HAS_DEPENDENCIES" | "AGENT_DEPENDENCY_CHECK_FAILED";
  message: string;
};

function queryFailed(label: string, error: { message?: string } | null): never {
  throw new Error(`${label}:${error?.message ?? "unknown"}`);
}

/**
 * Falha fechada antes de pausar/arquivar. Sem uma RPC transacional ainda pode
 * existir uma corrida entre esta leitura e a escrita; a migração necessária é
 * reportada separadamente e este helper evita o caminho perigoso comum.
 */
export async function describeAgentDependencyBlock(params: {
  sb: ServiceClient;
  tenantId: string;
  agentId: string;
  kind: AgentMutationKind;
}): Promise<AgentDependencyBlock | null> {
  try {
    const rules = await params.sb
      .from("lead_distribution_rules")
      .select("id,name,active")
      .eq("tenant_id", params.tenantId)
      .contains("agent_ids", [params.agentId])
      .limit(20);
    if (rules.error) queryFailed("lead_distribution_rules", rules.error);

    const linkedRules = rules.data ?? [];
    const activeRules = linkedRules.filter((row) => row.active === true);
    if (params.kind === "pause" && activeRules.length > 0) {
      const names = activeRules.map((row) => String(row.name || row.id)).slice(0, 3).join(", ");
      return {
        code: "AGENT_HAS_ACTIVE_RULES",
        message: `Este agente está em regra(s) ativa(s) de distribuição (${names}). Desative ou transfira essas regras antes de pausar.`,
      };
    }
    if (params.kind === "pause") return null;

    const [journeys, campaigns, mappings, organicConnections] = await Promise.all([
      params.sb.from("lead_journeys").select("id").eq("tenant_id", params.tenantId).eq("agent_id", params.agentId).eq("status", "active").limit(1),
      params.sb.from("whatsapp_campaigns").select("id").eq("tenant_id", params.tenantId).eq("agent_id", params.agentId).in("status", ["draft", "scheduled", "processing"]).limit(1),
      params.sb.from("meta_form_agent_mapping").select("id").eq("tenant_id", params.tenantId).eq("agent_id", params.agentId).limit(1),
      params.sb.from("tenant_evolution_instances").select("id").eq("tenant_id", params.tenantId).eq("organic_agent_id", params.agentId).limit(1),
    ]);
    for (const [label, result] of [
      ["lead_journeys", journeys],
      ["whatsapp_campaigns", campaigns],
      ["meta_form_agent_mapping", mappings],
      ["tenant_evolution_instances", organicConnections],
    ] as const) {
      if (result.error) queryFailed(label, result.error);
    }

    const reasons: string[] = [];
    if (linkedRules.length) reasons.push("regras de distribuição");
    if (journeys.data?.length) reasons.push("jornada ativa");
    if (campaigns.data?.length) reasons.push("campanha pendente");
    if (mappings.data?.length) reasons.push("formulário Meta");
    if (organicConnections.data?.length) reasons.push("linha orgânica");
    if (reasons.length) {
      return {
        code: "AGENT_HAS_DEPENDENCIES",
        message: `Não é possível excluir enquanto houver vínculo com ${reasons.join(", ")}. Remova ou transfira os vínculos primeiro.`,
      };
    }
    return null;
  } catch (error) {
    console.error("[agent-management] dependency check", error);
    return {
      code: "AGENT_DEPENDENCY_CHECK_FAILED",
      message: "Não foi possível confirmar com segurança os vínculos do agente. Tente novamente.",
    };
  }
}

