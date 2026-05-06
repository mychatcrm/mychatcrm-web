/** Tipos e helpers partilhados pela área /admin/ia — mantidos estáveis para não quebrar contratos com as APIs. */

export type OpenAiEndpointName =
  | "credit_grants"
  | "subscription"
  | "usage"
  | "connectivity_models"
  | "organization_costs";

export type OpenAiEndpointStatus = {
  httpStatus: number;
  ok: boolean;
  errorMessage: string | null;
};

export type OpenAiBillingApiAccess = "ok" | "forbidden_project_key" | "billing_unreachable" | "unknown";

export type OpenAiKeyEffectiveSource = "env" | "database" | "none";

export type OverviewPayload = {
  kpis: {
    totalRequests: number;
    totalTokens: number;
    tokensIn: number;
    tokensOut: number;
    estimatedCostUsd: number;
    errorRatePct: number;
    p95LatencyMs: number;
    uniqueTenants: number;
    uniqueAgents: number;
  };
  health?: {
    aiUsageLogsReachable: boolean;
    aiUsageLogsError: string | null;
    aiUsageLogsHint?: string | null;
  };
};

export type TenantRow = {
  tenantId: string;
  requests: number;
  totalTokens: number;
  estimatedCostUsd: number;
  errorRatePct: number;
};

export type AgentRow = {
  tenantId: string;
  agentId: string;
  requests: number;
  totalTokens: number;
  estimatedCostUsd: number;
  errorRatePct: number;
  avgLatencyMs: number;
};

export type LogRow = {
  id: string;
  created_at: string;
  tenant_id: string;
  agent_id: string;
  model: string;
  status: string;
  total_tokens: number;
  estimated_cost_usd: number;
  latency_ms: number | null;
  provider_request_id: string | null;
  error_code: string | null;
};

export type IntegrationStatusPayload = {
  hasOpenAiKey: boolean;
  openAiKeySource: OpenAiKeyEffectiveSource;
  envOpenAiKeyConfigured: boolean;
  aiUsageLogsReachable: boolean;
  aiUsageLogsError: string | null;
  aiUsageLogsHint?: string | null;
  requestsLast24h: number | null;
  lastSuccess: { createdAt: string; tenantId: string; agentId: string } | null;
};

export type OpenAiCredentialsPayload = {
  envConfigured: boolean;
  databaseConfigured: boolean;
  effectiveSource: OpenAiKeyEffectiveSource;
  maskedSuffix: string | null;
};

export type OpenAiAccountPayload = {
  configured: boolean;
  connectivityOk: boolean | null;
  endpointStatus: Partial<Record<OpenAiEndpointName, OpenAiEndpointStatus>>;
  billingApiAccess?: OpenAiBillingApiAccess | null;
  credits: {
    totalGrantedUsd: number | null;
    totalUsedUsd: number | null;
    totalAvailableUsd: number | null;
  } | null;
  creditsParseSource: "root" | "aggregated" | "none" | null;
  subscription: {
    hardLimitUsd: number | null;
    softLimitUsd: number | null;
    plan: string | null;
  } | null;
  usagePeriodUsd: number | null;
  usageUnit: "usd" | "cents_normalized" | null;
  usageDataSource?: "dashboard_billing" | "organization_costs" | null;
  usagePeriodLabel: string | null;
  accountBillingMode: "prepaid_grants" | "postpaid_or_no_grants" | "unknown";
  hints: string[];
  fetchError: string | null;
  rateLimited: boolean;
  suggestedRetryAfterSec: number | null;
  serverCache?: { hit: boolean; ttlMs: number; ageMs: number };
};

export function formatUsd(v: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v || 0);
}

export function dateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function endpointTitle(name: OpenAiEndpointName): string {
  switch (name) {
    case "credit_grants":
      return "credit_grants";
    case "subscription":
      return "subscription";
    case "usage":
      return "usage (mês)";
    case "connectivity_models":
      return "models (probe)";
    case "organization_costs":
      return "organization/costs";
    default:
      return name;
  }
}

export function keySourceLabel(src: OpenAiKeyEffectiveSource): string {
  switch (src) {
    case "env":
      return "variável OPENAI_API_KEY no servidor (prioridade)";
    case "database":
      return "chave guardada neste painel (Supabase, cifrada)";
    default:
      return "nenhuma configurada";
  }
}
