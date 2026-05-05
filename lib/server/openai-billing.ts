/**
 * Consulta endpoints de billing da OpenAI (mesma API key que o chat).
 * Documentação pública limitada — respostas podem variar por tipo de conta.
 */
import { resolveOpenAiApiKey } from "@/lib/ai/openai-api-key";
import { isUsableApiSecret } from "@/lib/integrations/server-secrets";
import {
  parseBillingUsageData,
  parseCreditGrantsFromData,
} from "@/lib/server/openai-billing-parse";
import { sumOrganizationCostsUsd } from "@/lib/server/openai-org-costs-parse";

const BILLING_TIMEOUT_MS = 12_000;

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

/** Estado de acesso à API legada /v1/dashboard/billing/* */
export type OpenAiBillingApiAccess =
  | "ok"
  | "forbidden_project_key"
  | "billing_unreachable"
  | "unknown";

export type OpenAiAccountSnapshot = {
  configured: boolean;
  /** null quando não configurado; true/false após probe GET /v1/models */
  connectivityOk: boolean | null;
  endpointStatus: Partial<Record<OpenAiEndpointName, OpenAiEndpointStatus>>;
  /** Resumo do acesso ao billing legado (403 em chaves sk-proj-* é comum). */
  billingApiAccess: OpenAiBillingApiAccess | null;
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
  /** Como interpretámos custos em `usage` (USD direto vs centavos → USD). */
  usageUnit: "usd" | "cents_normalized" | null;
  /** Origem do valor em usagePeriodUsd quando preenchido. */
  usageDataSource: "dashboard_billing" | "organization_costs" | null;
  usagePeriodLabel: string | null;
  /** Conta com grants visíveis vs pós-pago / sem pré-pago na API. */
  accountBillingMode: "prepaid_grants" | "postpaid_or_no_grants" | "unknown";
  hints: string[];
  fetchError: string | null;
  rateLimited: boolean;
  suggestedRetryAfterSec: number | null;
};

type JsonFetchResult = {
  ok: boolean;
  data: unknown;
  status: number;
  retryAfterSec: number | null;
};

function resolveOpenAiAdminApiKey(): string | null {
  const raw = process.env.OPENAI_ADMIN_API_KEY;
  if (!isUsableApiSecret(raw)) return null;
  return raw!.trim();
}

async function openAiGetJson(path: string, apiKey: string): Promise<JsonFetchResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), BILLING_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.openai.com${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: ctrl.signal,
      cache: "no-store",
    });
    const ra = res.headers.get("retry-after");
    let retryAfterSec: number | null = null;
    if (ra) {
      const parsed = Number.parseInt(ra, 10);
      if (Number.isFinite(parsed)) retryAfterSec = parsed;
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text.slice(0, 200) };
    }
    return { ok: res.ok, data, status: res.status, retryAfterSec };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "fetch_failed";
    return { ok: false, data: { error: { message: msg } }, status: 0, retryAfterSec: null };
  } finally {
    clearTimeout(t);
  }
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function extractOpenAiErrorMessage(data: unknown): string | null {
  const d = data as { error?: { message?: string } };
  const m = d?.error?.message;
  return typeof m === "string" && m.trim() ? m.trim() : null;
}

function statusEntry(res: JsonFetchResult): OpenAiEndpointStatus {
  return {
    httpStatus: res.status,
    ok: res.ok,
    errorMessage: res.ok ? null : extractOpenAiErrorMessage(res.data),
  };
}

export async function fetchOpenAiAccountSnapshot(): Promise<OpenAiAccountSnapshot> {
  const apiKey = await resolveOpenAiApiKey();
  if (!apiKey) {
    return {
      configured: false,
      connectivityOk: null,
      endpointStatus: {},
      billingApiAccess: null,
      credits: null,
      creditsParseSource: null,
      subscription: null,
      usagePeriodUsd: null,
      usageUnit: null,
      usageDataSource: null,
      usagePeriodLabel: null,
      accountBillingMode: "unknown",
      hints: [
        "Configure a chave OpenAI: variável OPENAI_API_KEY na Vercel (tem prioridade) ou em /admin/ia → Chave OpenAI da plataforma (cifrada no Supabase; requer PLATFORM_OPENAI_KEY_SECRET no servidor).",
      ],
      fetchError: null,
      rateLimited: false,
      suggestedRetryAfterSec: null,
    };
  }

  const hints: string[] = [
    "A OpenAI cobra por uso (tokens → USD). Créditos pré-pagos aparecem em dólares na API de billing quando existem grants.",
  ];

  const [grantsRes, subRes, connRes] = await Promise.all([
    openAiGetJson("/v1/dashboard/billing/credit_grants", apiKey),
    openAiGetJson("/v1/dashboard/billing/subscription", apiKey),
    openAiGetJson("/v1/models?limit=1", apiKey),
  ]);

  const endpointStatus: Partial<Record<OpenAiEndpointName, OpenAiEndpointStatus>> = {
    credit_grants: statusEntry(grantsRes),
    subscription: statusEntry(subRes),
    connectivity_models: statusEntry(connRes),
  };

  const connectivityOk = connRes.ok;

  let rateLimited =
    grantsRes.status === 429 || subRes.status === 429 || connRes.status === 429;
  let suggestedRetryAfterSec: number | null =
    grantsRes.retryAfterSec ?? subRes.retryAfterSec ?? connRes.retryAfterSec ?? null;

  if (!connRes.ok && connRes.status === 401) {
    hints.push("Chave inválida ou revogada (probe /v1/models). Gere uma nova em platform.openai.com → API keys.");
  } else if (!connRes.ok && connRes.status !== 0) {
    const msg = extractOpenAiErrorMessage(connRes.data);
    if (msg) hints.push(`Conectividade OpenAI: ${msg}`);
  }

  let credits: OpenAiAccountSnapshot["credits"] = null;
  let creditsParseSource: OpenAiAccountSnapshot["creditsParseSource"] = null;

  if (grantsRes.ok && grantsRes.data && typeof grantsRes.data === "object") {
    const parsed = parseCreditGrantsFromData(grantsRes.data);
    creditsParseSource = parsed.source;
    if (parsed.source !== "none") {
      credits = {
        totalGrantedUsd: parsed.totalGrantedUsd,
        totalUsedUsd: parsed.totalUsedUsd,
        totalAvailableUsd: parsed.totalAvailableUsd,
      };
    }
  } else if (!grantsRes.ok && grantsRes.status === 401) {
    hints.push("Créditos OpenAI: chave sem permissão ou inválida para billing.");
  } else if (!grantsRes.ok && grantsRes.status === 403) {
    hints.push(
      "Créditos OpenAI: 403 — a rota /v1/dashboard/billing/* costuma estar bloqueada para chaves de projeto (sk-proj-*). Saldo e faturação na web: https://platform.openai.com/settings/organization/billing/overview",
    );
  } else if (!grantsRes.ok && grantsRes.status > 0) {
    const msg = extractOpenAiErrorMessage(grantsRes.data);
    if (msg) hints.push(`Créditos OpenAI: ${msg}`);
  }

  let subscription: OpenAiAccountSnapshot["subscription"] = null;
  if (subRes.ok && subRes.data && typeof subRes.data === "object") {
    const s = subRes.data as Record<string, unknown>;
    const planRaw = s.plan;
    let planTitle: string | null = null;
    if (typeof planRaw === "string") planTitle = planRaw;
    else if (planRaw && typeof planRaw === "object" && "title" in planRaw) {
      const t = (planRaw as { title?: unknown }).title;
      if (typeof t === "string") planTitle = t;
    }
    subscription = {
      hardLimitUsd: num(s.hard_limit_usd ?? s.hard_limit),
      softLimitUsd: num(s.soft_limit_usd ?? s.soft_limit),
      plan: planTitle,
    };
  } else if (!subRes.ok && subRes.status === 403) {
    hints.push(
      "Subscrição billing: 403 — veja limites no dashboard OpenAI ou configure OPENAI_ADMIN_API_KEY para GET /v1/organization/costs (docs: https://platform.openai.com/docs/api-reference/usage/costs ).",
    );
  }

  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const startStr = start.toISOString().slice(0, 10);
  const endStr = now.toISOString().slice(0, 10);
  const usagePath = `/v1/dashboard/billing/usage?start_date=${startStr}&end_date=${endStr}`;
  const usageRes = await openAiGetJson(usagePath, apiKey);
  endpointStatus.usage = statusEntry(usageRes);
  if (usageRes.status === 429) {
    rateLimited = true;
    suggestedRetryAfterSec = suggestedRetryAfterSec ?? usageRes.retryAfterSec;
  }

  let usagePeriodUsd: number | null = null;
  let usageUnit: OpenAiAccountSnapshot["usageUnit"] = null;
  let usageDataSource: OpenAiAccountSnapshot["usageDataSource"] = null;
  let usagePeriodLabel: string | null = `Uso no mês (UTC ${startStr} → ${endStr})`;

  if (usageRes.ok) {
    const parsed = parseBillingUsageData(usageRes.data);
    usagePeriodUsd = parsed.usd;
    usageUnit = parsed.unit;
    if (usagePeriodUsd != null) usageDataSource = "dashboard_billing";
  } else if (!usageRes.ok && usageRes.status > 0) {
    const msg = extractOpenAiErrorMessage(usageRes.data);
    if (msg) hints.push(`Uso (billing legado): ${msg}`);
  }

  const billingForbiddenBoth =
    connectivityOk === true && grantsRes.status === 403 && subRes.status === 403;

  if (billingForbiddenBoth) {
    hints.push(
      "A chave funciona para modelos, mas o billing legado (/v1/dashboard/billing) devolveu 403 — comportamento típico de chaves de projeto. Para custos agregados via API oficial, defina OPENAI_ADMIN_API_KEY (chave Admin da organização) na Vercel.",
    );
  }

  if (usagePeriodUsd == null) {
    const monthStartUnix = Math.floor(start.getTime() / 1000);
    const endUnix = Math.floor(now.getTime() / 1000) + 120;
    const adminKey = resolveOpenAiAdminApiKey();
    const costsKey = adminKey ?? apiKey;
    const orgPath = `/v1/organization/costs?start_time=${monthStartUnix}&end_time=${endUnix}&limit=31&bucket_width=1d`;
    const orgRes = await openAiGetJson(orgPath, costsKey);
    endpointStatus.organization_costs = statusEntry(orgRes);
    if (orgRes.status === 429) {
      rateLimited = true;
      suggestedRetryAfterSec = suggestedRetryAfterSec ?? orgRes.retryAfterSec;
    }
    if (orgRes.ok) {
      const sum = sumOrganizationCostsUsd(orgRes.data);
      if (sum != null) {
        usagePeriodUsd = Math.round(sum * 1_000_000) / 1_000_000;
        usageUnit = "usd";
        usageDataSource = "organization_costs";
        usagePeriodLabel = `Custos (Organization Costs API, UTC ${startStr} → ${endStr})`;
      }
    } else if (!adminKey) {
      hints.push(
        "Sem custos no painel: o billing legado falhou e não há OPENAI_ADMIN_API_KEY para tentar GET /v1/organization/costs.",
      );
    } else {
      const om = extractOpenAiErrorMessage(orgRes.data);
      if (om) hints.push(`Organization costs: ${om}`);
    }
  }

  const hasGrantNumbers =
    credits != null &&
    (credits.totalAvailableUsd != null ||
      credits.totalGrantedUsd != null ||
      credits.totalUsedUsd != null);

  const grantsOkEmpty = grantsRes.ok && !hasGrantNumbers;

  let accountBillingMode: OpenAiAccountSnapshot["accountBillingMode"] = "unknown";
  if (hasGrantNumbers) {
    accountBillingMode = "prepaid_grants";
  } else if (grantsOkEmpty && subRes.ok) {
    accountBillingMode = "postpaid_or_no_grants";
    hints.push(
      "Conta pós-pago ou sem saldo pré-pago visível na API — não há credit grants. Consulte limite mensal e uso oficial abaixo; o extrato completo está no dashboard OpenAI.",
    );
  } else if (!grantsRes.ok && subRes.ok) {
    accountBillingMode = "postpaid_or_no_grants";
  }

  let billingApiAccess: OpenAiBillingApiAccess;
  if (grantsRes.ok || subRes.ok) {
    billingApiAccess = "ok";
  } else if (billingForbiddenBoth) {
    billingApiAccess = "forbidden_project_key";
  } else if (!grantsRes.ok && !subRes.ok) {
    billingApiAccess = "billing_unreachable";
  } else {
    billingApiAccess = "unknown";
  }

  let fetchError: string | null = null;
  if (billingForbiddenBoth) {
    fetchError = null;
  } else if (!grantsRes.ok && !subRes.ok) {
    const gMsg = extractOpenAiErrorMessage(grantsRes.data);
    const sMsg = extractOpenAiErrorMessage(subRes.data);
    fetchError =
      gMsg ??
      sMsg ??
      `Billing OpenAI indisponível (créditos HTTP ${grantsRes.status || "?"}, subscrição HTTP ${subRes.status || "?"}).`;
  } else if (connectivityOk === false && !grantsRes.ok && !subRes.ok) {
    fetchError = fetchError ?? "Não foi possível validar a chave nem o billing.";
  }

  return {
    configured: true,
    connectivityOk,
    endpointStatus,
    billingApiAccess,
    credits: hasGrantNumbers ? credits : grantsOkEmpty ? null : credits,
    creditsParseSource,
    subscription,
    usagePeriodUsd,
    usageUnit,
    usageDataSource,
    usagePeriodLabel,
    accountBillingMode,
    hints,
    fetchError,
    rateLimited,
    suggestedRetryAfterSec,
  };
}
