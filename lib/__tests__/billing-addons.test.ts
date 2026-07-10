import { describe, expect, it } from "vitest";
import {
  effectiveAddonQuantity,
  sumTenantEntitlementQuantity,
  type TenantBillingEntitlement,
} from "@/lib/server/billing-addons";

function entitlement(overrides: Partial<TenantBillingEntitlement> = {}): TenantBillingEntitlement {
  return {
    id: "entitlement-1",
    tenant_id: "tenant-1",
    addon_catalog_id: "catalog-1",
    kind: "lead_capacity",
    billing_mode: "recurring",
    quantity: 100,
    status: "active",
    valid_from: "2026-07-01T00:00:00.000Z",
    valid_until: null,
    stripe_checkout_session_id: "cs_1",
    stripe_subscription_id: "sub_1",
    stripe_subscription_item_id: "si_1",
    stripe_invoice_id: null,
    source: "stripe",
    metadata: {},
    ...overrides,
  };
}

describe("billing add-on quantities", () => {
  it("converts purchased units into the effective commercial capacity", () => {
    expect(effectiveAddonQuantity(100, 2)).toBe(200);
    expect(effectiveAddonQuantity(1, 3)).toBe(3);
  });

  it("sums effective entitlements without mixing kinds or modes", () => {
    const rows = [
      entitlement({ id: "recurring", quantity: 200 }),
      entitlement({ id: "topup", billing_mode: "one_time", quantity: 100 }),
      entitlement({ id: "line", kind: "whatsapp_line", quantity: 2 }),
    ];

    expect(sumTenantEntitlementQuantity(rows, "lead_capacity")).toBe(300);
    expect(sumTenantEntitlementQuantity(rows, "lead_capacity", "recurring")).toBe(200);
    expect(sumTenantEntitlementQuantity(rows, "whatsapp_line")).toBe(2);
  });
});
