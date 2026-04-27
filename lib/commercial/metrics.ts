import type { CommercialStore } from "@/lib/commercial/types";

function parseTime(iso: string) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Aceita `YYYY-MM-DD` (filtro admin) ou ISO completo. */
function parseRangeBound(raw: string, endOfDay: boolean) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return parseTime(endOfDay ? `${trimmed}T23:59:59.999Z` : `${trimmed}T00:00:00.000Z`);
  }
  return parseTime(trimmed);
}

export function filterRedemptionsByRange(
  store: CommercialStore,
  fromIso?: string | null,
  toIso?: string | null,
) {
  const fromMs = fromIso ? parseRangeBound(fromIso, false) : null;
  const toMs = toIso ? parseRangeBound(toIso, true) : null;
  return store.redemptions.filter((r) => {
    if (r.status !== "committed") return false;
    const t = parseTime(r.createdAt);
    if (t === null) return false;
    if (fromMs !== null && t < fromMs) return false;
    if (toMs !== null && t > toMs) return false;
    return true;
  });
}

export function buildCommercialMetrics(store: CommercialStore, fromIso?: string | null, toIso?: string | null) {
  const rows = filterRedemptionsByRange(store, fromIso, toIso);
  const revenueCents = rows.reduce((a, r) => a + r.finalCents, 0);
  const discountCents = rows.reduce((a, r) => a + r.discountCents, 0);
  const commissionCents = rows.reduce((a, r) => a + r.commissionCents, 0);

  const couponUses = new Map<string, { couponId: string; code: string; count: number; discountCents: number }>();
  for (const r of rows) {
    const cur = couponUses.get(r.couponId) ?? {
      couponId: r.couponId,
      code: r.codeNormalized,
      count: 0,
      discountCents: 0,
    };
    cur.count += 1;
    cur.discountCents += r.discountCents;
    couponUses.set(r.couponId, cur);
  }
  const topCoupons = [...couponUses.values()].sort((a, b) => b.count - a.count).slice(0, 10);

  const partnerComm = new Map<string, { partnerId: string; commissionCents: number; redemptions: number }>();
  for (const r of rows) {
    if (!r.partnerId) continue;
    const cur = partnerComm.get(r.partnerId) ?? { partnerId: r.partnerId, commissionCents: 0, redemptions: 0 };
    cur.commissionCents += r.commissionCents;
    cur.redemptions += 1;
    partnerComm.set(r.partnerId, cur);
  }
  const partnerMeta = new Map(store.partners.map((p) => [p.id, p]));
  const topPartners = [...partnerComm.values()]
    .map((row) => ({
      ...row,
      name: partnerMeta.get(row.partnerId)?.name ?? row.partnerId,
      code: partnerMeta.get(row.partnerId)?.code ?? "",
    }))
    .sort((a, b) => b.commissionCents - a.commissionCents)
    .slice(0, 10);

  return {
    redemptionCount: rows.length,
    revenueCents,
    discountCents,
    commissionCents,
    topCoupons,
    topPartners,
  };
}
