import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { normalizeCouponCode } from "@/lib/commercial/engine";
import { validateCheckoutPhone } from "@/lib/checkout-phone";
import { getStripe } from "@/lib/stripe";
import type { NormalizedPlan } from "@/lib/plan-policy";
import { getPlanBySlug, parsePlanBillingCycle, PLAN_CHECKOUT_SLUGS } from "@/lib/plans";
import { SITE_URL } from "@/lib/constants";
import { checkEmailAvailability } from "@/lib/server/email-availability";
import { buildCommercialStoreFromDb, updateRedemptionStatus } from "@/lib/server/commercial-store-db";
import {
  commitCheckoutCoupon,
  resolveCheckoutCoupon,
  resolveCheckoutPriceProduct,
} from "@/lib/server/checkout-coupon";
import { provisionFromInternalCheckout } from "@/lib/server/stripe-provision";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      planSlug?: string;
      ciclo?: string;
      email?: string;
      name?: string;
      phone?: string;
      company?: string;
      stripePromoCodeId?: string;
      couponCode?: string;
      couponIdempotencyKey?: string;
    };

    const { planSlug, ciclo, email, name, phone, company, couponCode, couponIdempotencyKey } = body;

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

    const phoneCheck = validateCheckoutPhone(phone ?? "");
    if (!phoneCheck.ok) {
      return NextResponse.json({ message: phoneCheck.message }, { status: 400 });
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

    let priceContext: Awaited<ReturnType<typeof resolveCheckoutPriceProduct>>;
    try {
      priceContext = await resolveCheckoutPriceProduct({ planSlug, billingCycle: cycle });
    } catch {
      return NextResponse.json(
        { message: "Pagamento temporariamente indisponível. Entre em contacto com o suporte." },
        { status: 503 },
      );
    }

    const normalizedCoupon = normalizeCouponCode(couponCode ?? "");
    let stripePromoCodeId: string | undefined;
    let couponMetadata: { couponCode?: string; couponId?: string; couponIdempotencyKey?: string } = {};
    let internalProvisioningCoupon = false;
    let couponCommit:
      | {
          store: Awaited<ReturnType<typeof buildCommercialStoreFromDb>>;
          codeRaw: string;
          idempotencyKey: string;
        }
      | null = null;

    if (normalizedCoupon) {
      const store = await buildCommercialStoreFromDb();
      const resolved = resolveCheckoutCoupon({
        store,
        codeRaw: normalizedCoupon,
        planSlug,
        billingCycle: cycle,
        emailRaw: emailRaw,
        stripeProductId: priceContext.productId,
      });

      if (!resolved.ok) {
        return NextResponse.json(
          { message: resolved.message, code: resolved.code },
          { status: 422 },
        );
      }

      const idempotencyKey =
        typeof couponIdempotencyKey === "string" && couponIdempotencyKey.trim()
          ? couponIdempotencyKey.trim()
          : `checkout_${randomUUID()}`;

      if (resolved.internalProvisioning) {
        internalProvisioningCoupon = true;
        couponMetadata = {
          couponCode: resolved.code,
          couponId: resolved.couponId,
          couponIdempotencyKey: idempotencyKey,
        };
        couponCommit = {
          store,
          codeRaw: normalizedCoupon,
          idempotencyKey,
        };
      } else {
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

        stripePromoCodeId = resolved.stripePromoCodeId;
        couponMetadata = {
          couponCode: resolved.code,
          couponId: resolved.couponId,
          couponIdempotencyKey: idempotencyKey,
        };
        couponCommit = {
          store,
          codeRaw: normalizedCoupon,
          idempotencyKey,
        };
      }
    }

    if (internalProvisioningCoupon && couponCommit) {
      const provision = await provisionFromInternalCheckout({
        email: emailRaw,
        name,
        phone: phoneCheck.phone,
        company,
        planSlug: planSlug as NormalizedPlan,
        billingCycle: cycle,
      });

      const commitResult = await commitCheckoutCoupon({
        store: couponCommit.store,
        codeRaw: couponCommit.codeRaw,
        planSlug,
        billingCycle: cycle,
        email: emailRaw,
        idempotencyKey: couponCommit.idempotencyKey,
        stripeProductId: priceContext.productId,
      });

      if (!commitResult.ok) {
        console.error("[create-checkout-session] Conta interna criada, mas registro de cupom falhou:", {
          internalSessionId: provision.internalSessionId,
          code: commitResult.code,
          message: commitResult.message,
        });
      } else {
        await updateRedemptionStatus(commitResult.redemptionId, "confirmed");
      }

      return NextResponse.json({
        url: `${SITE_URL}/checkout/${planSlug}/success?session_id=${encodeURIComponent(provision.internalSessionId)}`,
      });
    }

    const stripe = getStripe();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceContext.priceId, quantity: 1 }],
      customer_email: emailRaw,
      metadata: {
        planSlug,
        billingCycle: cycle,
        customerName: (name ?? "").trim(),
        phone: phoneCheck.phone,
        company: (company ?? "").trim(),
        ...couponMetadata,
      },
      subscription_data: {
        metadata: {
          planSlug,
          billingCycle: cycle,
          phone: phoneCheck.phone,
          ...couponMetadata,
        },
      },
      ...(stripePromoCodeId ? { discounts: [{ promotion_code: stripePromoCodeId }] } : {}),
      success_url: `${SITE_URL}/checkout/${planSlug}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/checkout/${planSlug}?ciclo=${cycle}&cancelled=1`,
      locale: "pt-BR",
    });

    if (couponCommit) {
      const commitResult = await commitCheckoutCoupon({
        store: couponCommit.store,
        codeRaw: couponCommit.codeRaw,
        planSlug,
        billingCycle: cycle,
        email: emailRaw,
        idempotencyKey: couponCommit.idempotencyKey,
        stripeProductId: priceContext.productId,
      });

      if (!commitResult.ok) {
        console.error("[create-checkout-session] Sessão criada, mas commit de cupom falhou:", {
          sessionId: session.id,
          code: commitResult.code,
          message: commitResult.message,
        });
        return NextResponse.json(
          { message: commitResult.message, code: commitResult.code },
          { status: 422 },
        );
      }
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[stripe/create-checkout-session]", err);
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: unknown }).code === "coupon_applies_to_nothing"
    ) {
      return NextResponse.json(
        {
          message: "Este cupom não se aplica ao produto deste plano.",
          code: "COUPON_PRODUCT_NOT_ALLOWED",
        },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { message: "Não foi possível iniciar o pagamento. Tente novamente." },
      { status: 500 },
    );
  }
}
