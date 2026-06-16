import type { CommercialCoupon } from "@/lib/commercial/types";
import { getStripe } from "@/lib/stripe";
import { upsertCoupon } from "@/lib/server/commercial-store-db";

export type SyncCouponStripeResult =
  | { ok: true; coupon: CommercialCoupon; created: boolean }
  | { ok: false; error: string };

/** Cria Coupon + PromotionCode no Stripe para cupons ativos sem sync. */
export async function syncCouponToStripe(coupon: CommercialCoupon): Promise<SyncCouponStripeResult> {
  if (!coupon.active) {
    return { ok: false, error: "Cupom inativo." };
  }
  if (!coupon.createPublicCode) {
    return { ok: false, error: "Cupom configurado como interno (sem código público no Stripe)." };
  }
  if (coupon.stripeCouponId && coupon.stripePromoCodeId) {
    return { ok: true, coupon, created: false };
  }

  try {
    const stripe = getStripe();
    const durationMap = {
      first_cycle: "once",
      all_cycles: coupon.recurringCyclesLimit ? "repeating" : "forever",
    } as const;
    const duration = durationMap[coupon.discountRecurrence];

    let stripeCouponId = coupon.stripeCouponId;
    if (!stripeCouponId) {
      const stripeCoupon = await stripe.coupons.create({
        name: coupon.internalName,
        duration,
        ...(duration === "repeating" && coupon.recurringCyclesLimit
          ? { duration_in_months: coupon.recurringCyclesLimit }
          : {}),
        ...(coupon.discountType === "percent"
          ? { percent_off: coupon.discountValue }
          : { amount_off: coupon.discountValue, currency: "brl" }),
        ...(coupon.maxRedemptionsTotal ? { max_redemptions: coupon.maxRedemptionsTotal } : {}),
        ...(coupon.validUntil
          ? { redeem_by: Math.floor(new Date(coupon.validUntil).getTime() / 1000) }
          : {}),
        ...(coupon.stripeProductIds.length > 0
          ? { applies_to: { products: coupon.stripeProductIds } }
          : {}),
      });
      stripeCouponId = stripeCoupon.id;
    }

    let stripePromoCodeId = coupon.stripePromoCodeId;
    if (!stripePromoCodeId) {
      let stripeCustomerId: string | undefined;
      if (coupon.restrictedCustomerEmail) {
        const customers = await stripe.customers.list({
          email: coupon.restrictedCustomerEmail,
          limit: 1,
        });
        if (!customers.data.length) {
          return {
            ok: false,
            error: `Cliente "${coupon.restrictedCustomerEmail}" não encontrado no Stripe.`,
          };
        }
        stripeCustomerId = customers.data[0].id;
      }

      const promoRestrictions: {
        first_time_transaction?: boolean;
        minimum_amount?: number;
        minimum_amount_currency?: string;
      } = {};
      if (coupon.firstTimeOnly) promoRestrictions.first_time_transaction = true;
      if (coupon.minimumAmountBrl) {
        promoRestrictions.minimum_amount = coupon.minimumAmountBrl;
        promoRestrictions.minimum_amount_currency = "brl";
      }

      const promoCode = await stripe.promotionCodes.create({
        promotion: { type: "coupon", coupon: stripeCouponId },
        code: coupon.code,
        active: true,
        ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
        ...(Object.keys(promoRestrictions).length > 0 ? { restrictions: promoRestrictions } : {}),
      });
      stripePromoCodeId = promoCode.id;
    }

    const updated: CommercialCoupon = {
      ...coupon,
      stripeCouponId,
      stripePromoCodeId,
    };
    await upsertCoupon(updated);

    return { ok: true, coupon: updated, created: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Falha ao sincronizar com o Stripe.";
    return { ok: false, error: msg };
  }
}
