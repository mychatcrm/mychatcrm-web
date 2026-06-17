import type Stripe from "stripe";
import type { CommercialCoupon, CommercialStore, CouponExtraCode } from "@/lib/commercial/types";
import { normalizeCouponCode } from "@/lib/commercial/engine";
import {
  deleteCoupon,
  insertExtraCode,
  upsertCoupon,
} from "@/lib/server/commercial-store-db";
import { getStripe } from "@/lib/stripe";
import { randomUUID } from "crypto";

export type CreateCouponResult =
  | { ok: true; coupon: CommercialCoupon; extraCodes: CouponExtraCode[] }
  | { ok: false; error: string; status: 400 | 409 | 500 | 502 };

function stripeErrorMessage(err: unknown, prefix: string): string {
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return `${prefix}: ${(err as { message: string }).message}`;
  }
  return prefix;
}

function durationFromCoupon(coupon: CommercialCoupon): {
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

function buildStripeCouponCreateParams(coupon: CommercialCoupon): Stripe.CouponCreateParams {
  const { duration, duration_in_months } = durationFromCoupon(coupon);
  return {
    name: coupon.internalName,
    duration,
    ...(duration === "repeating" && duration_in_months ? { duration_in_months } : {}),
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
  };
}

function buildPromoRestrictionsFromOptions(options: {
  firstTimeOnly?: boolean;
  minimumAmountCents?: number | null;
  minimumAmountCurrency?: string | null;
}): Stripe.PromotionCodeCreateParams["restrictions"] {
  const restrictions: NonNullable<Stripe.PromotionCodeCreateParams["restrictions"]> = {};
  if (options.firstTimeOnly) restrictions.first_time_transaction = true;
  if (options.minimumAmountCents) {
    restrictions.minimum_amount = options.minimumAmountCents;
    restrictions.minimum_amount_currency = (options.minimumAmountCurrency ?? "brl").toLowerCase();
  }
  return Object.keys(restrictions).length > 0 ? restrictions : undefined;
}

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

async function createSinglePromotionCode(
  stripeCouponId: string,
  code: string,
  options: PromoCodeCreateOptions,
): Promise<Stripe.PromotionCode> {
  const stripe = getStripe();
  let stripeCustomerId: string | undefined;
  if (options.restrictedCustomerEmail) {
    stripeCustomerId = await findOrCreateStripeCustomer(options.restrictedCustomerEmail);
  }

  const restrictions = buildPromoRestrictionsFromOptions({
    firstTimeOnly: options.firstTimeOnly,
    minimumAmountCents: options.minimumAmountCents ?? options.minimumAmountBrl,
    minimumAmountCurrency: options.minimumAmountCurrency,
  });
  const expiresAt = options.promoExpiresAt
    ? Math.floor(new Date(options.promoExpiresAt).getTime() / 1000)
    : undefined;

  return stripe.promotionCodes.create({
    promotion: { type: "coupon", coupon: stripeCouponId },
    active: true,
    code,
    ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
    ...(expiresAt ? { expires_at: expiresAt } : {}),
    ...(options.promoMaxRedemptions ? { max_redemptions: options.promoMaxRedemptions } : {}),
    ...(restrictions ? { restrictions } : {}),
  });
}

async function createStripePromotionCodes(
  coupon: CommercialCoupon,
  stripeCouponId: string,
  extraCodeStrings: string[],
  mainOptions?: PromoCodeCreateOptions,
  extraPromoConfigs: PromoCodeCreateOptions[] = [],
): Promise<{ stripePromoCodeId: string | null; extraCodes: CouponExtraCode[] }> {
  const mainPromo = await createSinglePromotionCode(stripeCouponId, coupon.code, {
    firstTimeOnly: coupon.firstTimeOnly,
    minimumAmountCents: coupon.minimumAmountCents,
    minimumAmountCurrency: coupon.minimumAmountCurrency,
    restrictedCustomerEmail: coupon.restrictedCustomerEmail,
    promoMaxRedemptions: mainOptions?.promoMaxRedemptions,
    promoExpiresAt: mainOptions?.promoExpiresAt,
  });

  const extraCodes: CouponExtraCode[] = [];
  for (let i = 0; i < extraCodeStrings.length; i++) {
    const extraOpts = extraPromoConfigs[i] ?? {};
    const extraPromo = await createSinglePromotionCode(stripeCouponId, extraCodeStrings[i], {
      firstTimeOnly: extraOpts.firstTimeOnly ?? false,
      minimumAmountCents: extraOpts.minimumAmountCents ?? extraOpts.minimumAmountBrl ?? null,
      minimumAmountCurrency: extraOpts.minimumAmountCurrency ?? null,
      restrictedCustomerEmail: extraOpts.restrictedCustomerEmail ?? null,
      promoMaxRedemptions: extraOpts.promoMaxRedemptions,
      promoExpiresAt: extraOpts.promoExpiresAt,
    });
    extraCodes.push({
      id: `exc_${randomUUID()}`,
      couponId: coupon.id,
      code: extraCodeStrings[i],
      stripePromoCodeId: extraPromo.id,
      createdAt: new Date().toISOString(),
    });
  }

  return { stripePromoCodeId: mainPromo.id, extraCodes };
}

export async function findOrCreateStripeCustomer(email: string): Promise<string> {
  const stripe = getStripe();
  const normalized = email.trim().toLowerCase();
  const customers = await stripe.customers.list({ email: normalized, limit: 1 });
  if (customers.data.length > 0) return customers.data[0].id;
  const created = await stripe.customers.create({ email: normalized });
  return created.id;
}

async function rollbackStripeCoupon(stripeCouponId: string | null) {
  if (!stripeCouponId) return;
  try {
    await getStripe().coupons.del(stripeCouponId);
  } catch (err) {
    console.error("[create-coupon] Falha no rollback Stripe — recuperação manual necessária:", stripeCouponId, err);
  }
}

async function rollbackDbCoupon(couponId: string) {
  try {
    await deleteCoupon(couponId);
  } catch (err) {
    console.error("[create-coupon] Falha ao remover cupom do DB no rollback:", couponId, err);
  }
}

/** Verifica unicidade do código principal e extras no store. */
export function findDuplicateCodes(
  store: CommercialStore,
  mainCode: string,
  extraCodes: string[],
  excludeCouponId?: string,
): string | null {
  const allNew = [mainCode, ...extraCodes].map(normalizeCouponCode).filter(Boolean);
  const seen = new Set<string>();
  for (const code of allNew) {
    if (seen.has(code)) return code;
    seen.add(code);
  }

  for (const c of store.coupons) {
    if (excludeCouponId && c.id === excludeCouponId) continue;
    if (allNew.includes(c.code)) return c.code;
  }
  for (const ec of store.extraCodes) {
    if (excludeCouponId) {
      const parent = store.coupons.find((c) => c.id === ec.couponId);
      if (parent?.id === excludeCouponId) continue;
    }
    if (allNew.includes(ec.code)) return ec.code;
  }
  return null;
}

/** Cria cupom novo: Stripe primeiro, depois DB, com rollback em falha. */
export async function createCouponWithStripe(
  coupon: CommercialCoupon,
  extraCodeStrings: string[],
  promoOptions?: PromoCodeCreateOptions,
  extraPromoConfigs: PromoCodeCreateOptions[] = [],
): Promise<CreateCouponResult> {
  let stripeCouponId: string | null = null;
  let dbWritten = false;

  try {
    const stripe = getStripe();
    const stripeCoupon = await stripe.coupons.create(buildStripeCouponCreateParams(coupon));
    stripeCouponId = stripeCoupon.id;

    let stripePromoCodeId: string | null = null;
    let extraCodes: CouponExtraCode[] = [];

    if (coupon.createPublicCode) {
      const promoResult = await createStripePromotionCodes(
        coupon,
        stripeCouponId,
        extraCodeStrings,
        promoOptions,
        extraPromoConfigs,
      );
      stripePromoCodeId = promoResult.stripePromoCodeId;
      extraCodes = promoResult.extraCodes;
    }

    const couponToSave: CommercialCoupon = {
      ...coupon,
      stripeCouponId,
      stripePromoCodeId,
    };

    await upsertCoupon(couponToSave);
    dbWritten = true;

    for (const ec of extraCodes) {
      await insertExtraCode(ec);
    }

    return { ok: true, coupon: couponToSave, extraCodes };
  } catch (err) {
    console.error("[create-coupon] Falha na criação:", err);
    if (dbWritten) await rollbackDbCoupon(coupon.id);
    await rollbackStripeCoupon(stripeCouponId);
    return {
      ok: false,
      error: stripeErrorMessage(err, "Falha ao criar cupom no Stripe"),
      status: 502,
    };
  }
}

const SAFE_EDIT_FIELDS = [
  "active",
  "internalName",
  "description",
  "partnerId",
  "allowedPlanSlugs",
  "allowedPeriodicities",
  "maxRedemptionsPerUser",
] as const;

/** Atualiza apenas campos seguros de um cupom existente (sem recriar Stripe). */
export function mergeSafeCouponEdit(
  existing: CommercialCoupon,
  incoming: CommercialCoupon,
): CommercialCoupon {
  return {
    ...existing,
    active: incoming.active,
    internalName: incoming.internalName,
    description: incoming.description,
    partnerId: incoming.partnerId,
    allowedPlanSlugs: incoming.allowedPlanSlugs,
    allowedPeriodicities: incoming.allowedPeriodicities,
    maxRedemptionsPerUser: incoming.maxRedemptionsPerUser,
    updatedAt: new Date().toISOString(),
  };
}

export function isSafeEditOnly(existing: CommercialCoupon, incoming: CommercialCoupon): boolean {
  const immutableKeys: (keyof CommercialCoupon)[] = [
    "code",
    "discountType",
    "discountValue",
    "validFrom",
    "validUntil",
    "maxRedemptionsTotal",
    "discountRecurrence",
    "recurringCyclesLimit",
    "createPublicCode",
    "firstTimeOnly",
    "restrictedCustomerEmail",
    "minimumAmountCents",
    "minimumAmountCurrency",
    "stripeProductIds",
    "stripeCouponId",
    "stripePromoCodeId",
  ];
  return immutableKeys.every((k) => {
    const a = existing[k];
    const b = incoming[k];
    if (Array.isArray(a) && Array.isArray(b)) {
      return JSON.stringify(a) === JSON.stringify(b);
    }
    return a === b;
  });
}

export { SAFE_EDIT_FIELDS };
