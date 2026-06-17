import type { CommercialCoupon } from "@/lib/commercial/types";
import { findOrCreateStripeCustomer } from "@/lib/server/create-coupon";
import {
  buildPromotionCodeCreateParams,
  buildStripeCouponCreateParams,
  mergeMainPromoOptions,
} from "@/lib/server/stripe-coupon-mapping";
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

    let stripeCouponId = coupon.stripeCouponId;
    if (!stripeCouponId) {
      const stripeCoupon = await stripe.coupons.create(buildStripeCouponCreateParams(coupon));
      stripeCouponId = stripeCoupon.id;
    }

    let stripePromoCodeId = coupon.stripePromoCodeId;
    if (!stripePromoCodeId) {
      let stripeCustomerId: string | undefined;
      if (coupon.restrictedCustomerEmail) {
        stripeCustomerId = await findOrCreateStripeCustomer(coupon.restrictedCustomerEmail);
      }

      const promoParams = buildPromotionCodeCreateParams(
        stripeCouponId,
        coupon.code,
        mergeMainPromoOptions(coupon),
      );
      const promoCode = await stripe.promotionCodes.create({
        ...promoParams,
        ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
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
