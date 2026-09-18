/**
 * Compra de pacote de créditos.
 *
 * Pagamento avulso (`mode: payment`), não assinatura: crédito não expira e não
 * renova sozinho. O saldo só entra na carteira quando o webhook confirmar o
 * pagamento — nunca aqui, porque a sessão de checkout pode ser abandonada.
 */
import { NextResponse } from "next/server";
import { SITE_URL } from "@/lib/constants";
import { findCreditPack } from "@/lib/credits/pricing";
import { getStripe, isStripeSecretConfigured } from "@/lib/stripe";
import { requireLandingAccess } from "@/lib/server/landing-page-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const guard = await requireLandingAccess({ manageOnly: true });
  if (!guard.ok) return guard.response;
  const { session } = guard;

  if (!isStripeSecretConfigured()) {
    return NextResponse.json(
      { error: "Pagamentos não configurados.", code: "STRIPE_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as { packCode?: unknown } | null;
  const pack = findCreditPack(body?.packCode);
  if (!pack) return NextResponse.json({ error: "Pacote inválido." }, { status: 400 });

  const priceId = process.env[pack.stripePriceEnvKey]?.trim();
  if (!priceId) {
    return NextResponse.json(
      {
        error: "Este pacote ainda não foi configurado pelo administrador.",
        code: "PRICE_NOT_CONFIGURED",
      },
      { status: 409 },
    );
  }

  try {
    const stripe = getStripe();
    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${SITE_URL}/dashboard/paginas?creditos=ok`,
      cancel_url: `${SITE_URL}/dashboard/paginas?creditos=cancelado`,
      client_reference_id: session.tenantId,
      /**
       * O webhook confia apenas nestes metadados para saber quanto creditar.
       * Ler a quantidade do preço no Stripe abriria divergência entre o que a
       * vitrine prometeu e o que o cliente recebeu.
       */
      metadata: {
        type: "credit_pack",
        tenant_id: session.tenantId,
        pack_code: pack.code,
        credits: String(pack.credits),
      },
    });

    if (!checkout.url) {
      return NextResponse.json({ error: "Não foi possível iniciar o pagamento." }, { status: 502 });
    }
    return NextResponse.json({ url: checkout.url, checkoutSessionId: checkout.id });
  } catch (error) {
    console.error("[client/credits/checkout]", error);
    return NextResponse.json({ error: "Não foi possível iniciar o pagamento." }, { status: 502 });
  }
}
