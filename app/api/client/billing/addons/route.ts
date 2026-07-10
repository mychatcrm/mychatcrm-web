import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import {
  listActiveBillingAddons,
  listTenantBillingEntitlements,
  sumTenantEntitlementQuantity,
  toPublicBillingAddon,
  type BillingAddonKind,
} from "@/lib/server/billing-addons";

export const dynamic = "force-dynamic";

function requestedKind(value: string | null): BillingAddonKind | undefined {
  return value === "lead_capacity" || value === "whatsapp_line" ? value : undefined;
}

/** Authenticated, tenant-safe storefront data. Stripe identifiers never leave the server. */
export async function GET(request: Request) {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;

  const kind = requestedKind(new URL(request.url).searchParams.get("kind"));
  try {
    const [catalog, entitlements] = await Promise.all([
      listActiveBillingAddons(kind),
      listTenantBillingEntitlements({ tenantId: guard.session.tenantId, kind }),
    ]);
    return NextResponse.json(
      {
        addons: catalog.map(toPublicBillingAddon),
        active: {
          leadCapacityRecurring: sumTenantEntitlementQuantity(entitlements, "lead_capacity", "recurring"),
          leadCapacityTopup: sumTenantEntitlementQuantity(entitlements, "lead_capacity", "one_time"),
          whatsappLines: sumTenantEntitlementQuantity(entitlements, "whatsapp_line", "recurring"),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[client/billing/addons] list", error);
    return NextResponse.json({ error: "Não foi possível consultar capacidades adicionais." }, { status: 503 });
  }
}
