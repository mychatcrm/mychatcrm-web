import {
  brlToCents,
  computeCommissionCents,
  findPartner,
  findRedemptionByIdempotencyKey,
  normalizeCouponCode,
  validateCouponForCheckout,
} from "@/lib/commercial/engine";
import { resolveCheckoutPeriodicity } from "@/lib/commercial/coupon-periodicity";
import type { CommercialStore, CouponExtraCode, CouponValidateResult } from "@/lib/commercial/types";
import type { PlanBillingCycle } from "@/lib/plans";
import { planCheckoutChargeBaseBRL, SALES_PLANS } from "@/lib/plans";
import {
  appendAuditEntry,
  buildCommercialStoreFromDb,
  insertRedemption,
} from "@/lib/server/commercial-store-db";
import { randomUUID } from "crypto";

export type ResolvedCheckoutCoupon = Extract<CouponValidateResult, { ok: true }> & {
  stripePromoCodeId: string | null;
  normalizedCode: string;
  extraCodeMatch: CouponExtraCode | null;
};

export type ResolveCheckoutCouponParams = {
  store: CommercialStore;
  codeRaw: string;
  planSlug: string;
  billingCycle: PlanBillingCycle;
  emailRaw?: string | null;
};

/** Resolve extra code → valida cupom → retorna promo Stripe. */
export function resolveCheckoutCoupon(
  params: ResolveCheckoutCouponParams,
): Extract<CouponValidateResult, { ok: false }> | ResolvedCheckoutCoupon {
  const { store, codeRaw, planSlug, billingCycle } = params;

  const plan = SALES_PLANS.find((p) => p.slug === planSlug);
  if (!plan || plan.priceMonthly === null) {
    return { ok: false, code: "PLAN_NOT_CHECKOUT", message: "Plano sem checkout." };
  }

  const checkoutPeriodicity = resolveCheckoutPeriodicity(billingCycle, planSlug);
  const originalCents = brlToCents(planCheckoutChargeBaseBRL(plan.priceMonthly, billingCycle));

  const normalizedCode = normalizeCouponCode(codeRaw);
  const extraCodeMatch = store.extraCodes.find((e) => e.code === normalizedCode) ?? null;
  const effectiveCode = extraCodeMatch
    ? store.coupons.find((c) => c.id === extraCodeMatch.couponId)?.code ?? codeRaw
    : codeRaw;

  const result = validateCouponForCheckout({
    store,
    codeRaw: effectiveCode,
    planSlug,
    originalCents,
    emailRaw: params.emailRaw,
    checkoutPeriodicity,
  });

  if (!result.ok) return result;

  const coupon = store.coupons.find((c) => c.id === result.couponId);
  const stripePromoCodeId = extraCodeMatch?.stripePromoCodeId ?? coupon?.stripePromoCodeId ?? null;

  return {
    ...result,
    stripePromoCodeId,
    normalizedCode,
    extraCodeMatch,
  };
}

export type CommitCheckoutCouponParams = {
  store?: CommercialStore;
  codeRaw: string;
  planSlug: string;
  billingCycle: PlanBillingCycle;
  email: string;
  idempotencyKey: string;
};

export type CommitCheckoutCouponResult =
  | { ok: true; idempotent: boolean; redemptionId: string; finalCents: number; discountCents: number; commissionCents: number }
  | { ok: false; code: string; message: string };

/** Valida e grava redemption committed (idempotente). */
export async function commitCheckoutCoupon(params: CommitCheckoutCouponParams): Promise<CommitCheckoutCouponResult> {
  const store = params.store ?? (await buildCommercialStoreFromDb());
  const idempotencyKey = params.idempotencyKey.trim();
  const email = params.email.trim();

  if (!idempotencyKey) {
    return { ok: false, code: "BAD_REQUEST", message: "Chave de idempotência ausente." };
  }

  const existing = findRedemptionByIdempotencyKey(store, idempotencyKey);
  if (existing && (existing.status === "committed" || existing.status === "confirmed")) {
    return {
      ok: true,
      idempotent: true,
      redemptionId: existing.id,
      finalCents: existing.finalCents,
      discountCents: existing.discountCents,
      commissionCents: existing.commissionCents,
    };
  }

  const resolved = resolveCheckoutCoupon({
    store,
    codeRaw: params.codeRaw,
    planSlug: params.planSlug,
    billingCycle: params.billingCycle,
    emailRaw: email,
  });

  if (!resolved.ok) {
    return { ok: false, code: resolved.code, message: resolved.message };
  }

  const coupon = store.coupons.find((c) => c.id === resolved.couponId);
  if (!coupon) {
    return { ok: false, code: "COUPON_INVALID", message: "Cupom não encontrado." };
  }

  const partner = findPartner(store, resolved.partnerId);
  const commissionCents = computeCommissionCents(partner, resolved.finalCents, resolved.discountCents);

  const redemption = {
    id: `red_${randomUUID()}`,
    createdAt: new Date().toISOString(),
    status: "committed" as const,
    idempotencyKey,
    couponId: coupon.id,
    codeNormalized: resolved.normalizedCode,
    planSlug: params.planSlug,
    emailNormalized: email.toLowerCase(),
    originalCents: resolved.originalCents,
    discountCents: resolved.discountCents,
    finalCents: resolved.finalCents,
    partnerId: resolved.partnerId,
    commissionCents,
  };

  await insertRedemption(redemption);
  await appendAuditEntry({
    id: `aud_${randomUUID()}`,
    createdAt: new Date().toISOString(),
    adminId: "checkout-system",
    adminEmail: "checkout@system",
    action: "coupon_commit",
    detail: JSON.stringify({ couponId: coupon.id, planSlug: params.planSlug, email: redemption.emailNormalized }),
  });

  return {
    ok: true,
    idempotent: false,
    redemptionId: redemption.id,
    finalCents: resolved.finalCents,
    discountCents: resolved.discountCents,
    commissionCents,
  };
}

/** Encontra cupom pelo promo code Stripe (principal ou extra code). */
export function findCouponByStripePromoCodeId(store: CommercialStore, promoCodeId: string) {
  const byMain = store.coupons.find((c) => c.stripePromoCodeId === promoCodeId);
  if (byMain) return byMain;
  const extra = store.extraCodes.find((e) => e.stripePromoCodeId === promoCodeId);
  if (!extra) return null;
  return store.coupons.find((c) => c.id === extra.couponId) ?? null;
}
