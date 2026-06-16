import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { normalizeCouponCode } from "@/lib/commercial/engine";
import { getStripe } from "@/lib/stripe";
import { getStripePriceId } from "@/lib/stripe-prices";
import { getPlanBySlug, parsePlanBillingCycle, PLAN_CHECKOUT_SLUGS } from "@/lib/plans";
import { SITE_URL } from "@/lib/constants";
import { checkEmailAvailability } from "@/lib/server/email-availability";
import { buildCommercialStoreFromDb } from "@/lib/server/commercial-store-db";
import { commitCheckoutCoupon, resolveCheckoutCoupon } from "@/lib/server/checkout-coupon";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      planSlug?: string;
      ciclo?: string;
      email?: string;
      name?: string;
      company?: string;
      stripePromoCodeId?: string;
      couponCode?: string;
      couponIdempotencyKey?: string;
    };

    const { planSlug, ciclo, email, name, company, couponCode, couponIdempotencyKey } = body;

    if (!planSlug || !PLAN_CHECKOUT_SLUGS.includes(planSlug)) {
      return NextResponse.json({ message: "Plano inválido." }, { status: 400 });
    }

    const plan = getPlanBySlug(planSlug);
    if (!plan || plan.contactOnly || plan.priceMonthly == null) {
      return NextResponse.json(
        { message: "Este plano não está disponível para checkout online." },
        { status: 400 },
      );
    }

    const emailRaw = (email ?? "").trim();
    if (!emailRaw) {
      return NextResponse.json({ message: "E-mail é obrigatório." }, { status: 400 });
    }

    const availability = await checkEmailAvailability(emailRaw);

    if (!availability.ok) {
      if (availability.reason === "invalid_format") {
        return NextResponse.json({ message: "E-mail inválido." }, { status: 400 });
      }
      if (availability.envMissing) {
        console.error(
          "[create-checkout-session] SUPABASE_SERVICE_ROLE_KEY ausente em produção — configure a variável na Vercel.",
        );
      } else {
        console.error("[create-checkout-session] Falha ao consultar banco de dados:", availability.message);
      }
      return NextResponse.json(
        {
          message: "Não foi possível validar o e-mail. Aguarde alguns segundos e tente novamente.",
          code: "EMAIL_CHECK_FAILED",
        },
        { status: 503 },
      );
    }

    if (!availability.available) {
      return NextResponse.json(
        {
          message:
            "Este e-mail já possui uma conta ativa. Faça login em /login ou entre em contato com o suporte.",
          code: "EMAIL_ALREADY_EXISTS",
        },
        { status: 409 },
      );
    }

    const cycle = parsePlanBillingCycle(ciclo);

    let priceId: string;
    try {
      priceId = getStripePriceId(planSlug, cycle);
    } catch {
      return NextResponse.json(
        { message: "Pagamento temporariamente indisponível. Entre em contacto com o suporte." },
        { status: 503 },
      );
    }

    const normalizedCoupon = normalizeCouponCode(couponCode ?? "");
    let stripePromoCodeId: string | undefined;
    let couponMetadata: { couponCode?: string; couponId?: string } = {};

    if (normalizedCoupon) {
      const store = await buildCommercialStoreFromDb();
      const resolved = resolveCheckoutCoupon({
        store,
        codeRaw: normalizedCoupon,
        planSlug,
        billingCycle: cycle,
        emailRaw: emailRaw,
      });

      if (!resolved.ok) {
        return NextResponse.json(
          { message: resolved.message, code: resolved.code },
          { status: 422 },
        );
      }

      if (!resolved.stripePromoCodeId) {
        return NextResponse.json(
          {
            message:
              "Este cupom não está configurado para desconto no pagamento. Entre em contato com o suporte.",
            code: "COUPON_STRIPE_PROMO_MISSING",
          },
          { status: 422 },
        );
      }

      const idempotencyKey =
        typeof couponIdempotencyKey === "string" && couponIdempotencyKey.trim()
          ? couponIdempotencyKey.trim()
          : `checkout_${randomUUID()}`;

      const commitResult = await commitCheckoutCoupon({
        store,
        codeRaw: normalizedCoupon,
        planSlug,
        billingCycle: cycle,
        email: emailRaw,
        idempotencyKey,
      });

      if (!commitResult.ok) {
        return NextResponse.json(
          { message: commitResult.message, code: commitResult.code },
          { status: 422 },
        );
      }

      stripePromoCodeId = resolved.stripePromoCodeId;
      couponMetadata = { couponCode: resolved.code, couponId: resolved.couponId };
    }

    const stripe = getStripe();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: emailRaw,
      metadata: {
        planSlug,
        billingCycle: cycle,
        customerName: (name ?? "").trim(),
        company: (company ?? "").trim(),
        ...couponMetadata,
      },
      subscription_data: {
        metadata: {
          planSlug,
          billingCycle: cycle,
          ...couponMetadata,
        },
      },
      ...(stripePromoCodeId ? { discounts: [{ promotion_code: stripePromoCodeId }] } : {}),
      success_url: `${SITE_URL}/checkout/${planSlug}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/checkout/${planSlug}?ciclo=${cycle}&cancelled=1`,
      locale: "pt-BR",
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[stripe/create-checkout-session]", err);
    return NextResponse.json(
      { message: "Não foi possível iniciar o pagamento. Tente novamente." },
      { status: 500 },
    );
  }
}
