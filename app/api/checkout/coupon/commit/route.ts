import { NextResponse } from "next/server";
import { normalizeCouponCode } from "@/lib/commercial/engine";
import { commitCheckoutCoupon, resolveCheckoutPriceProduct } from "@/lib/server/checkout-coupon";
import { parsePlanBillingCycle, SALES_PLANS } from "@/lib/plans";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    code?: string;
    planSlug?: string;
    email?: string;
    idempotencyKey?: string;
    ciclo?: string;
    billingCycle?: string;
  } | null;

  const planSlug = typeof body?.planSlug === "string" ? body.planSlug.trim() : "";
  const code = typeof body?.code === "string" ? body.code : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";

  if (!planSlug || !email) {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", message: "E-mail e plano são obrigatórios para concluir o pedido." },
      { status: 400 },
    );
  }

  if (!normalizeCouponCode(code)) {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", message: "Cupom opcional — sem código não há nada a registar." },
      { status: 400 },
    );
  }

  if (!idempotencyKey) {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", message: "Chave de idempotência ausente — recarregue a página e tente novamente." },
      { status: 400 },
    );
  }

  const plan = SALES_PLANS.find((p) => p.slug === planSlug);
  if (!plan || plan.priceMonthly === null) {
    return NextResponse.json({ ok: false, code: "PLAN_NOT_CHECKOUT", message: "Plano sem checkout." }, { status: 400 });
  }

  const billingCycle = parsePlanBillingCycle(body?.ciclo ?? body?.billingCycle);
  let stripeProductId: string | null = null;
  try {
    const priceContext = await resolveCheckoutPriceProduct({ planSlug, billingCycle });
    stripeProductId = priceContext.productId;
  } catch (error) {
    console.error("[checkout/coupon/commit] Falha ao resolver produto Stripe do plano:", error);
    return NextResponse.json(
      {
        ok: false,
        code: "STRIPE_PRICE_PRODUCT_UNAVAILABLE",
        message: "Não foi possível verificar a compatibilidade deste cupom com o plano agora.",
      },
      { status: 503 },
    );
  }

  const result = await commitCheckoutCoupon({
    codeRaw: code,
    planSlug,
    billingCycle,
    email,
    idempotencyKey,
    stripeProductId,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, code: result.code, message: result.message }, { status: 422 });
  }

  return NextResponse.json(result);
}
