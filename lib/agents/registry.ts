import type { Agent } from "@/lib/types";
import { buildTemplateAgentsForTenant } from "./template-agents";

/**
 * Contrato estável: lista de agentes conhecidos para o tenant (hoje: templates demo).
 * Substituir implementação interna por API/DB sem alterar assinatura.
 */
export function listAgentsForTenant(tenantId: string): Agent[] {
  return buildTemplateAgentsForTenant(tenantId.trim());
}

export function getAgentByIdForTenant(tenantId: string, agentId: string): Agent | undefined {
  const tenant = tenantId.trim();
  const needle = agentId.trim();
  if (!needle) return undefined;
  for (const agent of listAgentsForTenant(tenant)) {
    if (agent.id === needle && agent.clientId === tenant) {
      return agent;
    }
  }
  return undefined;
}

/** @deprecated Use `listAgentsForTenant` — mantido para migração gradual de imports legados. */
export function getMockAgentsForClient(clientId: string): Agent[] {
  return listAgentsForTenant(clientId);
}
