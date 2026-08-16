import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  BROADCAST_AGENT_METADATA_KEY,
  DISPAROS_DEFAULT_AGENT_ID,
  isBroadcastAgentRow,
} from "@/lib/server/broadcast-agent-identity";

export { DISPAROS_DEFAULT_AGENT_ID };

const DEFAULT_SYSTEM_PROMPT =
  "Você é o assistente de atendimento para quem responde às campanhas de WhatsApp em massa " +
  "desta empresa. Seja simpático, direto e ajude a pessoa a dar o próximo passo (tirar dúvidas, " +
  "agendar ou falar com um humano se ela pedir). Nunca invente informações sobre produtos, preços " +
  "ou prazos que não foram te passados.";

export type DisparosDefaultAgent = {
  agentId: string;
  displayName: string;
};

/** Marca que separa este agente dos de atendimento em toda a plataforma. */
function broadcastMetadata(extra?: Record<string, unknown>): Record<string, unknown> {
  return { ...(extra ?? {}), [BROADCAST_AGENT_METADATA_KEY]: true };
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Garante que o tenant tenha o PRIMEIRO agente de Disparos — cria na primeira
 * vez que for escolhido (idempotente via upsert em agent_id fixo), reaproveita
 * nas próximas. É uma linha comum em tenant_agents, editável em
 * /dashboard/agentes como qualquer outro.
 *
 * Também repara agentes criados antes da marca existir: eles têm o id fixo mas
 * não têm `metadata.isBroadcastAgent`, e sem a marca cairiam na cota de
 * agentes de atendimento.
 */
export async function ensureDisparosDefaultAgent(tenantId: string): Promise<DisparosDefaultAgent> {
  const sb = createSupabaseServiceClient();
  const { data: existing } = await sb
    .from("tenant_agents")
    .select("agent_id, display_name, active, metadata")
    .eq("tenant_id", tenantId)
    .eq("agent_id", DISPAROS_DEFAULT_AGENT_ID)
    .maybeSingle();

  if (existing) {
    const metadata = metadataObject(existing.metadata);
    const missingMark = metadata[BROADCAST_AGENT_METADATA_KEY] !== true;
    if (existing.active !== true || missingMark) {
      await sb
        .from("tenant_agents")
        .update({
          active: true,
          ...(missingMark ? { metadata: broadcastMetadata(metadata) } : {}),
          updated_at: new Date().toISOString(),
        })
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
        metadata: broadcastMetadata(),
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

/**
 * Todos os agentes de Disparos do tenant, ativos ou pausados.
 *
 * Inclui os herdados (id fixo sem a marca) via `isBroadcastAgentRow` — a lista
 * da tela não pode esconder um agente só porque ele nasceu antes da separação.
 */
export async function listBroadcastAgents(
  tenantId: string,
): Promise<Array<{ agentId: string; displayName: string; active: boolean }>> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("tenant_agents")
    .select("agent_id, display_name, active, metadata")
    .eq("tenant_id", tenantId)
    .order("display_name", { ascending: true });

  if (error) {
    console.warn("[disparos-agent] list_failed", error.code ?? "", error.message);
    return [];
  }

  return (data ?? [])
    .filter((row) => isBroadcastAgentRow(row as Record<string, unknown>))
    .map((row) => ({
      agentId: String(row.agent_id),
      displayName: String(row.display_name ?? "Agente do Disparos"),
      active: row.active === true,
    }));
}

/**
 * Cria um agente de Disparos ADICIONAL, com id gerado.
 *
 * A cota não é aplicada aqui de propósito: quem decide é a rota, que tem a
 * sessão (e portanto o plano) em mãos. Esta função é a mecânica de criação,
 * não a política.
 */
export async function createBroadcastAgent(params: {
  tenantId: string;
  displayName: string;
}): Promise<DisparosDefaultAgent> {
  const displayName = params.displayName.trim() || "Agente do Disparos";
  const sb = createSupabaseServiceClient();
  const agentId = `disparos-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  const { data: created, error } = await sb
    .from("tenant_agents")
    .insert({
      tenant_id: params.tenantId,
      agent_id: agentId,
      display_name: displayName,
      system_prompt: DEFAULT_SYSTEM_PROMPT,
      metadata: broadcastMetadata(),
      active: true,
      updated_at: new Date().toISOString(),
    })
    .select("agent_id, display_name")
    .single();
  if (error || !created) {
    throw new Error(`disparos_agent_create_failed:${error?.message ?? "unknown"}`);
  }
  return { agentId: created.agent_id, displayName: created.display_name ?? displayName };
}
