import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { buildTemplateAgentsForTenant } from "@/lib/agents/template-agents";

/**
 * Agente usado nas respostas automáticas Evolution: env > stored > primeiro ativo em `tenant_agents` > primeiro template.
 * Usa service_role para garantir acesso mesmo com RLS ativa.
 */
export async function resolveEvolutionAgentId(tenantId: string, storedDefault: string | null): Promise<string> {
  const fromEnv = process.env.EVOLUTION_DEFAULT_AGENT_ID?.trim();
  if (fromEnv) return fromEnv;
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
