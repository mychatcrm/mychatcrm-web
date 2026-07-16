import type { AgentResponseJobRow } from "@/lib/server/agent-response-jobs";
import { processAgentResponseJob as processEvolutionAgentResponseJob } from "@/lib/server/evolution-agent-reply";
import { processMetaAgentResponseJob } from "@/lib/server/meta-agent-reply";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type AgentResponseJobResult =
  | { ok: true; dedupedCount: number }
  | { ok: false; error: string; dedupedCount?: number };

/**
 * Único ponto de despacho do turno do agente. O canal muda apenas o adaptador
 * de entrega; agrupamento, geração, agenda, idempotência e estado do job são
 * compartilhados.
 */
export async function processAgentResponseJobByChannel(
  sb: SupabaseServiceClient,
  job: AgentResponseJobRow,
  claimedGeneration: number,
): Promise<AgentResponseJobResult> {
  if (job.channel === "meta_cloud") {
    return processMetaAgentResponseJob(sb, job, claimedGeneration);
  }
  return processEvolutionAgentResponseJob(sb, job, claimedGeneration);
}
