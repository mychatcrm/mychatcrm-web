/**
 * GET /api/stripe/activate?session_id=xxx
 * Verifica a sessão Stripe, provisiona o tenant (se ainda não provisionado pelo webhook)
 * e retorna o token de ativação de senha para o cliente.
 */
import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import {
  activateInternalCheckoutSession,
  isInternalTestCheckoutSessionId,
  provisionFromStripeSession,
} from "@/lib/server/stripe-provision";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ message: "session_id obrigatório." }, { status: 400 });
  }

  try {
    if (isInternalTestCheckoutSessionId(sessionId)) {
      const result = await activateInternalCheckoutSession(sessionId);
      return NextResponse.json({
        ok: true,
        email: result.email,
        activationToken: result.activationToken,
      });
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid" && session.status !== "complete") {
      return NextResponse.json(
        { message: "Pagamento ainda não confirmado." },
        { status: 402 },
      );
    }

    const result = await provisionFromStripeSession(session);

    return NextResponse.json({
      ok: true,
      email: result.email,
      activationToken: result.activationToken,
    });
  } catch (err) {
    console.error("[stripe/activate]", err);
    return NextResponse.json(
      { message: "Não foi possível confirmar seu acesso. Entre em contato com o suporte." },
      { status: 500 },
    );
  }
}
