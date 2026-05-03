/**
 * POST /api/webhooks/stripe
 * Recebe eventos do Stripe e provisiona contas automaticamente.
 *
 * Configure o webhook no Stripe Dashboard apontando para:
 *   https://seudominio.com/api/webhooks/stripe
 *
 * Eventos necessários:
 *   - checkout.session.completed
 *   - customer.subscription.deleted  (para suspensão futura)
 */
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { provisionFromStripeSession } from "@/lib/server/stripe-provision";

function getWebhookSecret(): string {
  const s = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!s) throw new Error("[stripe-webhook] STRIPE_WEBHOOK_SECRET não definida.");
  return s;
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, getWebhookSecret());
  } catch (err) {
    console.error("[stripe-webhook] Assinatura inválida:", (err as Error).message);
    return NextResponse.json({ message: "Webhook signature invalid." }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        // Provisiona apenas se o pagamento foi confirmado (assinatura → always paid)
        if (session.payment_status === "paid" || session.mode === "subscription") {
          await provisionFromStripeSession(session);
        }
        break;
      }

      case "customer.subscription.deleted": {
        // TODO: suspender tenant quando assinatura cancelar/expirar
        const sub = event.data.object as Stripe.Subscription;
        console.log("[stripe-webhook] Subscription deleted:", sub.id);
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[stripe-webhook] Erro ao processar evento:", event.type, err);
    // Retornar 200 para evitar reenvios desnecessários do Stripe
    return NextResponse.json({ received: true, warning: "Processing error logged." });
  }
}
