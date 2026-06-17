import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSeedCommercialStore } from "@/lib/commercial/seed";
import type { CommercialCoupon } from "@/lib/commercial/types";

const mocks = vi.hoisted(() => ({
  assertCommercialCouponsSchemaReady: vi.fn(),
  upsertCoupon: vi.fn(),
  insertExtraCode: vi.fn(),
  deleteCoupon: vi.fn(),
  stripeCouponsCreate: vi.fn(),
  stripeCouponsDel: vi.fn(),
  stripePromotionCodesCreate: vi.fn(),
  stripeCustomersList: vi.fn(),
  stripeCustomersCreate: vi.fn(),
}));

vi.mock("@/lib/server/commercial-store-db", () => ({
  assertCommercialCouponsSchemaReady: mocks.assertCommercialCouponsSchemaReady,
  upsertCoupon: mocks.upsertCoupon,
  insertExtraCode: mocks.insertExtraCode,
  deleteCoupon: mocks.deleteCoupon,
  isCommercialCouponsSchemaError: (err: unknown) =>
    err instanceof Error && err.name === "CommercialCouponsSchemaError",
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    coupons: {
      create: mocks.stripeCouponsCreate,
      del: mocks.stripeCouponsDel,
    },
    promotionCodes: {
      create: mocks.stripePromotionCodesCreate,
    },
    customers: {
      list: mocks.stripeCustomersList,
      create: mocks.stripeCustomersCreate,
    },
  }),
}));

import { createCouponWithStripe } from "@/lib/server/create-coupon";

function schemaError(message = "Configuração do banco de cupons incompleta.") {
  const err = new Error(message);
  err.name = "CommercialCouponsSchemaError";
  return err;
}

function baseCoupon(overrides: Partial<CommercialCoupon> = {}): CommercialCoupon {
  const seed = buildSeedCommercialStore();
  return { ...seed.coupons[0], id: "cpn_safe", code: "SAFE100", ...overrides };
}

describe("createCouponWithStripe safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCommercialCouponsSchemaReady.mockResolvedValue(undefined);
    mocks.upsertCoupon.mockResolvedValue(undefined);
    mocks.insertExtraCode.mockResolvedValue(undefined);
    mocks.stripeCouponsCreate.mockResolvedValue({ id: "co_safe" });
    mocks.stripeCouponsDel.mockResolvedValue({ id: "co_safe", deleted: true });
    mocks.stripePromotionCodesCreate.mockResolvedValue({ id: "promo_safe" });
    mocks.stripeCustomersList.mockResolvedValue({ data: [] });
    mocks.stripeCustomersCreate.mockResolvedValue({ id: "cus_safe" });
  });

  it("blocks Stripe creation when the coupon schema preflight fails", async () => {
    mocks.assertCommercialCouponsSchemaReady.mockRejectedValueOnce(schemaError());

    const result = await createCouponWithStripe(baseCoupon(), []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toContain("Configuração do banco de cupons");
    }
    expect(mocks.stripeCouponsCreate).not.toHaveBeenCalled();
    expect(mocks.stripePromotionCodesCreate).not.toHaveBeenCalled();
  });

  it("rolls back the Stripe coupon and reports a database error when saving fails after Stripe creation", async () => {
    mocks.upsertCoupon.mockRejectedValueOnce(schemaError("Configuração do banco de cupons incompleta. Detalhe: schema cache"));

    const result = await createCouponWithStripe(baseCoupon({ createPublicCode: false }), []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toContain("Configuração do banco de cupons");
      expect(result.error).not.toContain("Falha ao criar cupom no Stripe");
    }
    expect(mocks.stripeCouponsCreate).toHaveBeenCalledTimes(1);
    expect(mocks.stripeCouponsDel).toHaveBeenCalledWith("co_safe");
  });
});
