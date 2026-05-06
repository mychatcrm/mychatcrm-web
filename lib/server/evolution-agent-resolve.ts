import { createSupabaseServiceClient } from "@/lib/supabase/server";

/** Agente usado nas respostas automáticas Evolution: env > primeiro ativo em `tenant_agents` > fallback genérico. */
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
  return "marketing_site_assistant";
}
