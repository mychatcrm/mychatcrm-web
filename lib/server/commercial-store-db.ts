/**
 * Acesso ao armazenamento comercial via Supabase (substitui commercial-store-fs.ts).
 */
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type {
  CommercialAuditEntry,
  CommercialCoupon,
  CommercialPartner,
  CommercialStore,
  CouponExtraCode,
  CouponRedemption,
  RedemptionStatus,
} from "@/lib/commercial/types";

// ── Coupons ────────────────────────────────────────────────────────────────

function dbToCoupon(row: Record<string, unknown>): CommercialCoupon {
  return {
    id: row.id as string,
    code: row.code as string,
    internalName: row.internal_name as string,
    description: row.description as string,
    discountType: row.discount_type as "percent" | "fixed",
    discountValue: Number(row.discount_value),
    validFrom: (row.valid_from as string | null) ?? null,
    validUntil: (row.valid_until as string | null) ?? null,
    maxRedemptionsTotal: (row.max_redemptions_total as number | null) ?? null,
    maxRedemptionsPerUser: (row.max_redemptions_per_user as number | null) ?? null,
    allowedPlanSlugs: (row.allowed_plan_slugs as string[]) ?? [],
    allowedPeriodicities: ((row.allowed_periodicities as string[]) ?? []).filter(
      (p): p is "monthly" | "yearly" => p === "monthly" || p === "yearly",
    ),
    discountRecurrence: row.discount_recurrence as "first_cycle" | "all_cycles",
    recurringCyclesLimit: (row.recurring_cycles_limit as number | null) ?? null,
    active: row.active as boolean,
    partnerId: (row.partner_id as string | null) ?? null,
    stripeCouponId: (row.stripe_coupon_id as string | null) ?? null,
    stripePromoCodeId: (row.stripe_promo_code_id as string | null) ?? null,
    stripeProductIds: (row.stripe_product_ids as string[]) ?? [],
    createPublicCode: (row.create_public_code as boolean) ?? true,
    firstTimeOnly: (row.first_time_only as boolean) ?? false,
    restrictedCustomerEmail: (row.restricted_customer_email as string | null) ?? null,
    minimumAmountCents: (row.minimum_amount_brl as number | null) ?? null,
    minimumAmountCurrency: (row.minimum_amount_currency as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function listCoupons(): Promise<CommercialCoupon[]> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb.from("commercial_coupons").select("*");
  if (error) { console.error("[commercial-store-db] listCoupons:", error.message); return []; }
  return (data ?? []).map(dbToCoupon);
}

export async function getCouponByCode(code: string): Promise<CommercialCoupon | null> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("commercial_coupons")
    .select("*")
    .eq("code", code.toUpperCase().trim())
    .single();
  if (error || !data) return null;
  return dbToCoupon(data);
}

export async function upsertCoupon(coupon: CommercialCoupon): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("commercial_coupons").upsert(
    {
      id: coupon.id,
      code: coupon.code,
      internal_name: coupon.internalName,
      description: coupon.description,
      discount_type: coupon.discountType,
      discount_value: coupon.discountValue,
      valid_from: coupon.validFrom ?? null,
      valid_until: coupon.validUntil ?? null,
      max_redemptions_total: coupon.maxRedemptionsTotal ?? null,
      max_redemptions_per_user: coupon.maxRedemptionsPerUser ?? null,
      allowed_plan_slugs: coupon.allowedPlanSlugs,
      allowed_periodicities: coupon.allowedPeriodicities,
      discount_recurrence: coupon.discountRecurrence,
      recurring_cycles_limit: coupon.recurringCyclesLimit ?? null,
      active: coupon.active,
      partner_id: coupon.partnerId ?? null,
      stripe_coupon_id: coupon.stripeCouponId ?? null,
      stripe_promo_code_id: coupon.stripePromoCodeId ?? null,
      stripe_product_ids: coupon.stripeProductIds,
      create_public_code: coupon.createPublicCode,
      first_time_only: coupon.firstTimeOnly,
      restricted_customer_email: coupon.restrictedCustomerEmail ?? null,
      minimum_amount_brl: coupon.minimumAmountCents ?? null,
      minimum_amount_currency: coupon.minimumAmountCurrency ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(`[commercial-store-db] upsertCoupon: ${error.message}`);
}

export async function deleteCoupon(id: string): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("commercial_coupons").delete().eq("id", id);
  if (error) throw new Error(`[commercial-store-db] deleteCoupon: ${error.message}`);
}

// ── Partners ───────────────────────────────────────────────────────────────

function dbToPartner(row: Record<string, unknown>): CommercialPartner {
  return {
    id: row.id as string,
    name: row.name as string,
    code: row.code as string,
    email: row.email as string,
    socialNotes: row.social_notes as string,
    status: row.status as "active" | "inactive",
    observations: row.observations as string,
    startedAt: row.started_at as string,
    commissionType: row.commission_type as "percent" | "fixed",
    commissionValue: Number(row.commission_value),
    commissionTiming: row.commission_timing as "once" | "recurring",
    commissionRecurrenceMonths: (row.commission_recurrence_months as number | null) ?? null,
    campaignActive: row.campaign_active as boolean,
    linkedCouponIds: (row.linked_coupon_ids as string[]) ?? [],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function listPartners(): Promise<CommercialPartner[]> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb.from("commercial_partners").select("*");
  if (error) { console.error("[commercial-store-db] listPartners:", error.message); return []; }
  return (data ?? []).map(dbToPartner);
}

export async function upsertPartner(partner: CommercialPartner): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("commercial_partners").upsert(
    {
      id: partner.id,
      name: partner.name,
      code: partner.code,
      email: partner.email,
      social_notes: partner.socialNotes,
      status: partner.status,
      observations: partner.observations,
      started_at: partner.startedAt,
      commission_type: partner.commissionType,
      commission_value: partner.commissionValue,
      commission_timing: partner.commissionTiming,
      commission_recurrence_months: partner.commissionRecurrenceMonths ?? null,
      campaign_active: partner.campaignActive,
      linked_coupon_ids: partner.linkedCouponIds,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(`[commercial-store-db] upsertPartner: ${error.message}`);
}

export async function deletePartner(id: string): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("commercial_partners").delete().eq("id", id);
  if (error) throw new Error(`[commercial-store-db] deletePartner: ${error.message}`);
}

// ── Redemptions ───────────────────────────────────────────────────────────

function dbToRedemption(row: Record<string, unknown>): CouponRedemption {
  return {
    id: row.id as string,
    createdAt: row.created_at as string,
    status: row.status as RedemptionStatus,
    idempotencyKey: row.idempotency_key as string,
    couponId: (row.coupon_id as string | null) ?? null,
    codeNormalized: row.code_normalized as string,
    planSlug: row.plan_slug as string,
    emailNormalized: row.email_normalized as string,
    originalCents: row.original_cents as number,
    discountCents: row.discount_cents as number,
    finalCents: row.final_cents as number,
    partnerId: (row.partner_id as string | null) ?? null,
    commissionCents: (row.commission_cents as number) ?? 0,
  };
}

export async function listRedemptions(): Promise<CouponRedemption[]> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb.from("coupon_redemptions").select("*");
  if (error) { console.error("[commercial-store-db] listRedemptions:", error.message); return []; }
  return (data ?? []).map(dbToRedemption);
}

export async function countRedemptionsByCoupon(couponId: string): Promise<number> {
  const sb = createSupabaseServiceClient();
  const { count, error } = await sb
    .from("coupon_redemptions")
    .select("id", { count: "exact", head: true })
    .eq("coupon_id", couponId)
    .in("status", ["committed", "confirmed"]);
  if (error) return 0;
  return count ?? 0;
}

export async function countRedemptionsByEmail(
  couponId: string,
  emailNormalized: string,
): Promise<number> {
  const sb = createSupabaseServiceClient();
  const { count, error } = await sb
    .from("coupon_redemptions")
    .select("id", { count: "exact", head: true })
    .eq("coupon_id", couponId)
    .eq("email_normalized", emailNormalized)
    .in("status", ["committed", "confirmed"]);
  if (error) return 0;
  return count ?? 0;
}

export async function insertRedemption(redemption: CouponRedemption): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("coupon_redemptions").insert({
    id: redemption.id,
    idempotency_key: redemption.idempotencyKey,
    coupon_id: redemption.couponId,
    code_normalized: redemption.codeNormalized,
    plan_slug: redemption.planSlug,
    email_normalized: redemption.emailNormalized,
    original_cents: redemption.originalCents,
    discount_cents: redemption.discountCents,
    final_cents: redemption.finalCents,
    partner_id: redemption.partnerId ?? null,
    commission_cents: redemption.commissionCents,
    status: redemption.status,
  });
  if (error) throw new Error(`[commercial-store-db] insertRedemption: ${error.message}`);
}

export async function updateRedemptionStatus(id: string, status: RedemptionStatus): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("coupon_redemptions").update({ status }).eq("id", id);
  if (error) console.warn("[commercial-store-db] updateRedemptionStatus:", error.message);
}

export async function deleteRedemption(id: string): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("coupon_redemptions").delete().eq("id", id);
  if (error) throw new Error(`[commercial-store-db] deleteRedemption: ${error.message}`);
}

export async function findCommittedRedemptionByCouponAndEmail(
  couponId: string,
  emailNormalized: string,
): Promise<{ id: string } | null> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("coupon_redemptions")
    .select("id")
    .eq("coupon_id", couponId)
    .eq("email_normalized", emailNormalized)
    .eq("status", "committed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data ? { id: data.id as string } : null;
}

// ── Extra Codes ──────────────────────────────────────────────────────────

function dbToExtraCode(row: Record<string, unknown>): CouponExtraCode {
  return {
    id: row.id as string,
    couponId: row.coupon_id as string,
    code: row.code as string,
    stripePromoCodeId: (row.stripe_promo_code_id as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

export async function listAllExtraCodes(): Promise<CouponExtraCode[]> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb.from("coupon_extra_codes").select("*");
  if (error) { console.error("[commercial-store-db] listAllExtraCodes:", error.message); return []; }
  return (data ?? []).map(dbToExtraCode);
}

export async function insertExtraCode(e: CouponExtraCode): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("coupon_extra_codes").insert({
    id: e.id,
    coupon_id: e.couponId,
    code: e.code,
    stripe_promo_code_id: e.stripePromoCodeId ?? null,
  });
  if (error) throw new Error(`[commercial-store-db] insertExtraCode: ${error.message}`);
}

// ── Audit Log ─────────────────────────────────────────────────────────────

export async function appendAuditEntry(entry: CommercialAuditEntry): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("commercial_audit_log").insert({
    id: entry.id,
    admin_id: entry.adminId,
    admin_email: entry.adminEmail,
    action: entry.action,
    detail: entry.detail,
    created_at: entry.createdAt,
  });
  if (error) throw new Error(`[commercial-store-db] appendAuditEntry: ${error.message}`);
}

// ── Store snapshot ────────────────────────────────────────────────────────

/** Constrói um CommercialStore em memória a partir dos dados do banco. */
export async function buildCommercialStoreFromDb(): Promise<CommercialStore> {
  const [coupons, partners, redemptions, extraCodes] = await Promise.all([
    listCoupons(),
    listPartners(),
    listRedemptions(),
    listAllExtraCodes(),
  ]);
  return { version: 1, coupons, partners, redemptions, extraCodes, auditLog: [] };
}

/** Persiste múltiplos cupons modificados (após sync-links). */
export async function persistModifiedCoupons(modified: CommercialCoupon[]): Promise<void> {
  await Promise.all(modified.map(upsertCoupon));
}

/** Persiste múltiplos parceiros modificados (após sync-links). */
export async function persistModifiedPartners(modified: CommercialPartner[]): Promise<void> {
  await Promise.all(modified.map(upsertPartner));
}

export async function listAuditLog(): Promise<CommercialAuditEntry[]> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("commercial_audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) { console.error("[commercial-store-db] listAuditLog:", error.message); return []; }
  return (data ?? []).map((row) => ({
    id: row.id as string,
    createdAt: row.created_at as string,
    adminId: row.admin_id as string,
    adminEmail: row.admin_email as string,
    action: row.action as string,
    detail: row.detail as string,
  }));
}
