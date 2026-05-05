/** Parse de query strings comuns às APIs /api/admin/stripe/* */

const MAX_LIMIT = 100;

export type ParsedStripeAdminQuery = {
  fromIso: string;
  toIso: string;
  fromSec: number;
  toSec: number;
  limit: number;
  cursor: string | null;
  status: string | null;
  planSlug: string | null;
};

function clampLimit(raw: string | null): number {
  const n = Math.min(MAX_LIMIT, Math.max(1, Number(raw ?? 25) || 25));
  return Number.isFinite(n) ? n : 25;
}

/** Converte entrada `from`/`to` (ISO ou YYYY-MM-DD) em intervalo inclusivo até o fim do dia `to`. */
export function parseStripeAdminSearchParams(searchParams: URLSearchParams): ParsedStripeAdminQuery | { error: string } {
  const rawFrom = searchParams.get("from")?.trim();
  const rawTo = searchParams.get("to")?.trim();
  const now = Date.now();

  let toMs: number;
  let fromMs: number;

  if (rawTo) {
    const d = Date.parse(rawTo.length <= 10 ? `${rawTo}T23:59:59.999Z` : rawTo);
    if (Number.isNaN(d)) return { error: "Parâmetro to inválido." };
    toMs = d;
  } else {
    toMs = now;
  }

  if (rawFrom) {
    const d = Date.parse(rawFrom.length <= 10 ? `${rawFrom}T00:00:00.000Z` : rawFrom);
    if (Number.isNaN(d)) return { error: "Parâmetro from inválido." };
    fromMs = d;
  } else {
    fromMs = toMs - 29 * 24 * 60 * 60 * 1000;
  }

  if (fromMs > toMs) return { error: "from deve ser anterior a to." };

  const maxSpan = 366 * 24 * 60 * 60 * 1000;
  if (toMs - fromMs > maxSpan) return { error: "Intervalo máximo: 366 dias." };

  const limit = clampLimit(searchParams.get("limit"));
  const cursor = searchParams.get("cursor")?.trim() || null;
  const status = searchParams.get("status")?.trim() || null;
  const planSlug = searchParams.get("plan")?.trim() || null;

  return {
    fromIso: new Date(fromMs).toISOString(),
    toIso: new Date(toMs).toISOString(),
    fromSec: Math.floor(fromMs / 1000),
    toSec: Math.floor(toMs / 1000),
    limit,
    cursor,
    status,
    planSlug: planSlug && planSlug !== "all" ? planSlug.toLowerCase() : null,
  };
}
