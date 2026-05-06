import { logAdminIaDataPlaneIssue, surfacePostgrestForAdminUi } from "@/lib/server/admin-ia-data-plane-errors";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type AiRangeQuery = {
  fromISO: string;
  toISO: string;
  tenantId: string | "all";
  agentId: string | "all";
  status: string | "all";
};

function defaultRange(): { fromISO: string; toISO: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { fromISO: from.toISOString(), toISO: to.toISOString() };
}

export function parseAiRange(searchParams: URLSearchParams): AiRangeQuery {
  const d = defaultRange();
  return {
    fromISO: searchParams.get("from") || d.fromISO,
    toISO: searchParams.get("to") || d.toISO,
    tenantId: (searchParams.get("tenantId") || "all") as string | "all",
    agentId: (searchParams.get("agentId") || "all") as string | "all",
    status: (searchParams.get("status") || "all") as string | "all",
  };
}

function applyCommonFilters<T extends { eq: Function; gte: Function; lte: Function }>(
  query: T,
  range: AiRangeQuery,
): T {
  let q = query.gte("created_at", range.fromISO).lte("created_at", range.toISO);
  if (range.tenantId !== "all") q = q.eq("tenant_id", range.tenantId);
  if (range.agentId !== "all") q = q.eq("agent_id", range.agentId);
  if (range.status !== "all") q = q.eq("status", range.status);
  return q as T;
}

export type AiOverviewHealth = {
  /** A tabela existe e a query base não falhou (ex.: migração aplicada, service role válido). */
  aiUsageLogsReachable: boolean;
  /** Mensagem segura para o painel (sem SQL nem nomes de tabelas). */
  aiUsageLogsError: string | null;
  /** Orientação operacional genérica. */
  aiUsageLogsHint: string | null;
};

export async function getAiOverview(range: AiRangeQuery) {
  const sb = createSupabaseServiceClient();
  const probe = await sb.from("ai_usage_logs").select("id").limit(1);
  let health: AiOverviewHealth;
  if (probe.error) {
    logAdminIaDataPlaneIssue("overview health probe", {
      message: probe.error.message,
      code: probe.error.code,
    });
    const surf = surfacePostgrestForAdminUi(probe.error.message, probe.error.code ?? null);
    health = {
      aiUsageLogsReachable: false,
      aiUsageLogsError: surf.headline,
      aiUsageLogsHint: surf.guidance,
    };
  } else {
    health = { aiUsageLogsReachable: true, aiUsageLogsError: null, aiUsageLogsHint: null };
  }

  const q = applyCommonFilters(
    sb.from("ai_usage_logs").select(
      "tenant_id,agent_id,input_tokens,output_tokens,total_tokens,estimated_cost_usd,status,latency_ms,created_at",
    ),
    range,
  );
  const { data } = await q;
  const rows = data ?? [];
  const totalRequests = rows.length;
  const tokensIn = rows.reduce((s, r) => s + Number(r.input_tokens ?? 0), 0);
  const tokensOut = rows.reduce((s, r) => s + Number(r.output_tokens ?? 0), 0);
  const totalTokens = rows.reduce((s, r) => s + Number(r.total_tokens ?? 0), 0);
  const costUsd = rows.reduce((s, r) => s + Number(r.estimated_cost_usd ?? 0), 0);
  const errors = rows.filter((r) => String(r.status) !== "success").length;
  const errorRatePct = totalRequests > 0 ? (errors / totalRequests) * 100 : 0;
  const sortedLatency = rows
    .map((r) => Number(r.latency_ms ?? 0))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  const p95LatencyMs =
    sortedLatency.length > 0 ? sortedLatency[Math.floor(sortedLatency.length * 0.95)] : 0;

  return {
    meta: range,
    kpis: {
      totalRequests,
      totalTokens,
      tokensIn,
      tokensOut,
      estimatedCostUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
      errorRatePct: Math.round(errorRatePct * 100) / 100,
      p95LatencyMs,
      uniqueTenants: new Set(rows.map((r) => r.tenant_id)).size,
      uniqueAgents: new Set(rows.map((r) => r.agent_id)).size,
    },
    health,
  };
}

export async function getAiTopTenants(range: AiRangeQuery) {
  const sb = createSupabaseServiceClient();
  const q = applyCommonFilters(
    sb.from("ai_usage_logs").select("tenant_id,total_tokens,estimated_cost_usd,status"),
    range,
  );
  const { data } = await q;
  const map = new Map<string, { requests: number; tokens: number; cost: number; errors: number }>();
  for (const row of data ?? []) {
    const key = String(row.tenant_id ?? "unknown");
    const cur = map.get(key) ?? { requests: 0, tokens: 0, cost: 0, errors: 0 };
    cur.requests += 1;
    cur.tokens += Number(row.total_tokens ?? 0);
    cur.cost += Number(row.estimated_cost_usd ?? 0);
    if (String(row.status) !== "success") cur.errors += 1;
    map.set(key, cur);
  }
  return Array.from(map.entries())
    .map(([tenantId, v]) => ({
      tenantId,
      requests: v.requests,
      totalTokens: v.tokens,
      estimatedCostUsd: Math.round(v.cost * 1_000_000) / 1_000_000,
      errorRatePct: v.requests > 0 ? Math.round((v.errors / v.requests) * 10_000) / 100 : 0,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 100);
}

export async function getAiTopAgents(range: AiRangeQuery) {
  const sb = createSupabaseServiceClient();
  const q = applyCommonFilters(
    sb.from("ai_usage_logs").select("tenant_id,agent_id,total_tokens,estimated_cost_usd,status,latency_ms"),
    range,
  );
  const { data } = await q;
  const map = new Map<string, { tenantId: string; requests: number; tokens: number; cost: number; errors: number; latencies: number[] }>();
  for (const row of data ?? []) {
    const tenantId = String(row.tenant_id ?? "unknown");
    const agentId = String(row.agent_id ?? "unknown");
    const key = `${tenantId}:${agentId}`;
    const cur = map.get(key) ?? { tenantId, requests: 0, tokens: 0, cost: 0, errors: 0, latencies: [] };
    cur.requests += 1;
    cur.tokens += Number(row.total_tokens ?? 0);
    cur.cost += Number(row.estimated_cost_usd ?? 0);
    if (String(row.status) !== "success") cur.errors += 1;
    const lat = Number(row.latency_ms ?? 0);
    if (Number.isFinite(lat) && lat > 0) cur.latencies.push(lat);
    map.set(key, cur);
  }
  return Array.from(map.entries())
    .map(([key, v]) => {
      const [tenantId, agentId] = key.split(":");
      const avgLatencyMs = v.latencies.length
        ? Math.round(v.latencies.reduce((s, n) => s + n, 0) / v.latencies.length)
        : 0;
      return {
        tenantId,
        agentId,
        requests: v.requests,
        totalTokens: v.tokens,
        estimatedCostUsd: Math.round(v.cost * 1_000_000) / 1_000_000,
        errorRatePct: v.requests > 0 ? Math.round((v.errors / v.requests) * 10_000) / 100 : 0,
        avgLatencyMs,
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 200);
}

export async function getAiLogs(range: AiRangeQuery, page = 1, pageSize = 50) {
  const sb = createSupabaseServiceClient();
  const from = Math.max(0, (page - 1) * pageSize);
  const to = from + pageSize - 1;
  const q = applyCommonFilters(
    sb
      .from("ai_usage_logs")
      .select(
        "id,tenant_id,customer_id,agent_id,feature,provider,model,input_tokens,output_tokens,total_tokens,estimated_cost_usd,status,error_code,provider_request_id,latency_ms,created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(from, to),
    range,
  );
  const { data, count } = await q;
  return {
    page,
    pageSize,
    total: count ?? 0,
    rows: data ?? [],
  };
}

export async function getAiAlerts(range: AiRangeQuery) {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from("ai_usage_alerts")
    .select("*")
    .gte("created_at", range.fromISO)
    .lte("created_at", range.toISO)
    .order("created_at", { ascending: false })
    .limit(200);
  return data ?? [];
}

export type AiTimeseriesPoint = {
  day: string;
  requests: number;
  totalTokens: number;
  estimatedCostUsd: number;
  successCount: number;
  errorCount: number;
};

/**
 * Agregação diária a partir de `ai_usage_logs` no intervalo (para gráficos do hub OmniChat).
 */
export async function getAiTimeseries(range: AiRangeQuery): Promise<AiTimeseriesPoint[]> {
  const sb = createSupabaseServiceClient();
  const q = applyCommonFilters(
    sb.from("ai_usage_logs").select("created_at,total_tokens,estimated_cost_usd,status"),
    range,
  );
  const { data, error } = await q;
  if (error || !data || data.length === 0) {
    return [];
  }
  const byDay = new Map<string, { requests: number; tokens: number; cost: number; ok: number; err: number }>();
  for (const row of data) {
    const created = String(row.created_at ?? "");
    const day = created.length >= 10 ? created.slice(0, 10) : "unknown";
    const cur = byDay.get(day) ?? { requests: 0, tokens: 0, cost: 0, ok: 0, err: 0 };
    cur.requests += 1;
    cur.tokens += Number(row.total_tokens ?? 0);
    cur.cost += Number(row.estimated_cost_usd ?? 0);
    if (String(row.status) === "success") cur.ok += 1;
    else cur.err += 1;
    byDay.set(day, cur);
  }
  return Array.from(byDay.entries())
    .map(([day, v]) => ({
      day,
      requests: v.requests,
      totalTokens: v.tokens,
      estimatedCostUsd: Math.round(v.cost * 1_000_000) / 1_000_000,
      successCount: v.ok,
      errorCount: v.err,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export type AiUsageLimitRow = {
  id: number;
  tenant_id: string;
  agent_id: string | null;
  daily_tokens_hard: number | null;
  monthly_tokens_hard: number | null;
  daily_cost_usd_hard: number | null;
  monthly_cost_usd_hard: number | null;
  active: boolean;
  updated_at: string;
};

export async function getAiUsageLimitsSnapshot(): Promise<
  { rows: AiUsageLimitRow[]; error: null } | { rows: []; error: string }
> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("ai_usage_limits")
    .select("id,tenant_id,agent_id,daily_tokens_hard,monthly_tokens_hard,daily_cost_usd_hard,monthly_cost_usd_hard,active,updated_at")
    .eq("active", true)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) {
    logAdminIaDataPlaneIssue("usage-limits snapshot", { message: error.message, code: error.code });
    const surf = surfacePostgrestForAdminUi(error.message, error.code ?? null);
    return { rows: [], error: surf.headline + (surf.guidance ? ` ${surf.guidance}` : "") };
  }
  return { rows: (data ?? []) as AiUsageLimitRow[], error: null };
}
