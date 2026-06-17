import { describe, expect, it } from "vitest";
import { parseCouponUpsert } from "@/lib/commercial/admin-payloads";

describe("parseCouponUpsert", () => {
  it("auto-generates internal code when createPublicCode is false", () => {
    const result = parseCouponUpsert(
      {
        internalName: "Cupom interno",
        discountType: "percent",
        discountValue: 10,
        createPublicCode: false,
        code: "",
      },
      undefined,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.coupon.code).toMatch(/^INT_/);
      expect(result.coupon.createPublicCode).toBe(false);
    }
  });

  it("persists promo limits on coupon model", () => {
    const result = parseCouponUpsert(
      {
        code: "TEST10",
        internalName: "Teste",
        discountType: "percent",
        discountValue: 10,
        promoMaxRedemptions: 7,
        promoExpiresAt: "2026-12-31T23:59:00.000Z",
        minimumAmountCents: 1000,
        minimumAmountCurrency: "eur",
      },
      undefined,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.coupon.promoMaxRedemptions).toBe(7);
      expect(result.coupon.promoExpiresAt).toBeTruthy();
      expect(result.coupon.minimumAmountCents).toBe(1000);
      expect(result.coupon.minimumAmountCurrency).toBe("eur");
    }
  });
});
