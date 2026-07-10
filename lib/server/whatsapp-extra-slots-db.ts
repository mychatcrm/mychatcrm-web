import "server-only";
import { listTenantBillingEntitlements, sumTenantEntitlementQuantity } from "@/lib/server/billing-addons";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

/** Linhas WhatsApp extra compradas pelo tenant (Stripe), usado por assertSlotIndexAllowed. */
export async function getExtraWhatsappSlots(tenantId: string): Promise<number> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from("stripe_subscriptions")
    .select("extra_whatsapp_slots")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const legacySlots = Math.max(0, Number(data?.extra_whatsapp_slots ?? 0));

  try {
    const entitlements = await listTenantBillingEntitlements({ tenantId, kind: "whatsapp_line" });
    const entitledSlots = sumTenantEntitlementQuantity(entitlements, "whatsapp_line", "recurring");
    const legacyCounterIsMirrored = entitlements.some((entitlement) =>
      entitlement.kind === "whatsapp_line" &&
      entitlement.billing_mode === "recurring" &&
      entitlement.source === "legacy_backfill",
    );
    // The migration mirrors the old counter once. New legacy webhooks keep that
    // mirror updated, so we never double-count an existing paid line while the
    // entitlement ledger becomes the source of truth.
    return entitledSlots + (legacyCounterIsMirrored ? 0 : legacySlots);
  } catch (error) {
    console.warn("[whatsapp-extra-slots] entitlement_ledger_unavailable", {
      tenant_id: tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return legacySlots;
  }
}

/**
 * Keeps the one-time migration mirror aligned with the established legacy
 * `extra_whatsapp_slots` counter until every tenant has moved to catalog-backed
 * purchases. This is server-only and intentionally does not alter Stripe.
 */
export async function syncLegacyWhatsAppSlotEntitlement(params: {
  tenantId: string;
  quantity: number;
}): Promise<void> {
  const quantity = Math.max(0, Math.floor(params.quantity));
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("tenant_billing_entitlements")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .eq("kind", "whatsapp_line")
    .eq("billing_mode", "recurring")
    .eq("source", "legacy_backfill");
  if (error) throw new Error(`[whatsapp-extra-slots] legacy_mirror_query:${error.message}`);

  const now = new Date().toISOString();
  const rows = (data ?? []) as Array<{ id: string }>;
  if (rows.length === 0) {
    if (quantity === 0) return;
    const { error: insertError } = await sb.from("tenant_billing_entitlements").insert({
      tenant_id: params.tenantId,
      kind: "whatsapp_line",
      billing_mode: "recurring",
      quantity,
      status: "active",
      source: "legacy_backfill",
      metadata: { legacy_extra_whatsapp_slots: quantity },
      updated_at: now,
    });
    if (insertError) throw new Error(`[whatsapp-extra-slots] legacy_mirror_insert:${insertError.message}`);
    return;
  }

  const { error: updateError } = await sb
    .from("tenant_billing_entitlements")
    .update({
      quantity: Math.max(1, quantity),
      status: quantity > 0 ? "active" : "cancelled",
      valid_until: quantity > 0 ? null : now,
      metadata: { legacy_extra_whatsapp_slots: quantity },
      updated_at: now,
    })
    .in("id", rows.map((row) => row.id));
  if (updateError) throw new Error(`[whatsapp-extra-slots] legacy_mirror_update:${updateError.message}`);
}
