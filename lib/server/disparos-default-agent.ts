import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

/** agent_id fixo — unicidade já é por (tenant_id, agent_id), não precisa de nada mais exótico. */
export const DISPAROS_DEFAULT_AGENT_ID = "disparos-default";

const DEFAULT_SYSTEM_PROMPT =
  "Você é o assistente de atendimento para quem responde às campanhas de WhatsApp em massa " +
  "desta empresa. Seja simpático, direto e ajude a pessoa a dar o próximo passo (tirar dúvidas, " +
  "agendar ou falar com um humano se ela pedir). Nunca invente informações sobre produtos, preços " +
  "ou prazos que não foram te passados.";

export type DisparosDefaultAgent = {
  agentId: string;
  displayName: string;
};

/**
 * Garante que o tenant tenha um agente próprio pra Disparos — cria na primeira
 * vez que for escolhido (idempotente via upsert em agent_id fixo), reaproveita
 * nas próximas. É uma linha comum em tenant_agents: aparece em /dashboard/agentes
 * como qualquer outro agente, editável por lá do jeito normal — nenhum arquivo
 * daquela página precisa mudar por causa disso.
 */
export async function ensureDisparosDefaultAgent(tenantId: string): Promise<DisparosDefaultAgent> {
  const sb = createSupabaseServiceClient();
  const { data: existing } = await sb
    .from("tenant_agents")
    .select("agent_id, display_name, active")
    .eq("tenant_id", tenantId)
    .eq("agent_id", DISPAROS_DEFAULT_AGENT_ID)
    .maybeSingle();

  if (existing) {
    if (existing.active !== true) {
      await sb
        .from("tenant_agents")
        .update({ active: true, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("agent_id", DISPAROS_DEFAULT_AGENT_ID);
    }
    return { agentId: existing.agent_id, displayName: existing.display_name ?? "Agente do Disparos" };
  }

  const { data: created, error } = await sb
    .from("tenant_agents")
    .upsert(
      {
        tenant_id: tenantId,
        agent_id: DISPAROS_DEFAULT_AGENT_ID,
        display_name: "Agente do Disparos",
        system_prompt: DEFAULT_SYSTEM_PROMPT,
        active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,agent_id" },
    )
    .select("agent_id, display_name")
    .single();
  if (error || !created) throw new Error(`disparos_default_agent_create_failed:${error?.message ?? "unknown"}`);
  return { agentId: created.agent_id, displayName: created.display_name ?? "Agente do Disparos" };
}
