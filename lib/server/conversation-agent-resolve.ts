/**
 * Qual agente atende esta conversa.
 *
 * Antes, assumir/pausar uma conversa lia o `default_agent_id` do slot 0 —
 * o agente errado assim que o tenant tinha mais de uma linha, porque o slot 0
 * não tem relação nenhuma com a linha onde a conversa realmente aconteceu.
 * A fonte correta é a própria conversa: o agente registrado nela e, como
 * reforço, a jornada ativa daquele contato.
 */
import "server-only";
import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getActiveLeadJourney } from "@/lib/server/lead-journeys";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export async function resolveConversationAgentId(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
}): Promise<string | null> {
  const { data, error } = await params.sb
    .from("conversation_states")
    .select("agent_id")
    .eq("tenant_id", params.tenantId)
    .eq("remote_jid", params.remoteJid)
    .maybeSingle();

  if (!error) {
    const agentId = (data as { agent_id?: unknown } | null)?.agent_id;
    if (typeof agentId === "string" && agentId.trim()) return agentId.trim();
  } else {
    console.warn("[conversation-agent-resolve] state_query_failed", error.code ?? "", error.message);
  }

  // Conversa ainda sem agente carimbado (ex.: primeiro contato). A jornada ativa
  // sabe quem foi autorizado a atender.
  const journey = await getActiveLeadJourney({
    sb: params.sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
  });
  return journey?.agentId ?? null;
}
