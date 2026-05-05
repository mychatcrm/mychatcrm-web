import { describe, expect, it } from "vitest";
import { parseCouponUpsert } from "@/lib/commercial/admin-payloads";

describe("parseCouponUpsert", () => {
  it("rejects invalid validFrom date", () => {
    const r = parseCouponUpsert(
      {
        code: "WELCOME10",
        internalName: "Cupom Boas-vindas",
        discountType: "percent",
        discountValue: 10,
        validFrom: "not-a-date",
      },
      undefined,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Data inicial inválida");
  });

  it("rejects validUntil before validFrom", () => {
    const r = parseCouponUpsert(
      {
        code: "WELCOME10",
        internalName: "Cupom Boas-vindas",
        discountType: "percent",
        discountValue: 10,
        validFrom: "2026-06-10",
        validUntil: "2026-06-01",
      },
      undefined,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("data final");
  });

  it("normalizes valid dates to ISO", () => {
    const r = parseCouponUpsert(
      {
        code: "WELCOME10",
        internalName: "Cupom Boas-vindas",
        discountType: "percent",
        discountValue: 10,
        validFrom: "2026-06-01",
        validUntil: "2026-06-20",
      },
      undefined,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.coupon.validFrom).toMatch(/^2026-06-01T/);
      expect(r.coupon.validUntil).toMatch(/^2026-06-20T/);
    }
  });
});
