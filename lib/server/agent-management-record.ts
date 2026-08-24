import "server-only";

import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isAgentArchivedMetadata } from "@/lib/server/agent-management-validation";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/** Confirma tenant e impede mutações em agentes já arquivados. */
export async function assertManageableTenantAgent(
  sb: ServiceClient,
  tenantId: string,
  agentId: string,
): Promise<void> {
  const { data, error } = await sb
    .from("tenant_agents")
    .select("agent_id,metadata")
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .maybeSingle();
  if (error) throw new Error("Erro ao validar agente.");
  if (!data || isAgentArchivedMetadata(data.metadata)) {
    throw new Error("Agente não encontrado para este tenant.");
  }
}

