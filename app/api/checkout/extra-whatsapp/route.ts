import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { SITE_URL } from "@/lib/constants";
import {
  createBillingAddonCheckout,
  listActiveBillingAddons,
  toPublicBillingAddon,
} from "@/lib/server/billing-addons";
import { getExtraWhatsappSlots } from "@/lib/server/whatsapp-extra-slots-db";
import { serverWhatsAppSlotCapacity } from "@/lib/server/whatsapp-slot-server";

export const dynamic = "force-dynamic";

function getExtraWhatsAppPriceId(): string {
  const priceId = process.env.STRIPE_PRICE_EXTRA_WHATSAPP_MONTHLY?.trim();
  if (!priceId) throw new Error("[extra-whatsapp] STRIPE_PRICE_EXTRA_WHATSAPP_MONTHLY não definida.");
  return priceId;
}

/** GET — retorna quantos slots WhatsApp extras o tenant já comprou. */
export async function GET() {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  try {
    const extraSlots = await getExtraWhatsappSlots(session.tenantId);
    const totalSlots = serverWhatsAppSlotCapacity(session, extraSlots);
    let offer = null;
    try {
      const catalog = await listActiveBillingAddons("whatsapp_line");
      const configured =
        catalog.find((item) => item.code === "whatsapp_line_recurring") ??
        catalog.find((item) => item.billing_mode === "recurring") ??
        null;
      offer = configured ? toPublicBillingAddon(configured) : null;
    } catch (catalogError) {
      console.warn("[extra-whatsapp/GET] catalog unavailable", catalogError);
    }
    return NextResponse.json({
      extraSlots,
      totalSlots,
      includedLines: totalSlots - extraSlots,
      offer,
    });
  } catch (err) {
    console.error("[extra-whatsapp/GET] query failed:", err);
    return NextResponse.json({ extraSlots: 0, totalSlots: 2, includedLines: 2 });
  }
}

/** POST — cria sessão de checkout Stripe para slots WhatsApp extras.
 *  Body: { quantity: number } — mínimo 1, máximo 10.
 */
export async function POST(req: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  let quantity: number;
  try {
    const body = (await req.json()) as { quantity?: unknown };
    quantity = Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      return NextResponse.json({ error: "quantity deve ser um inteiro entre 1 e 10." }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  // New purchases use the admin-managed catalog. Keep the legacy Stripe Price
  // fallback only while existing tenants migrate their commercial settings.
  try {
    const checkout = await createBillingAddonCheckout({
      tenantId: session.tenantId,
      addonCode: "whatsapp_line_recurring",
      quantity,
      successPath: "/dashboard/integracoes",
      cancelPath: "/dashboard/integracoes",
    });
    return NextResponse.json({ url: checkout.url, checkoutSessionId: checkout.checkoutSessionId });
  } catch (catalogError) {
    const code = catalogError instanceof Error ? catalogError.message : "";
    if (![
      "billing_addon_not_available",
      "billing_addon_price_not_configured",
    ].includes(code)) {
      console.error("[extra-whatsapp/POST] catalog checkout error:", catalogError);
      return NextResponse.json({ error: "Erro ao criar sessão de checkout." }, { status: 500 });
    }

    let priceId: string;
    try {
      priceId = getExtraWhatsAppPriceId();
    } catch (err) {
      console.error(err);
      return NextResponse.json({ error: "Configuração de preço ausente. Contacte o suporte." }, { status: 500 });
    }

    try {
      const sb = createSupabaseServiceClient();
      const { data: sub } = await sb
        .from("stripe_subscriptions")
        .select("customer_id")
        .eq("tenant_id", session.tenantId)
        .maybeSingle();
      const stripeCustomerId = (sub?.customer_id as string | null) ?? undefined;

      const stripe = getStripe();
      const checkoutSession = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
        line_items: [{ price: priceId, quantity }],
        metadata: {
          tenant_id: session.tenantId,
          type: "extra_whatsapp",
          quantity: String(quantity),
        },
        subscription_data: {
          metadata: {
            tenant_id: session.tenantId,
            type: "extra_whatsapp",
            quantity: String(quantity),
          },
        },
        success_url: `${SITE_URL}/dashboard/integracoes`,
        cancel_url: `${SITE_URL}/dashboard/integracoes`,
      });

      return NextResponse.json({ url: checkoutSession.url });
    } catch (err) {
      console.error("[extra-whatsapp/POST] Stripe fallback error:", err);
      return NextResponse.json({ error: "Erro ao criar sessão de checkout." }, { status: 500 });
    }
  }
}
