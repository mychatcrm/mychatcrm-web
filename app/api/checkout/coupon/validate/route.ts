import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { buildCommercialStoreFromDb, insertRedemption } from "@/lib/server/commercial-store-db";
import { resolveCheckoutCoupon } from "@/lib/server/checkout-coupon";
import { parsePlanBillingCycle, SALES_PLANS } from "@/lib/plans";

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
  const store = await buildCommercialStoreFromDb();

  const result = resolveCheckoutCoupon({
    store,
    codeRaw: code,
    planSlug,
    billingCycle,
    emailRaw: email,
  });

  if (!result.ok) {
    if (result.code === "COUPON_EMPTY") {
      return NextResponse.json(result, { status: 200 });
    }
    return NextResponse.json(result, { status: 422 });
  }

  const { stripePromoCodeId, normalizedCode, ...couponResult } = result;

  if (email && couponResult.couponId) {
    insertRedemption({
      id: `red_${randomUUID()}`,
      createdAt: new Date().toISOString(),
      status: "pending",
      idempotencyKey: `pending_${randomUUID()}`,
      couponId: couponResult.couponId,
      codeNormalized: normalizedCode,
      planSlug,
      emailNormalized: email.toLowerCase(),
      originalCents: couponResult.originalCents,
      discountCents: couponResult.discountCents,
      finalCents: couponResult.finalCents,
      partnerId: couponResult.partnerId,
      commissionCents: 0,
    }).catch((e: unknown) => console.warn("[validate] Falha ao gravar pending:", e));
  }

  return NextResponse.json({ ...couponResult, stripePromoCodeId });
}
