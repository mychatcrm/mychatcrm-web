import { describe, expect, it } from "vitest";
import { buildSeedCommercialStore } from "@/lib/commercial/seed";
import type { CommercialCoupon } from "@/lib/commercial/types";
import {
  findDuplicateCodes,
  isSafeEditOnly,
  mergeSafeCouponEdit,
} from "@/lib/server/create-coupon";

function baseCoupon(overrides: Partial<CommercialCoupon> = {}): CommercialCoupon {
  const seed = buildSeedCommercialStore();
  return { ...seed.coupons[0], ...overrides };
}

describe("findDuplicateCodes", () => {
  it("detects duplicate main code", () => {
    const store = buildSeedCommercialStore();
    const dup = findDuplicateCodes(store, "SOLO15", []);
    expect(dup).toBe("SOLO15");
  });

  it("detects duplicate within extra codes payload", () => {
    const store = buildSeedCommercialStore();
    const dup = findDuplicateCodes(store, "NEWCODE", ["NEWCODE"]);
    expect(dup).toBe("NEWCODE");
  });
});

describe("isSafeEditOnly", () => {
  it("allows edit when only safe fields change", () => {
    const existing = baseCoupon({ id: "cpn_1", code: "TEST" });
    const incoming = mergeSafeCouponEdit(existing, {
      ...existing,
      internalName: "Novo nome",
      description: "Nova descrição",
    });
    expect(isSafeEditOnly(existing, incoming)).toBe(true);
  });

  it("rejects edit when discount changes", () => {
    const existing = baseCoupon({ id: "cpn_1", code: "TEST", discountValue: 10 });
    const incoming = { ...existing, discountValue: 20 };
    expect(isSafeEditOnly(existing, incoming)).toBe(false);
  });
});
