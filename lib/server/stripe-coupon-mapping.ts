import type Stripe from "stripe";
import type { CommercialCoupon } from "@/lib/commercial/types";

export type PromoCodeCreateOptions = {
  promoMaxRedemptions?: number | null;
  promoExpiresAt?: string | null;
  firstTimeOnly?: boolean;
  restrictedCustomerEmail?: string | null;
  minimumAmountCents?: number | null;
  minimumAmountCurrency?: string | null;
  /** @deprecated use minimumAmountCents */
  minimumAmountBrl?: number | null;
};

export function durationFromCoupon(coupon: CommercialCoupon): {
  duration: "once" | "repeating" | "forever";
  duration_in_months?: number;
} {
  if (coupon.discountRecurrence === "first_cycle") {
    return { duration: "once" };
  }
  if (coupon.recurringCyclesLimit != null) {
    return { duration: "repeating", duration_in_months: coupon.recurringCyclesLimit };
  }
  return { duration: "forever" };
}

/** Parâmetros Stripe Coupon — espelha o formulário admin (nível cupom). */
export function buildStripeCouponCreateParams(coupon: CommercialCoupon): Stripe.CouponCreateParams {
  const { duration, duration_in_months } = durationFromCoupon(coupon);
  return {
    name: coupon.internalName,
    duration,
    ...(duration === "repeating" && duration_in_months ? { duration_in_months } : {}),
    ...(coupon.discountType === "percent"
      ? { percent_off: coupon.discountValue }
      : { amount_off: coupon.discountValue, currency: "brl" }),
    ...(coupon.maxRedemptionsTotal != null && coupon.maxRedemptionsTotal > 0
      ? { max_redemptions: coupon.maxRedemptionsTotal }
      : {}),
    ...(coupon.validUntil
      ? { redeem_by: Math.floor(new Date(coupon.validUntil).getTime() / 1000) }
      : {}),
    ...(coupon.stripeProductIds.length > 0
      ? { applies_to: { products: coupon.stripeProductIds } }
      : {}),
  };
}

export function buildPromoRestrictionsFromOptions(options: {
  firstTimeOnly?: boolean;
  minimumAmountCents?: number | null;
  minimumAmountCurrency?: string | null;
  minimumAmountBrl?: number | null;
}): Stripe.PromotionCodeCreateParams["restrictions"] {
  const restrictions: NonNullable<Stripe.PromotionCodeCreateParams["restrictions"]> = {};
  if (options.firstTimeOnly) restrictions.first_time_transaction = true;
  const minimumCents = options.minimumAmountCents ?? options.minimumAmountBrl;
  if (minimumCents != null && minimumCents > 0) {
    restrictions.minimum_amount = minimumCents;
    restrictions.minimum_amount_currency = (options.minimumAmountCurrency ?? "brl").toLowerCase();
  }
  return Object.keys(restrictions).length > 0 ? restrictions : undefined;
}

/** Parâmetros Stripe Promotion Code — espelha cada bloco de código no formulário. */
export function buildPromotionCodeCreateParams(
  stripeCouponId: string,
  code: string,
  options: PromoCodeCreateOptions & { active?: boolean },
): Stripe.PromotionCodeCreateParams {
  const restrictions = buildPromoRestrictionsFromOptions(options);
  const expiresAt = options.promoExpiresAt
    ? Math.floor(new Date(options.promoExpiresAt).getTime() / 1000)
    : undefined;

  return {
    promotion: { type: "coupon", coupon: stripeCouponId },
    active: options.active !== false,
    code,
    ...(expiresAt ? { expires_at: expiresAt } : {}),
    ...(options.promoMaxRedemptions != null && options.promoMaxRedemptions > 0
      ? { max_redemptions: options.promoMaxRedemptions }
      : {}),
    ...(restrictions ? { restrictions } : {}),
  };
}

/** Mescla campos do cupom + opções do bloco principal para a promo principal. */
export function mergeMainPromoOptions(
  coupon: CommercialCoupon,
  promoOptions?: PromoCodeCreateOptions,
): PromoCodeCreateOptions & { active?: boolean } {
  return {
    firstTimeOnly: coupon.firstTimeOnly,
    minimumAmountCents: coupon.minimumAmountCents,
    minimumAmountCurrency: coupon.minimumAmountCurrency,
    restrictedCustomerEmail: coupon.restrictedCustomerEmail,
    promoMaxRedemptions: promoOptions?.promoMaxRedemptions ?? coupon.promoMaxRedemptions,
    promoExpiresAt: promoOptions?.promoExpiresAt ?? coupon.promoExpiresAt,
    active: coupon.active,
  };
}
