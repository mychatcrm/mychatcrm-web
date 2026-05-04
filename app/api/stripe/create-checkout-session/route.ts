import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getStripePriceId } from "@/lib/stripe-prices";
import { getPlanBySlug, parsePlanBillingCycle, PLAN_CHECKOUT_SLUGS } from "@/lib/plans";
import { SITE_URL } from "@/lib/constants";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      planSlug?: string;
      ciclo?: string;
      email?: string;
      name?: string;
      company?: string;
    };

    const { planSlug, ciclo, email, name, company } = body;

    if (!planSlug || !PLAN_CHECKOUT_SLUGS.includes(planSlug)) {
      return NextResponse.json({ message: "Plano inválido." }, { status: 400 });
    }

    // Verificar se o e-mail já tem conta ativa
    const emailNorm = (email ?? "").trim().toLowerCase();
    if (!emailNorm) {
      return NextResponse.json({ message: "E-mail é obrigatório." }, { status: 400 });
    }

    const sb = createSupabaseServiceClient();
    const { data: existing } = await sb
      .from("tenant_members")
      .select("id")
      .eq("email", emailNorm)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        {
          message:
            "Este e-mail já possui uma conta ativa. Faça login em /login ou entre em contato com o suporte.",
          code: "EMAIL_ALREADY_EXISTS",
        },
        { status: 409 },
      );
    }

    const plan = getPlanBySlug(planSlug);
    if (!plan || plan.contactOnly || plan.priceMonthly == null) {
      return NextResponse.json(
        { message: "Este plano não está disponível para checkout online." },
        { status: 400 },
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

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email?.trim() || undefined,
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
