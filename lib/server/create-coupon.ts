import type Stripe from "stripe";
import type { CommercialCoupon, CommercialStore, CouponExtraCode } from "@/lib/commercial/types";
import { normalizeCouponCode } from "@/lib/commercial/engine";
import {
  assertCommercialCouponsSchemaReady,
  deleteCoupon,
  insertExtraCode,
  isCommercialCouponsSchemaError,
  upsertCoupon,
} from "@/lib/server/commercial-store-db";
import {
  buildPromotionCodeCreateParams,
  buildStripeCouponCreateParams,
  mergeMainPromoOptions,
  validateAllPromoExpiriesForCoupon,
  type PromoCodeCreateOptions,
} from "@/lib/server/stripe-coupon-mapping";
import { getStripe } from "@/lib/stripe";
import { randomUUID } from "crypto";

export type { PromoCodeCreateOptions } from "@/lib/server/stripe-coupon-mapping";

export type CreateCouponResult =
  | { ok: true; coupon: CommercialCoupon; extraCodes: CouponExtraCode[] }
  | { ok: false; error: string; status: 400 | 409 | 500 | 502 };

function stripeErrorMessage(err: unknown, prefix: string): string {
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return `${prefix}: ${(err as { message: string }).message}`;
  }
  return prefix;
}

function createCouponErrorMessage(err: unknown): string {
  if (isCommercialCouponsSchemaError(err)) {
    return err instanceof Error
      ? err.message
      : "Configuração do banco de cupons incompleta. A criação no Stripe foi bloqueada por segurança.";
  }
  return stripeErrorMessage(err, "Falha ao criar cupom no Stripe");
}

async function createSinglePromotionCode(
  stripeCouponId: string,
  code: string,
  options: PromoCodeCreateOptions & { active?: boolean },
): Promise<Stripe.PromotionCode> {
  const stripe = getStripe();
  let stripeCustomerId: string | undefined;
  if (options.restrictedCustomerEmail) {
    stripeCustomerId = await findOrCreateStripeCustomer(options.restrictedCustomerEmail);
  }

  const params = buildPromotionCodeCreateParams(stripeCouponId, code, options);
  return stripe.promotionCodes.create({
    ...params,
    ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
  });
}

async function createStripePromotionCodes(
  coupon: CommercialCoupon,
  stripeCouponId: string,
  extraCodeStrings: string[],
  mainOptions?: PromoCodeCreateOptions,
  extraPromoConfigs: PromoCodeCreateOptions[] = [],
): Promise<{ stripePromoCodeId: string | null; extraCodes: CouponExtraCode[] }> {
  const mainPromo = await createSinglePromotionCode(
    stripeCouponId,
    coupon.code,
    mergeMainPromoOptions(coupon, mainOptions),
  );

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
      active: coupon.active,
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
    const expiryErr = validateAllPromoExpiriesForCoupon(coupon, promoOptions, extraPromoConfigs);
    if (expiryErr) {
      return { ok: false, error: expiryErr, status: 400 };
    }

    await assertCommercialCouponsSchemaReady();

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
      error: createCouponErrorMessage(err),
      status: isCommercialCouponsSchemaError(err) ? 500 : 502,
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
    "promoMaxRedemptions",
    "promoExpiresAt",
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
