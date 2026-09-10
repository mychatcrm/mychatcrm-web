import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

/** Read only. A customer's pending job can never keep a laboratory turn open. */
export async function labHasPendingAgentWork(scope: {
  tenantId: string; agentId: string; remoteJid: string; channel: string; connectionId: string; createdAt: string;
}): Promise<boolean> {
  if (!scope.tenantId.startsWith("tenant-lab-") || !scope.agentId || !scope.remoteJid || !scope.connectionId
    || !["evolution", "meta_cloud"].includes(scope.channel) || !Number.isFinite(Date.parse(scope.createdAt))) {
    throw new Error("lab_turn_scope_invalid");
  }
  const sb = createSupabaseServiceClient();
  const query = (table: string) => sb.from(table).select("id").eq("tenant_id", scope.tenantId)
    .eq("agent_id", scope.agentId).eq("remote_jid", scope.remoteJid).eq("channel", scope.channel)
    .eq("connection_id", scope.connectionId).gte("created_at", scope.createdAt)
    .in("status", ["pending", "processing"]).limit(1);
  const [jobs, outbound] = await Promise.all([query("agent_response_jobs"), query("agent_outbound_outbox")]);
  if (jobs.error || outbound.error) throw new Error("lab_turn_observation_unavailable");
  return Boolean(jobs.data?.length || outbound.data?.length);
}
