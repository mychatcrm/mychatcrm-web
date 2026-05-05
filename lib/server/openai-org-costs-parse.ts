/**
 * Soma custos USD da resposta GET /v1/organization/costs (buckets com results[].amount).
 */

function num(v: unknown): number | null {
  const x = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(x) ? x : null;
}

/** Agrega amount.value em USD (ou qualquer moeda na mesma resposta — normalmente USD). */
export function sumOrganizationCostsUsd(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const root = data as { data?: unknown[] };
  if (!Array.isArray(root.data)) return null;
  let sum = 0;
  let any = false;
  for (const bucket of root.data) {
    if (!bucket || typeof bucket !== "object") continue;
    const results = (bucket as { results?: unknown[] }).results;
    if (!Array.isArray(results)) continue;
    for (const r of results) {
      if (!r || typeof r !== "object") continue;
      const amount = (r as { amount?: { value?: unknown; currency?: unknown } }).amount;
      const v = num(amount?.value);
      if (v != null) {
        sum += v;
        any = true;
      }
    }
  }
  return any ? sum : null;
}
