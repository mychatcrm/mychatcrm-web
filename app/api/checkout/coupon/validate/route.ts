import { NextResponse } from "next/server";
import { buildCommercialStoreFromDb } from "@/lib/server/commercial-store-db";
import { resolveCheckoutCoupon, resolveCheckoutPriceProduct } from "@/lib/server/checkout-coupon";
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
  if (!code.trim()) {
    return NextResponse.json(
      {
        ok: false,
        code: "COUPON_EMPTY",
        message: "Cupom opcional — digite um código para validar ou continue sem cupom.",
      },
      { status: 200 },
    );
  }

  let stripeProductId: string | null = null;
  try {
    const priceContext = await resolveCheckoutPriceProduct({ planSlug, billingCycle });
    stripeProductId = priceContext.productId;
  } catch (error) {
    console.error("[checkout/coupon/validate] Falha ao resolver produto Stripe do plano:", error);
    return NextResponse.json(
      {
        ok: false,
        code: "STRIPE_PRICE_PRODUCT_UNAVAILABLE",
        message: "Não foi possível verificar a compatibilidade deste cupom com o plano agora.",
      },
      { status: 503 },
    );
  }

  const store = await buildCommercialStoreFromDb();

  const result = resolveCheckoutCoupon({
    store,
    codeRaw: code,
    planSlug,
    billingCycle,
    emailRaw: email,
    stripeProductId,
  });

  if (!result.ok) {
    if (result.code === "COUPON_EMPTY") {
      return NextResponse.json(result, { status: 200 });
    }
    return NextResponse.json(result, { status: 422 });
  }

  const { stripePromoCodeId, normalizedCode, ...couponResult } = result;

  return NextResponse.json({ ...couponResult, stripePromoCodeId });
}
