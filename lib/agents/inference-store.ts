import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type TenantAgentInferenceProfile = {
  tenantId: string;
  agentId: string;
  displayName: string;
  systemPrompt: string;
  model: string | null;
};

/** Perfil mínimo para montar system prompt na inferência (Supabase → fallback templates noutro módulo). */
export async function getInferenceProfileByTenantAgent(
  tenantId: string,
  agentId: string,
): Promise<TenantAgentInferenceProfile | null> {
  const tenant = tenantId.trim();
  const agent = agentId.trim();
  if (!tenant || !agent) return null;

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("tenant_agents")
    .select("tenant_id,agent_id,display_name,system_prompt,model")
    .eq("tenant_id", tenant)
    .eq("agent_id", agent)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    console.warn("[tenant_agents]", error.code ?? "", error.message);
    return null;
  }
  if (!data) return null;

  return {
    tenantId: String(data.tenant_id),
    agentId: String(data.agent_id),
    displayName: String(data.display_name ?? ""),
    systemPrompt: String(data.system_prompt ?? ""),
    model: data.model != null ? String(data.model) : null,
  };
}
