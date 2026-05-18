import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { buildTemplateAgentsForTenant } from "@/lib/agents/template-agents";

/**
 * Agente usado nas respostas automáticas Evolution:
 *   lead.agent_id (by phone) > env > stored > primeiro ativo em `tenant_agents` > primeiro template.
 *
 * @param tenantId   Tenant do evento.
 * @param storedDefault  default_agent_id armazenado na instância Evolution (pode ser null).
 * @param leadPhone  Número do remetente normalizado (apenas dígitos, com DDI).
 *                   Quando fornecido, consulta leads.agent_id — útil para leads vindos do Lead Ads.
 */
export async function resolveEvolutionAgentId(
  tenantId: string,
  storedDefault: string | null,
  leadPhone?: string | null,
): Promise<string> {
  const fromEnv = process.env.EVOLUTION_DEFAULT_AGENT_ID?.trim();
  if (fromEnv) return fromEnv;

  // Priority: lead's own agent_id (set e.g. by Lead Ads webhook)
  if (leadPhone) {
    const sb = createSupabaseServiceClient();
    const { data: lead } = await sb
      .from("leads")
      .select("agent_id")
      .eq("tenant_id", tenantId)
      .eq("phone", leadPhone)
      .maybeSingle();
    if (lead?.agent_id && typeof lead.agent_id === "string") {
      return lead.agent_id;
    }
  }

  if (storedDefault?.trim()) return storedDefault.trim();

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("tenant_agents")
    .select("agent_id")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!error && data?.agent_id && typeof data.agent_id === "string") {
    return data.agent_id;
  }

  // Fallback: primeiro template do tenant (tem system prompt real em memória)
  const templates = buildTemplateAgentsForTenant(tenantId);
  return templates[0]?.id ?? "ag-clara-comercial";
}
