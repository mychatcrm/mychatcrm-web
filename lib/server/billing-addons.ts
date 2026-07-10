import "server-only";

import type Stripe from "stripe";
import { SITE_URL } from "@/lib/constants";
import { getStripe } from "@/lib/stripe";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type BillingAddonKind = "lead_capacity" | "whatsapp_line";
export type BillingAddonMode = "recurring" | "one_time";

export type BillingAddonCatalogItem = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  kind: BillingAddonKind;
  billing_mode: BillingAddonMode;
  included_quantity: number;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  currency: string;
  amount_cents: number | null;
  interval_unit: "month" | "year" | null;
  active: boolean;
  metadata: Record<string, unknown>;
};

export type TenantBillingEntitlement = {
  id: string;
  tenant_id: string;
  addon_catalog_id: string | null;
  kind: BillingAddonKind;
  billing_mode: BillingAddonMode;
  quantity: number;
  status: "active" | "scheduled_cancel" | "cancelled" | "expired" | "revoked";
  valid_from: string;
  valid_until: string | null;
  stripe_checkout_session_id: string | null;
  stripe_subscription_id: string | null;
  stripe_subscription_item_id: string | null;
  stripe_invoice_id: string | null;
  source: "stripe" | "legacy_backfill" | "admin_grant";
  metadata: Record<string, unknown>;
};

export type PublicBillingAddon = Pick<
  BillingAddonCatalogItem,
  "id" | "code" | "title" | "description" | "kind" | "billing_mode" | "included_quantity" | "currency" | "amount_cents" | "interval_unit"
>;

export type BillingAddonCheckoutResult = {
  url: string;
  checkoutSessionId: string;
  catalog: BillingAddonCatalogItem;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseCatalog(row: Record<string, unknown>): BillingAddonCatalogItem {
  return {
    id: String(row.id),
    code: String(row.code),
    title: String(row.title),
    description: typeof row.description === "string" ? row.description : null,
    kind: row.kind === "whatsapp_line" ? "whatsapp_line" : "lead_capacity",
    billing_mode: row.billing_mode === "one_time" ? "one_time" : "recurring",
    included_quantity: Math.max(1, Number(row.included_quantity ?? 1)),
    stripe_product_id: typeof row.stripe_product_id === "string" ? row.stripe_product_id : null,
    stripe_price_id: typeof row.stripe_price_id === "string" ? row.stripe_price_id : null,
    currency: typeof row.currency === "string" ? row.currency : "brl",
    amount_cents: typeof row.amount_cents === "number" ? row.amount_cents : null,
    interval_unit: row.interval_unit === "year" || row.interval_unit === "month" ? row.interval_unit : null,
    active: row.active === true,
    metadata: asRecord(row.metadata),
  };
}

function parseEntitlement(row: Record<string, unknown>): TenantBillingEntitlement {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    addon_catalog_id: typeof row.addon_catalog_id === "string" ? row.addon_catalog_id : null,
    kind: row.kind === "whatsapp_line" ? "whatsapp_line" : "lead_capacity",
    billing_mode: row.billing_mode === "one_time" ? "one_time" : "recurring",
    quantity: Math.max(1, Number(row.quantity ?? 1)),
    status: ["active", "scheduled_cancel", "cancelled", "expired", "revoked"].includes(String(row.status))
      ? (row.status as TenantBillingEntitlement["status"])
      : "active",
    valid_from: String(row.valid_from),
    valid_until: typeof row.valid_until === "string" ? row.valid_until : null,
    stripe_checkout_session_id:
      typeof row.stripe_checkout_session_id === "string" ? row.stripe_checkout_session_id : null,
    stripe_subscription_id: typeof row.stripe_subscription_id === "string" ? row.stripe_subscription_id : null,
    stripe_subscription_item_id:
      typeof row.stripe_subscription_item_id === "string" ? row.stripe_subscription_item_id : null,
    stripe_invoice_id: typeof row.stripe_invoice_id === "string" ? row.stripe_invoice_id : null,
    source: ["stripe", "legacy_backfill", "admin_grant"].includes(String(row.source))
      ? (row.source as TenantBillingEntitlement["source"])
      : "stripe",
    metadata: asRecord(row.metadata),
  };
}

export async function listActiveBillingAddons(kind?: BillingAddonKind): Promise<BillingAddonCatalogItem[]> {
  const sb = createSupabaseServiceClient();
  let query = sb.from("billing_addon_catalog").select("*").eq("active", true).order("created_at", { ascending: true });
  if (kind) query = query.eq("kind", kind);
  const { data, error } = await query;
  if (error) throw new Error(`[billing-addons] list_catalog:${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map(parseCatalog);
}

/** Admin-only catalogue read. Unlike the public checkout list, this includes inactive drafts. */
export async function listBillingAddonCatalog(): Promise<BillingAddonCatalogItem[]> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb.from("billing_addon_catalog").select("*").order("created_at", { ascending: true });
  if (error) throw new Error(`[billing-addons] list_catalog_admin:${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map(parseCatalog);
}

export function toPublicBillingAddon(item: BillingAddonCatalogItem): PublicBillingAddon {
  return {
    id: item.id,
    code: item.code,
    title: item.title,
    description: item.description,
    kind: item.kind,
    billing_mode: item.billing_mode,
    included_quantity: item.included_quantity,
    currency: item.currency,
    amount_cents: item.amount_cents,
    interval_unit: item.interval_unit,
  };
}

export async function getBillingAddonByCode(code: string): Promise<BillingAddonCatalogItem | null> {
  const normalized = code.trim().toLowerCase();
  if (!normalized) return null;
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("billing_addon_catalog")
    .select("*")
    .eq("code", normalized)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(`[billing-addons] get_catalog:${error.message}`);
  return data ? parseCatalog(data as Record<string, unknown>) : null;
}

export async function getBillingAddonById(id: string): Promise<BillingAddonCatalogItem | null> {
  if (!id.trim()) return null;
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb.from("billing_addon_catalog").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`[billing-addons] get_catalog_id:${error.message}`);
  return data ? parseCatalog(data as Record<string, unknown>) : null;
}

function asStripeId(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function productIdOfPrice(price: Stripe.Price): string | null {
  return typeof price.product === "string" ? price.product : price.product?.id ?? null;
}

/**
 * Creates a tenant-scoped Stripe Checkout Session for a configured add-on.
 * No price is accepted from the browser: the catalog remains the only source
 * of price/product mappings.
 */
export async function createBillingAddonCheckout(params: {
  tenantId: string;
  addonCode: string;
  quantity: number;
  successPath: string;
  cancelPath: string;
}): Promise<BillingAddonCheckoutResult> {
  if (!Number.isInteger(params.quantity) || params.quantity < 1 || params.quantity > 100) {
    throw new Error("billing_addon_invalid_quantity");
  }
  const catalog = await getBillingAddonByCode(params.addonCode);
  if (!catalog || !catalog.active) throw new Error("billing_addon_not_available");
  const stripePriceId = asStripeId(catalog.stripe_price_id);
  if (!stripePriceId) throw new Error("billing_addon_price_not_configured");

  const stripe = getStripe();
  const price = await stripe.prices.retrieve(stripePriceId);
  if (!price.active) throw new Error("billing_addon_price_inactive");
  if (catalog.stripe_product_id && productIdOfPrice(price) !== catalog.stripe_product_id) {
    throw new Error("billing_addon_price_product_mismatch");
  }
  const isRecurringPrice = Boolean(price.recurring);
  if ((catalog.billing_mode === "recurring") !== isRecurringPrice) {
    throw new Error("billing_addon_price_mode_mismatch");
  }

  const sb = createSupabaseServiceClient();
  const { data: subscription, error: subscriptionError } = await sb
    .from("stripe_subscriptions")
    .select("customer_id")
    .eq("tenant_id", params.tenantId)
    .maybeSingle();
  if (subscriptionError) throw new Error(`[billing-addons] customer_lookup:${subscriptionError.message}`);

  const metadata = {
    type: "billing_addon",
    tenant_id: params.tenantId,
    addon_catalog_id: catalog.id,
    addon_code: catalog.code,
    addon_kind: catalog.kind,
    addon_mode: catalog.billing_mode,
    quantity: String(params.quantity),
  };
  const customerId = typeof subscription?.customer_id === "string" ? subscription.customer_id : null;
  const successPath = params.successPath.startsWith("/") ? params.successPath : `/${params.successPath}`;
  const cancelPath = params.cancelPath.startsWith("/") ? params.cancelPath : `/${params.cancelPath}`;
  const checkoutSession = await stripe.checkout.sessions.create({
    mode: catalog.billing_mode === "recurring" ? "subscription" : "payment",
    payment_method_types: ["card"],
    ...(customerId ? { customer: customerId } : {}),
    line_items: [{ price: stripePriceId, quantity: params.quantity }],
    metadata,
    ...(catalog.billing_mode === "recurring" ? { subscription_data: { metadata } } : {}),
    success_url: `${SITE_URL}${successPath}${successPath.includes("?") ? "&" : "?"}addon=success`,
    cancel_url: `${SITE_URL}${cancelPath}${cancelPath.includes("?") ? "&" : "?"}addon=cancelled`,
  });
  if (!checkoutSession.url) throw new Error("billing_addon_checkout_url_missing");
  return { url: checkoutSession.url, checkoutSessionId: checkoutSession.id, catalog };
}

function subscriptionPeriodEnd(subscription: Stripe.Subscription | null | undefined): number | null {
  const candidate = subscription as (Stripe.Subscription & { current_period_end?: number }) | null | undefined;
  return typeof candidate?.current_period_end === "number" ? candidate.current_period_end : null;
}

export async function listTenantBillingEntitlements(params: {
  tenantId: string;
  kind?: BillingAddonKind;
  now?: Date;
}): Promise<TenantBillingEntitlement[]> {
  const sb = createSupabaseServiceClient();
  let query = sb.from("tenant_billing_entitlements").select("*").eq("tenant_id", params.tenantId);
  if (params.kind) query = query.eq("kind", params.kind);
  const { data, error } = await query;
  if (error) throw new Error(`[billing-addons] list_entitlements:${error.message}`);
  const now = params.now?.getTime() ?? Date.now();
  return ((data ?? []) as Array<Record<string, unknown>>)
    .map(parseEntitlement)
    .filter((row) => ["active", "scheduled_cancel"].includes(row.status))
    .filter((row) => Date.parse(row.valid_from) <= now)
    .filter((row) => !row.valid_until || Date.parse(row.valid_until) >= now);
}

export function sumTenantEntitlementQuantity(
  rows: TenantBillingEntitlement[],
  kind: BillingAddonKind,
  billingMode?: BillingAddonMode,
): number {
  return rows
    .filter((row) => row.kind === kind && (!billingMode || row.billing_mode === billingMode))
    .reduce((total, row) => total + Math.max(0, row.quantity), 0);
}

export function effectiveAddonQuantity(includedQuantity: number, purchasedUnits: number): number {
  const included = Math.max(1, Math.floor(includedQuantity));
  const units = Math.max(1, Math.floor(purchasedUnits));
  return included * units;
}

function subscriptionId(value: Stripe.Checkout.Session["subscription"]): string | null {
  if (typeof value === "string") return value;
  return value?.id ?? null;
}

/**
 * Stripe webhook fulfillment. The checkout-session unique key makes delivery
 * retries safe; a webhook can run any number of times without duplicating a
 * tenant entitlement.
 */
export async function fulfillBillingAddonFromCheckout(params: {
  session: Stripe.Checkout.Session;
  subscription?: Stripe.Subscription | null;
  oneTimeValidUntil?: string | null;
}): Promise<boolean> {
  const tenantId = params.session.metadata?.tenant_id?.trim();
  const catalogId = params.session.metadata?.addon_catalog_id?.trim();
  const purchasedUnits = Number(params.session.metadata?.quantity ?? 1);
  if (!tenantId || !catalogId || !Number.isInteger(purchasedUnits) || purchasedUnits < 1) return false;

  const catalog = await getBillingAddonById(catalogId);
  if (!catalog) {
    console.warn("[billing-addons] checkout references missing catalog item", {
      checkout_session_id: params.session.id,
      addon_catalog_id: catalogId,
    });
    return false;
  }

  const subscription = params.subscription ?? null;
  const item = subscription?.items.data.find((candidate) => candidate.price.id === catalog.stripe_price_id) ?? null;
  const effectiveQuantity = effectiveAddonQuantity(catalog.included_quantity, purchasedUnits);
  const validUntil =
    catalog.billing_mode === "one_time"
      ? params.oneTimeValidUntil ?? null
      : subscriptionPeriodEnd(subscription)
        ? new Date(subscriptionPeriodEnd(subscription)! * 1000).toISOString()
        : null;
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("tenant_billing_entitlements").upsert(
    {
      tenant_id: tenantId,
      addon_catalog_id: catalog.id,
      kind: catalog.kind,
      billing_mode: catalog.billing_mode,
      quantity: effectiveQuantity,
      status: "active",
      valid_from: new Date().toISOString(),
      valid_until: validUntil,
      stripe_checkout_session_id: params.session.id,
      stripe_subscription_id: subscriptionId(params.session.subscription),
      stripe_subscription_item_id: item?.id ?? null,
      stripe_invoice_id: typeof params.session.invoice === "string" ? params.session.invoice : params.session.invoice?.id ?? null,
      source: "stripe",
      metadata: {
        addon_code: catalog.code,
        stripe_price_id: catalog.stripe_price_id,
        checkout_mode: params.session.mode,
        purchased_units: purchasedUnits,
        included_quantity: catalog.included_quantity,
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_checkout_session_id" },
  );
  if (error) throw new Error(`[billing-addons] fulfill_checkout:${error.message}`);
  return true;
}

/** Keep add-on access through an already paid period when cancellation is scheduled. */
export async function syncBillingAddonSubscription(params: {
  subscription: Stripe.Subscription;
  terminal?: boolean;
}): Promise<void> {
  const subscriptionId = params.subscription.id;
  const isTerminal = params.terminal === true || params.subscription.status === "canceled";
  const status = isTerminal ? "cancelled" : params.subscription.cancel_at_period_end ? "scheduled_cancel" : "active";
  const validUntil =
    isTerminal
      ? new Date().toISOString()
      : subscriptionPeriodEnd(params.subscription)
        ? new Date(subscriptionPeriodEnd(params.subscription)! * 1000).toISOString()
        : null;
  const sb = createSupabaseServiceClient();
  const { data: entitlementRows, error: entitlementError } = await sb
    .from("tenant_billing_entitlements")
    .select("id, addon_catalog_id, stripe_subscription_item_id, metadata")
    .eq("stripe_subscription_id", subscriptionId);
  if (entitlementError) {
    throw new Error(`[billing-addons] sync_subscription_lookup:${entitlementError.message}`);
  }

  const quantityByEntitlement = new Map<string, { quantity: number; metadata: Record<string, unknown> }>();
  for (const row of (entitlementRows ?? []) as Array<Record<string, unknown>>) {
    const catalogId = typeof row.addon_catalog_id === "string" ? row.addon_catalog_id : null;
    if (!catalogId) continue;
    const catalog = await getBillingAddonById(catalogId);
    if (!catalog) continue;
    const storedItemId =
      typeof row.stripe_subscription_item_id === "string" ? row.stripe_subscription_item_id : null;
    const item =
      params.subscription.items.data.find((candidate) => candidate.id === storedItemId) ??
      params.subscription.items.data.find((candidate) => candidate.price.id === catalog.stripe_price_id) ??
      null;
    const rowMetadata = asRecord(row.metadata);
    const fallbackUnits = Number(rowMetadata.purchased_units ?? 1);
    const purchasedUnits = Math.max(
      1,
      Math.floor(
        typeof item?.quantity === "number" && item.quantity > 0
          ? item.quantity
          : Number.isFinite(fallbackUnits) && fallbackUnits > 0
            ? fallbackUnits
            : 1,
      ),
    );
    quantityByEntitlement.set(String(row.id), {
      quantity: effectiveAddonQuantity(catalog.included_quantity, purchasedUnits),
      metadata: {
        ...rowMetadata,
        purchased_units: purchasedUnits,
        included_quantity: catalog.included_quantity,
      },
    });
  }

  const { error } = await sb
    .from("tenant_billing_entitlements")
    .update({ status, valid_until: validUntil, updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", subscriptionId);
  if (error) throw new Error(`[billing-addons] sync_subscription:${error.message}`);

  for (const [entitlementId, update] of quantityByEntitlement) {
    const { error: quantityError } = await sb
      .from("tenant_billing_entitlements")
      .update({
        quantity: update.quantity,
        metadata: update.metadata,
        updated_at: new Date().toISOString(),
      })
      .eq("id", entitlementId)
      .eq("stripe_subscription_id", subscriptionId);
    if (quantityError) {
      throw new Error(`[billing-addons] sync_subscription_quantity:${quantityError.message}`);
    }
  }
}
