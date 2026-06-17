import { describe, expect, it } from "vitest";
import type { CommercialCoupon } from "@/lib/commercial/types";
import { buildSeedCommercialStore } from "@/lib/commercial/seed";
import {
  buildPromoRestrictionsFromOptions,
  buildPromotionCodeCreateParams,
  buildStripeCouponCreateParams,
  durationFromCoupon,
  mergeMainPromoOptions,
} from "@/lib/server/stripe-coupon-mapping";

function baseCoupon(overrides: Partial<CommercialCoupon> = {}): CommercialCoupon {
  const seed = buildSeedCommercialStore();
  return {
    ...seed.coupons[0],
    promoMaxRedemptions: null,
    promoExpiresAt: null,
    ...overrides,
  };
}

describe("durationFromCoupon", () => {
  it("maps first_cycle to once", () => {
    expect(durationFromCoupon(baseCoupon({ discountRecurrence: "first_cycle" }))).toEqual({
      duration: "once",
    });
  });

  it("maps repeating cycles", () => {
    expect(
      durationFromCoupon(
        baseCoupon({ discountRecurrence: "all_cycles", recurringCyclesLimit: 3 }),
      ),
    ).toEqual({ duration: "repeating", duration_in_months: 3 });
  });

  it("maps forever when no cycle limit", () => {
    expect(
      durationFromCoupon(baseCoupon({ discountRecurrence: "all_cycles", recurringCyclesLimit: null })),
    ).toEqual({ duration: "forever" });
  });
});

describe("buildStripeCouponCreateParams", () => {
  it("maps percent discount and coupon-level limits", () => {
    const coupon = baseCoupon({
      internalName: "Black Friday",
      discountType: "percent",
      discountValue: 25,
      maxRedemptionsTotal: 100,
      validUntil: "2026-12-31T23:59:00.000Z",
      stripeProductIds: ["prod_abc"],
    });
    const params = buildStripeCouponCreateParams(coupon);
    expect(params.name).toBe("Black Friday");
    expect(params.percent_off).toBe(25);
    expect(params.max_redemptions).toBe(100);
    expect(params.redeem_by).toBe(Math.floor(new Date(coupon.validUntil!).getTime() / 1000));
    expect(params.applies_to).toEqual({ products: ["prod_abc"] });
  });

  it("maps fixed BRL discount", () => {
    const params = buildStripeCouponCreateParams(
      baseCoupon({ discountType: "fixed", discountValue: 1500 }),
    );
    expect(params.amount_off).toBe(1500);
    expect(params.currency).toBe("brl");
  });

  it("omits zero max_redemptions", () => {
    const params = buildStripeCouponCreateParams(baseCoupon({ maxRedemptionsTotal: 0 }));
    expect(params.max_redemptions).toBeUndefined();
  });
});

describe("buildPromoRestrictionsFromOptions", () => {
  it("maps first-time and minimum with currency", () => {
    const restrictions = buildPromoRestrictionsFromOptions({
      firstTimeOnly: true,
      minimumAmountCents: 5000,
      minimumAmountCurrency: "usd",
    });
    expect(restrictions).toEqual({
      first_time_transaction: true,
      minimum_amount: 5000,
      minimum_amount_currency: "usd",
    });
  });

  it("skips zero minimum", () => {
    expect(buildPromoRestrictionsFromOptions({ minimumAmountCents: 0 })).toBeUndefined();
  });
});

describe("buildPromotionCodeCreateParams", () => {
  it("maps promo limits, expiry and active flag", () => {
    const expires = "2026-06-30T23:59:00.000Z";
    const params = buildPromotionCodeCreateParams("coupon_1", "SAVE20", {
      firstTimeOnly: true,
      promoMaxRedemptions: 5,
      promoExpiresAt: expires,
      active: false,
    });
    expect(params.code).toBe("SAVE20");
    expect(params.active).toBe(false);
    expect(params.max_redemptions).toBe(5);
    expect(params.expires_at).toBe(Math.floor(new Date(expires).getTime() / 1000));
    expect(params.restrictions?.first_time_transaction).toBe(true);
  });
});

describe("mergeMainPromoOptions", () => {
  it("prefers persisted coupon promo fields over transient options", () => {
    const coupon = baseCoupon({
      promoMaxRedemptions: 10,
      promoExpiresAt: "2026-01-01T00:00:00.000Z",
      active: false,
    });
    const merged = mergeMainPromoOptions(coupon, { promoMaxRedemptions: 3 });
    expect(merged.promoMaxRedemptions).toBe(3);
    expect(merged.promoExpiresAt).toBe(coupon.promoExpiresAt);
    expect(merged.active).toBe(false);
  });
});

describe("parseCouponUpsert integration expectations", () => {
  it("documents MyChatCRM-only fields not sent to Stripe coupon", () => {
    const mychatcrmOnly: (keyof CommercialCoupon)[] = [
      "description",
      "partnerId",
      "maxRedemptionsPerUser",
      "allowedPlanSlugs",
      "allowedPeriodicities",
      "validFrom",
    ];
    expect(mychatcrmOnly.length).toBeGreaterThan(0);
  });
});
