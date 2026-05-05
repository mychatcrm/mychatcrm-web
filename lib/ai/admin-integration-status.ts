import { resolveOpenAiApiKey } from "@/lib/ai/gateway";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type AiIntegrationStatusPayload = {
  hasOpenAiKey: boolean;
  aiUsageLogsReachable: boolean;
  aiUsageLogsError: string | null;
  requestsLast24h: number | null;
  lastSuccess: {
    createdAt: string;
    tenantId: string;
    agentId: string;
  } | null;
};

export async function getAiIntegrationStatus(): Promise<AiIntegrationStatusPayload> {
  const hasOpenAiKey = Boolean(resolveOpenAiApiKey());
  const sb = createSupabaseServiceClient();

  const probe = await sb.from("ai_usage_logs").select("id").limit(1);
  const aiUsageLogsReachable = !probe.error;
  const aiUsageLogsError = probe.error?.message ?? null;

  let requestsLast24h: number | null = null;
  let lastSuccess: AiIntegrationStatusPayload["lastSuccess"] = null;

  if (aiUsageLogsReachable) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: cErr } = await sb
      .from("ai_usage_logs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since);
    if (!cErr) requestsLast24h = count ?? 0;

    const { data: row } = await sb
      .from("ai_usage_logs")
      .select("created_at,tenant_id,agent_id")
      .eq("status", "success")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (row?.created_at) {
      lastSuccess = {
        createdAt: String(row.created_at),
        tenantId: String(row.tenant_id ?? ""),
        agentId: String(row.agent_id ?? ""),
      };
    }
  }

  return {
    hasOpenAiKey,
    aiUsageLogsReachable,
    aiUsageLogsError,
    requestsLast24h,
    lastSuccess,
  };
}
