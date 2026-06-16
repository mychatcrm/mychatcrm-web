import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getStripePriceId } from "@/lib/stripe-prices";
import { getPlanBySlug, parsePlanBillingCycle, PLAN_CHECKOUT_SLUGS } from "@/lib/plans";
import { SITE_URL } from "@/lib/constants";
import { checkEmailAvailability } from "@/lib/server/email-availability";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      planSlug?: string;
      ciclo?: string;
      email?: string;
      name?: string;
      company?: string;
      stripePromoCodeId?: string;
    };

    const { planSlug, ciclo, email, name, company, stripePromoCodeId } = body;

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

    // Verificar disponibilidade do e-mail — fail-CLOSED
    const emailRaw = (email ?? "").trim();
    if (!emailRaw) {
      return NextResponse.json({ message: "E-mail é obrigatório." }, { status: 400 });
    }

    const availability = await checkEmailAvailability(emailRaw);

    if (!availability.ok) {
      if (availability.reason === "invalid_format") {
        return NextResponse.json({ message: "E-mail inválido." }, { status: 400 });
      }
      // Supabase falhou — fail-closed: bloquear o checkout
      if (availability.envMissing) {
        console.error(
          "[create-checkout-session] SUPABASE_SERVICE_ROLE_KEY ausente em produção — configure a variável na Vercel.",
        );
      } else {
        console.error("[create-checkout-session] Falha ao consultar banco de dados:", availability.message);
      }
      return NextResponse.json(
        {
          message:
            "Não foi possível validar o e-mail. Aguarde alguns segundos e tente novamente.",
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

    const stripe = getStripe();

    console.log("[CHECKOUT DEBUG] body recebido:", JSON.stringify(body));
    console.log("[CHECKOUT DEBUG] stripePromoCodeId extraído:", stripePromoCodeId);
    console.log(
      "[CHECKOUT DEBUG] discounts que serão enviados:",
      stripePromoCodeId ? JSON.stringify([{ promotion_code: stripePromoCodeId }]) : "NENHUM",
    );

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
      },
      subscription_data: {
        metadata: {
          planSlug,
          billingCycle: cycle,
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
