/**
 * Consulta endpoints de billing da OpenAI (mesma API key que o chat).
 * Documentação pública limitada — respostas podem variar por tipo de conta.
 */
import { resolveOpenAiApiKey } from "@/lib/ai/gateway";

const BILLING_TIMEOUT_MS = 12_000;

export type OpenAiAccountSnapshot = {
  configured: boolean;
  credits: {
    totalGrantedUsd: number | null;
    totalUsedUsd: number | null;
    totalAvailableUsd: number | null;
  } | null;
  subscription: {
    hardLimitUsd: number | null;
    softLimitUsd: number | null;
    plan: string | null;
  } | null;
  /** Uso faturável no intervalo (quando a API aceita a consulta). */
  usagePeriodUsd: number | null;
  usagePeriodLabel: string | null;
  hints: string[];
  fetchError: string | null;
};

async function openAiGetJson(path: string, apiKey: string): Promise<{ ok: boolean; data: unknown; status: number }> {
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
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text.slice(0, 200) };
    }
    return { ok: res.ok, data, status: res.status };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "fetch_failed";
    return { ok: false, data: { error: msg }, status: 0 };
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

/** Soma `total_usage` de linhas de billing usage (quando presente). */
function sumUsageUsd(data: unknown): number | null {
  const d = data as { total_usage?: number; daily_costs?: Array<{ line_items?: Array<{ cost?: number }> }> };
  if (typeof d?.total_usage === "number" && Number.isFinite(d.total_usage)) {
    return d.total_usage;
  }
  const daily = d?.daily_costs;
  if (!Array.isArray(daily)) return null;
  let sum = 0;
  let any = false;
  for (const day of daily) {
    const items = day?.line_items;
    if (!Array.isArray(items)) continue;
    for (const li of items) {
      const c = num(li?.cost);
      if (c != null) {
        sum += c;
        any = true;
      }
    }
  }
  return any ? sum : null;
}

export async function fetchOpenAiAccountSnapshot(): Promise<OpenAiAccountSnapshot> {
  const apiKey = resolveOpenAiApiKey();
  if (!apiKey) {
    return {
      configured: false,
      credits: null,
      subscription: null,
      usagePeriodUsd: null,
      usagePeriodLabel: null,
      hints: ["Defina OPENAI_API_KEY no servidor (ex.: Vercel → Environment Variables) para ver saldo e para os agentes responderem."],
      fetchError: null,
    };
  }

  const hints: string[] = [
    "A OpenAI cobra por uso (tokens → USD). Créditos pré-pagos aparecem em dólares, não como ‘tokens restantes’ da conta.",
  ];

  const [grantsRes, subRes] = await Promise.all([
    openAiGetJson("/v1/dashboard/billing/credit_grants", apiKey),
    openAiGetJson("/v1/dashboard/billing/subscription", apiKey),
  ]);

  let credits: OpenAiAccountSnapshot["credits"] = null;
  if (grantsRes.ok && grantsRes.data && typeof grantsRes.data === "object") {
    const g = grantsRes.data as Record<string, unknown>;
    credits = {
      totalGrantedUsd: num(g.total_granted),
      totalUsedUsd: num(g.total_used),
      totalAvailableUsd: num(g.total_available),
    };
  } else if (!grantsRes.ok && grantsRes.status === 401) {
    hints.push("Chave inválida ou revogada. Gere uma nova em platform.openai.com → API keys.");
  } else if (!grantsRes.ok) {
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
  }

  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const startStr = start.toISOString().slice(0, 10);
  const endStr = now.toISOString().slice(0, 10);
  const usagePath = `/v1/dashboard/billing/usage?start_date=${startStr}&end_date=${endStr}`;
  const usageRes = await openAiGetJson(usagePath, apiKey);
  let usagePeriodUsd: number | null = null;
  if (usageRes.ok) {
    usagePeriodUsd = sumUsageUsd(usageRes.data);
  }

  let fetchError: string | null = null;
  if (!grantsRes.ok && !subRes.ok) {
    const gMsg = extractOpenAiErrorMessage(grantsRes.data);
    const sMsg = extractOpenAiErrorMessage(subRes.data);
    fetchError = gMsg ?? sMsg ?? `Billing OpenAI indisponível (HTTP ${grantsRes.status || "?"}).`;
  }

  return {
    configured: true,
    credits,
    subscription,
    usagePeriodUsd,
    usagePeriodLabel: `Uso no mês (UTC ${startStr} → ${endStr})`,
    hints,
    fetchError,
  };
}
