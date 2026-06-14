import { NextResponse } from "next/server";
import { brlToCents, validateCouponForCheckout } from "@/lib/commercial/engine";
import { buildCommercialStoreFromDb } from "@/lib/server/commercial-store-db";
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
  const store = await buildCommercialStoreFromDb();
  const originalCents = brlToCents(planCheckoutChargeBaseBRL(plan.priceMonthly, billingCycle));
  const result = validateCouponForCheckout({ store, codeRaw: code, planSlug, originalCents, emailRaw: email });

  if (!result.ok) {
    if (result.code === "COUPON_EMPTY") {
      return NextResponse.json(result, { status: 200 });
    }
    return NextResponse.json(result, { status: 422 });
  }

  const coupon = store.coupons.find((c) => c.id === result.couponId);
  return NextResponse.json({ ...result, stripePromoCodeId: coupon?.stripePromoCodeId ?? null });
}
