/**
 * Parsing puro de respostas billing OpenAI (testável com fixtures, sem rede).
 */

export type ParsedCredits = {
  totalGrantedUsd: number | null;
  totalUsedUsd: number | null;
  totalAvailableUsd: number | null;
  source: "root" | "aggregated" | "none";
};

function n(v: unknown): number | null {
  const x = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(x) ? x : null;
}

function getGrantRows(data: Record<string, unknown>): unknown[] {
  const direct = data.data;
  if (Array.isArray(direct)) return direct;
  const grants = data.grants;
  if (grants && typeof grants === "object" && "data" in grants) {
    const inner = (grants as { data?: unknown }).data;
    if (Array.isArray(inner)) return inner;
  }
  return [];
}

/** Extrai totais de credit_grants / credit_summary / lista de grants. */
export function parseCreditGrantsFromData(data: unknown): ParsedCredits {
  if (!data || typeof data !== "object") {
    return { totalGrantedUsd: null, totalUsedUsd: null, totalAvailableUsd: null, source: "none" };
  }
  const o = data as Record<string, unknown>;

  const summary = o.credit_summary;
  if (summary && typeof summary === "object") {
    const inner = parseCreditGrantsFromData(summary);
    if (inner.source !== "none") return inner;
  }

  const rootGranted = n(o.total_granted);
  const rootUsed = n(o.total_used);
  const rootAvail = n(o.total_available);
  if (rootGranted != null || rootUsed != null || rootAvail != null) {
    return {
      totalGrantedUsd: rootGranted,
      totalUsedUsd: rootUsed,
      totalAvailableUsd: rootAvail,
      source: "root",
    };
  }

  const rows = getGrantRows(o);
  if (rows.length === 0) {
    return { totalGrantedUsd: null, totalUsedUsd: null, totalAvailableUsd: null, source: "none" };
  }

  let granted = 0;
  let used = 0;
  let avail = 0;
  let any = false;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const ga = n(r.grant_amount ?? r.amount ?? r.total_amount);
    const ua = n(r.used_amount ?? r.amount_used);
    const av = n(r.available_amount ?? r.remaining_amount);
    if (ga != null) {
      granted += ga;
      any = true;
    }
    if (ua != null) {
      used += ua;
      any = true;
    }
    if (av != null) {
      avail += av;
      any = true;
    }
  }

  if (!any) {
    return { totalGrantedUsd: null, totalUsedUsd: null, totalAvailableUsd: null, source: "none" };
  }

  const totalAvailableUsd = avail > 0 ? avail : granted > 0 || used > 0 ? Math.max(0, granted - used) : null;

  return {
    totalGrantedUsd: granted > 0 ? granted : null,
    totalUsedUsd: used > 0 ? used : null,
    totalAvailableUsd,
    source: "aggregated",
  };
}

export type ParsedUsage = {
  usd: number | null;
  /** OpenAI cost em billing/usage costuma vir em centavos (inteiro). */
  unit: "usd" | "cents_normalized";
};

function sumLineItemCosts(daily: unknown[]): { sum: number; count: number } {
  let sum = 0;
  let count = 0;
  for (const day of daily) {
    if (!day || typeof day !== "object") continue;
    const items = (day as { line_items?: unknown }).line_items;
    if (!Array.isArray(items)) continue;
    for (const li of items) {
      if (!li || typeof li !== "object") continue;
      const c = n((li as { cost?: unknown }).cost);
      if (c != null) {
        sum += c;
        count++;
      }
    }
  }
  return { sum, count };
}

/** Agrega uso faturável; normaliza centavos → USD quando apropriado. */
export function parseBillingUsageData(data: unknown): ParsedUsage {
  if (!data || typeof data !== "object") {
    return { usd: null, unit: "usd" };
  }
  const d = data as { total_usage?: number; daily_costs?: unknown[] };

  const daily = d.daily_costs;
  const fromLines = Array.isArray(daily) ? sumLineItemCosts(daily) : { sum: 0, count: 0 };

  let raw: number | null = null;
  if (typeof d.total_usage === "number" && Number.isFinite(d.total_usage)) {
    raw = d.total_usage;
  } else if (fromLines.count > 0) {
    raw = fromLines.sum;
  }

  if (raw == null) return { usd: null, unit: "usd" };

  /** Valores inteiros “grandes” costumam ser centavos na API de billing. */
  const looksLikeCents = Number.isInteger(raw) && raw >= 100;
  if (looksLikeCents) {
    return { usd: raw / 100, unit: "cents_normalized" };
  }
  /** Valores pequenos inteiros (ex.: 5) tratamos como USD. */
  return { usd: raw, unit: "usd" };
}
