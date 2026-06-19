import { describe, expect, it } from "vitest";
import { buildSeedCommercialStore } from "@/lib/commercial/seed";
import type { CommercialCoupon, CommercialStore } from "@/lib/commercial/types";
import {
  countCommittedRedemptionsForCoupon,
  countCommittedRedemptionsForUserOnCoupon,
} from "@/lib/commercial/engine";
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
    description: patch.description ?? "",
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
    stripeCouponId: "stripeCouponId" in patch ? patch.stripeCouponId ?? null : "cou_test",
    stripePromoCodeId: "stripePromoCodeId" in patch ? patch.stripePromoCodeId ?? null : "promo_test_main",
    stripeProductIds: patch.stripeProductIds ?? [],
    createPublicCode: patch.createPublicCode ?? true,
    firstTimeOnly: false,
    restrictedCustomerEmail: null,
    minimumAmountCents: null,
    minimumAmountCurrency: null,
    promoMaxRedemptions: null,
    promoExpiresAt: null,
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

  it("aceita cupom restrito quando o Product do Price corresponde", () => {
    const store = withCoupon(buildSeedCommercialStore(), {
      code: "PRODOK",
      allowedPlanSlugs: ["escala"],
      stripeProductIds: ["prod_escala"],
    });

    const result = resolveCheckoutCoupon({
      store,
      codeRaw: "PRODOK",
      planSlug: "escala",
      billingCycle: "annual",
      stripeProductId: "prod_escala",
    });

    expect(result.ok).toBe(true);
  });

  it("rejeita cupom restrito quando o Product do Price não corresponde", () => {
    const store = withCoupon(buildSeedCommercialStore(), {
      code: "PRODFAIL",
      allowedPlanSlugs: ["escala"],
      stripeProductIds: ["prod_addon"],
    });

    const result = resolveCheckoutCoupon({
      store,
      codeRaw: "PRODFAIL",
      planSlug: "escala",
      billingCycle: "annual",
      stripeProductId: "prod_escala",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("COUPON_PRODUCT_NOT_ALLOWED");
      expect(result.message).toBe("Este cupom não se aplica ao produto deste plano.");
    }
  });

  it("aplica a restrição de Product do cupom pai em extra codes", () => {
    const base = withCoupon(buildSeedCommercialStore(), {
      code: "PARENT",
      allowedPlanSlugs: ["escala"],
      stripeProductIds: ["prod_solo"],
    });
    const coupon = base.coupons.find((c) => c.code === "PARENT")!;
    const store: CommercialStore = {
      ...base,
      extraCodes: [
        {
          id: "exc_product",
          couponId: coupon.id,
          code: "CHILD",
          stripePromoCodeId: "promo_child",
          createdAt: new Date().toISOString(),
        },
      ],
    };

    const result = resolveCheckoutCoupon({
      store,
      codeRaw: "CHILD",
      planSlug: "escala",
      billingCycle: "annual",
      stripeProductId: "prod_escala",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("COUPON_PRODUCT_NOT_ALLOWED");
    }
  });

  it("reconhece TEST100 interno sem exigir Promotion Code Stripe", () => {
    const store = withCoupon(buildSeedCommercialStore(), {
      code: "TEST100",
      internalName: "TEST100 · contas de teste",
      description:
        "[internal-test-provisioning] Cupom interno para criar contas de teste sem checkout Stripe.",
      allowedPlanSlugs: [],
      createPublicCode: false,
      stripeCouponId: null,
      stripePromoCodeId: null,
    });

    const result = resolveCheckoutCoupon({
      store,
      codeRaw: "TEST100",
      planSlug: "escala",
      billingCycle: "annual",
      stripeProductId: "prod_escala",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.finalCents).toBe(0);
      expect(result.stripePromoCodeId).toBeNull();
      expect(result.internalProvisioning).toBe(true);
    }
  });
});

describe("contadores de uso de cupom", () => {
  it("conta committed e confirmed como uso de limite", () => {
    const base = withCoupon(buildSeedCommercialStore(), {
      code: "LIMIT",
      allowedPlanSlugs: ["escala"],
    });
    const coupon = base.coupons.find((c) => c.code === "LIMIT")!;
    const store: CommercialStore = {
      ...base,
      redemptions: [
        {
          id: "red_pending",
          createdAt: new Date().toISOString(),
          status: "pending",
          idempotencyKey: "pending",
          couponId: coupon.id,
          codeNormalized: "LIMIT",
          planSlug: "escala",
          emailNormalized: "renato@example.com",
          originalCents: 10000,
          discountCents: 1000,
          finalCents: 9000,
          partnerId: null,
          commissionCents: 0,
        },
        {
          id: "red_committed",
          createdAt: new Date().toISOString(),
          status: "committed",
          idempotencyKey: "committed",
          couponId: coupon.id,
          codeNormalized: "LIMIT",
          planSlug: "escala",
          emailNormalized: "renato@example.com",
          originalCents: 10000,
          discountCents: 1000,
          finalCents: 9000,
          partnerId: null,
          commissionCents: 0,
        },
        {
          id: "red_confirmed",
          createdAt: new Date().toISOString(),
          status: "confirmed",
          idempotencyKey: "confirmed",
          couponId: coupon.id,
          codeNormalized: "LIMIT",
          planSlug: "escala",
          emailNormalized: "renato@example.com",
          originalCents: 10000,
          discountCents: 1000,
          finalCents: 9000,
          partnerId: null,
          commissionCents: 0,
        },
      ],
    };

    expect(countCommittedRedemptionsForCoupon(store, coupon.id)).toBe(2);
    expect(countCommittedRedemptionsForUserOnCoupon(store, coupon.id, "renato@example.com")).toBe(2);
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
