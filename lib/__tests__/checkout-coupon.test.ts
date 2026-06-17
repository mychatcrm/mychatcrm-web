import { describe, expect, it } from "vitest";
import { buildSeedCommercialStore } from "@/lib/commercial/seed";
import type { CommercialCoupon, CommercialStore } from "@/lib/commercial/types";
import {
  findCouponByStripePromoCodeId,
  resolveCheckoutCoupon,
} from "@/lib/server/checkout-coupon";

function withCoupon(store: CommercialStore, patch: Partial<CommercialCoupon> & { code: string }): CommercialStore {
  const id = `cpn_test_${patch.code}`;
  const coupon: CommercialCoupon = {
    id,
    code: patch.code,
    internalName: patch.internalName ?? patch.code,
    description: "",
    discountType: patch.discountType ?? "percent",
    discountValue: patch.discountValue ?? 100,
    validFrom: null,
    validUntil: null,
    maxRedemptionsTotal: null,
    maxRedemptionsPerUser: null,
    allowedPlanSlugs: patch.allowedPlanSlugs ?? ["escala"],
    allowedPeriodicities: patch.allowedPeriodicities ?? [],
    discountRecurrence: "all_cycles",
    recurringCyclesLimit: null,
    active: patch.active ?? true,
    partnerId: null,
    stripeCouponId: patch.stripeCouponId ?? "cou_test",
    stripePromoCodeId: patch.stripePromoCodeId ?? "promo_test_main",
    stripeProductIds: [],
    createPublicCode: true,
    firstTimeOnly: false,
    restrictedCustomerEmail: null,
    minimumAmountCents: null,
    minimumAmountCurrency: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return { ...store, coupons: [...store.coupons, coupon] };
}

describe("resolveCheckoutCoupon", () => {
  it("aceita cupom yearly-only no ciclo anual", () => {
    const store = withCoupon(buildSeedCommercialStore(), {
      code: "YEARLY100",
      allowedPeriodicities: ["yearly"],
      allowedPlanSlugs: ["escala"],
    });

    const result = resolveCheckoutCoupon({
      store,
      codeRaw: "YEARLY100",
      planSlug: "escala",
      billingCycle: "annual",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.finalCents).toBe(0);
      expect(result.stripePromoCodeId).toBe("promo_test_main");
    }
  });

  it("rejeita cupom yearly-only no ciclo mensal", () => {
    const store = withCoupon(buildSeedCommercialStore(), {
      code: "YEARLY100",
      allowedPeriodicities: ["yearly"],
      allowedPlanSlugs: ["escala"],
    });

    const result = resolveCheckoutCoupon({
      store,
      codeRaw: "YEARLY100",
      planSlug: "escala",
      billingCycle: "monthly",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("COUPON_PERIOD_NOT_ALLOWED");
    }
  });

  it("resolve extra code para promo ID do extra", () => {
    const base = withCoupon(buildSeedCommercialStore(), {
      code: "MAINCODE",
      stripePromoCodeId: "promo_main",
      allowedPlanSlugs: ["escala"],
    });
    const coupon = base.coupons.find((c) => c.code === "MAINCODE")!;
    const store: CommercialStore = {
      ...base,
      extraCodes: [
        {
          id: "exc_1",
          couponId: coupon.id,
          code: "EXTRACODE",
          stripePromoCodeId: "promo_extra",
          createdAt: new Date().toISOString(),
        },
      ],
    };

    const result = resolveCheckoutCoupon({
      store,
      codeRaw: "EXTRACODE",
      planSlug: "escala",
      billingCycle: "annual",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.code).toBe("MAINCODE");
      expect(result.stripePromoCodeId).toBe("promo_extra");
      expect(result.normalizedCode).toBe("EXTRACODE");
    }
  });
});

describe("findCouponByStripePromoCodeId", () => {
  it("encontra cupom pelo promo principal ou extra", () => {
    const base = withCoupon(buildSeedCommercialStore(), { code: "MAINCODE" });
    const coupon = base.coupons.find((c) => c.code === "MAINCODE")!;
    const store: CommercialStore = {
      ...base,
      extraCodes: [
        {
          id: "exc_1",
          couponId: coupon.id,
          code: "EXTRA",
          stripePromoCodeId: "promo_extra_only",
          createdAt: new Date().toISOString(),
        },
      ],
    };

    expect(findCouponByStripePromoCodeId(store, "promo_test_main")?.code).toBe("MAINCODE");
    expect(findCouponByStripePromoCodeId(store, "promo_extra_only")?.code).toBe("MAINCODE");
    expect(findCouponByStripePromoCodeId(store, "promo_unknown")).toBeNull();
  });
});
