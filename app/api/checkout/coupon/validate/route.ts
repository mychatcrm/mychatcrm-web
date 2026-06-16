import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { brlToCents, normalizeCouponCode, validateCouponForCheckout } from "@/lib/commercial/engine";
import { resolveCheckoutPeriodicity } from "@/lib/commercial/coupon-periodicity";
import { buildCommercialStoreFromDb, insertRedemption } from "@/lib/server/commercial-store-db";
import { parsePlanBillingCycle, planCheckoutChargeBaseBRL, SALES_PLANS } from "@/lib/plans";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    code?: string;
    planSlug?: string;
    email?: string;
    ciclo?: string;
    billingCycle?: string;
  } | null;

  const planSlug = typeof body?.planSlug === "string" ? body.planSlug.trim() : "";
  const code = typeof body?.code === "string" ? body.code : "";
  const email = typeof body?.email === "string" ? body.email : undefined;

  if (!planSlug) {
    return NextResponse.json({ ok: false, code: "BAD_REQUEST", message: "Plano inválido." }, { status: 400 });
  }

  const plan = SALES_PLANS.find((p) => p.slug === planSlug);
  if (!plan || plan.priceMonthly === null) {
    return NextResponse.json({ ok: false, code: "PLAN_NOT_CHECKOUT", message: "Plano sem checkout." }, { status: 400 });
  }

  const billingCycle = parsePlanBillingCycle(body?.ciclo ?? body?.billingCycle);
  const checkoutPeriodicity = resolveCheckoutPeriodicity(billingCycle, planSlug);
  const store = await buildCommercialStoreFromDb();
  const originalCents = brlToCents(planCheckoutChargeBaseBRL(plan.priceMonthly, billingCycle));

  // Suporte a extra codes — resolver para o código principal antes de validar
  const normalizedCode = normalizeCouponCode(code);
  const extraCodeMatch = store.extraCodes.find((e) => e.code === normalizedCode);
  const effectiveCode = extraCodeMatch
    ? store.coupons.find((c) => c.id === extraCodeMatch.couponId)?.code ?? code
    : code;

  const result = validateCouponForCheckout({
    store,
    codeRaw: effectiveCode,
    planSlug,
    originalCents,
    emailRaw: email,
    checkoutPeriodicity,
  });

  if (!result.ok) {
    if (result.code === "COUPON_EMPTY") {
      return NextResponse.json(result, { status: 200 });
    }
    return NextResponse.json(result, { status: 422 });
  }

  const coupon = store.coupons.find((c) => c.id === result.couponId);
  const stripePromoCodeId = extraCodeMatch?.stripePromoCodeId ?? coupon?.stripePromoCodeId ?? null;

  if (email && result.couponId) {
    insertRedemption({
      id: `red_${randomUUID()}`,
      createdAt: new Date().toISOString(),
      status: "pending",
      idempotencyKey: `pending_${randomUUID()}`,
      couponId: result.couponId,
      codeNormalized: normalizedCode,
      planSlug,
      emailNormalized: email.toLowerCase(),
      originalCents: result.originalCents,
      discountCents: result.discountCents,
      finalCents: result.finalCents,
      partnerId: result.partnerId,
      commissionCents: 0,
    }).catch((e: unknown) => console.warn("[validate] Falha ao gravar pending:", e));
  }

  return NextResponse.json({ ...result, stripePromoCodeId });
}
