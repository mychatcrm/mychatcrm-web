/**
 * Tipos de distribuição que executam um agente de IA para leads Meta.
 *
 * Esta lista é compartilhada pelo painel, pelas APIs de configuração e pelo
 * autorizador runtime para impedir que um tipo novo seja aceito na interface,
 * mas ignorado quando o webhook do lead chegar.
 */
export const META_AUTOMATION_DISTRIBUTION_TYPES = new Set([
  "automation_agent",
  "agent_plus_seller",
  "specific_agents",
  "round_robin",
]);

export function isMetaAutomationDistributionType(value: unknown): boolean {
  return typeof value === "string" && META_AUTOMATION_DISTRIBUTION_TYPES.has(value);
}
