import type { CommercialCoupon, CommercialPartner, CommercialStore } from "@/lib/commercial/types";

function isoNow() {
  return new Date().toISOString();
}

/** Parceiro é fonte da lista `linkedCouponIds`; atualiza `coupon.partnerId`. */
export function applyPartnerCouponLinks(store: CommercialStore, partner: CommercialPartner): CommercialStore {
  const nextCoupons = store.coupons.map((c) => {
    if (partner.linkedCouponIds.includes(c.id)) {
      if (c.partnerId === partner.id) return c;
      return { ...c, partnerId: partner.id, updatedAt: isoNow() };
    }
    if (c.partnerId === partner.id) {
      return { ...c, partnerId: null, updatedAt: isoNow() };
    }
    return c;
  });
  return { ...store, coupons: nextCoupons };
}

/** Cupom com `partnerId` mantém parceiros `linkedCouponIds` coerentes. */
export function applyCouponPartnerLink(store: CommercialStore, coupon: CommercialCoupon): CommercialStore {
  const nextPartners = store.partners.map((p) => {
    const has = p.linkedCouponIds.includes(coupon.id);
    if (coupon.partnerId === p.id) {
      if (has) return p;
      return { ...p, linkedCouponIds: [...p.linkedCouponIds, coupon.id], updatedAt: isoNow() };
    }
    if (has) {
      return {
        ...p,
        linkedCouponIds: p.linkedCouponIds.filter((id) => id !== coupon.id),
        updatedAt: isoNow(),
      };
    }
    return p;
  });
  return { ...store, partners: nextPartners };
}
