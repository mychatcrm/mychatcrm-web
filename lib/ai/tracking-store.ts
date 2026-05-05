import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type AiUsageLogInsert = {
  tenantId: string;
  customerId: string | null;
  agentId: string;
  feature: string;
  provider: string;
  model: string;
  promptExcerpt: string | null;
  responseExcerpt: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  currency: string;
  status: string;
  errorCode: string | null;
  errorMessageSanitized: string | null;
  providerRequestId: string | null;
  latencyMs: number | null;
  metadata: Record<string, unknown> | null;
};

function isoDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export async function logAiUsage(row: AiUsageLogInsert): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("ai_usage_logs").insert({
    tenant_id: row.tenantId,
    customer_id: row.customerId,
    agent_id: row.agentId,
    feature: row.feature,
    provider: row.provider,
    model: row.model,
    prompt_excerpt: row.promptExcerpt,
    response_excerpt: row.responseExcerpt,
    input_tokens: row.inputTokens,
    output_tokens: row.outputTokens,
    total_tokens: row.totalTokens,
    estimated_cost_usd: row.estimatedCostUsd,
    currency: row.currency,
    status: row.status,
    error_code: row.errorCode,
    error_message_sanitized: row.errorMessageSanitized,
    provider_request_id: row.providerRequestId,
    latency_ms: row.latencyMs,
    metadata: row.metadata ?? {},
  });
  if (error) {
    console.error("[ai-tracking] logAiUsage", error.message);
  }
}

export async function upsertDailyAggregate(params: {
  tenantId: string;
  agentId: string;
  model: string;
  dayISO?: string;
  requestCount: number;
  successCount: number;
  errorCount: number;
  blockedCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}): Promise<void> {
  const sb = createSupabaseServiceClient();
  const day = params.dayISO ?? isoDay();

  const { data: current } = await sb
    .from("ai_usage_daily")
    .select("*")
    .eq("day", day)
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .eq("model", params.model)
    .maybeSingle();

  const next = {
    day,
    tenant_id: params.tenantId,
    agent_id: params.agentId,
    model: params.model,
    request_count: (current?.request_count ?? 0) + params.requestCount,
    success_count: (current?.success_count ?? 0) + params.successCount,
    error_count: (current?.error_count ?? 0) + params.errorCount,
    blocked_count: (current?.blocked_count ?? 0) + params.blockedCount,
    input_tokens: (current?.input_tokens ?? 0) + params.inputTokens,
    output_tokens: (current?.output_tokens ?? 0) + params.outputTokens,
    total_tokens: (current?.total_tokens ?? 0) + params.totalTokens,
    estimated_cost_usd: (current?.estimated_cost_usd ?? 0) + params.estimatedCostUsd,
    updated_at: new Date().toISOString(),
  };

  const { error } = await sb
    .from("ai_usage_daily")
    .upsert(next, { onConflict: "day,tenant_id,agent_id,model" });
  if (error) {
    console.error("[ai-tracking] upsertDailyAggregate", error.message);
  }
}

export async function getUsageLimitForTenant(tenantId: string): Promise<{
  dailyCostUsdHard: number | null;
  monthlyCostUsdHard: number | null;
} | null> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("ai_usage_limits")
    .select("daily_cost_usd_hard,monthly_cost_usd_hard,active")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    dailyCostUsdHard: data.daily_cost_usd_hard ?? null,
    monthlyCostUsdHard: data.monthly_cost_usd_hard ?? null,
  };
}

export async function getTenantSpend(params: {
  tenantId: string;
  dayISO?: string;
  monthPrefix?: string;
}): Promise<{ dailyUsd: number; monthlyUsd: number }> {
  const sb = createSupabaseServiceClient();
  const day = params.dayISO ?? isoDay();
  const month = params.monthPrefix ?? day.slice(0, 7);

  const [{ data: dailyRows }, { data: monthlyRows }] = await Promise.all([
    sb
      .from("ai_usage_daily")
      .select("estimated_cost_usd")
      .eq("tenant_id", params.tenantId)
      .eq("day", day),
    sb
      .from("ai_usage_daily")
      .select("estimated_cost_usd,day")
      .eq("tenant_id", params.tenantId)
      .gte("day", `${month}-01`)
      .lte("day", `${month}-31`),
  ]);

  const dailyUsd = (dailyRows ?? []).reduce((sum, r) => sum + Number(r.estimated_cost_usd ?? 0), 0);
  const monthlyUsd = (monthlyRows ?? []).reduce((sum, r) => sum + Number(r.estimated_cost_usd ?? 0), 0);
  return { dailyUsd, monthlyUsd };
}
