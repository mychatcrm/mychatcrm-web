/**
 * POST /api/webhooks/stripe
 * Recebe eventos do Stripe e provisiona/suspende contas automaticamente.
 *
 * Configure o webhook no Stripe Dashboard apontando para:
 *   https://seudominio.com/api/webhooks/stripe
 *
 * Eventos necessários:
 *   - checkout.session.completed
 *   - customer.subscription.deleted
 *   - invoice.payment_failed
 */
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { provisionFromStripeSession, suspendTenant } from "@/lib/server/stripe-provision";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { sendTransactionalEmail } from "@/lib/server/resend-mail";

function getWebhookSecret(): string {
  const s = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!s) throw new Error("[stripe-webhook] STRIPE_WEBHOOK_SECRET não definida.");
  return s;
}

async function incrementExtraAgentPurchased(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const tenantId = session.metadata?.tenant_id;
  const qty = Number(session.metadata?.quantity ?? 1);
  if (!tenantId || !Number.isInteger(qty) || qty < 1) {
    console.error("[extra-agent] Metadata inválida:", session.metadata);
    return;
  }
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from("stripe_subscriptions")
    .select("extra_agents_purchased")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const current = (data?.extra_agents_purchased as number) ?? 0;
  const { error } = await sb
    .from("stripe_subscriptions")
    .update({ extra_agents_purchased: current + qty })
    .eq("tenant_id", tenantId);
  if (error) console.error("[extra-agent] Falha ao incrementar:", error);
}

async function incrementExtraWhatsAppSlots(session: Stripe.Checkout.Session): Promise<void> {
  const tenantId = session.metadata?.tenant_id;
  const qty = Number(session.metadata?.quantity ?? 1);
  if (!tenantId || !Number.isInteger(qty) || qty < 1) {
    console.error("[extra-whatsapp] Metadata inválida:", session.metadata);
    return;
  }
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from("stripe_subscriptions")
    .select("extra_whatsapp_slots")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const current = (data?.extra_whatsapp_slots as number) ?? 0;
  const { error } = await sb
    .from("stripe_subscriptions")
    .update({ extra_whatsapp_slots: current + qty })
    .eq("tenant_id", tenantId);
  if (error) console.error("[extra-whatsapp] Falha ao incrementar:", error);
}

/** Resolve tenant_id a partir do subscription_id do Stripe. */
async function getTenantIdBySubscriptionId(subscriptionId: string): Promise<string | null> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from("stripe_subscriptions")
    .select("tenant_id")
    .eq("subscription_id", subscriptionId)
    .maybeSingle();
  return (data?.tenant_id as string | null) ?? null;
}

/** Email do proprietário do tenant (para notificações de billing). */
async function getOwnerEmail(tenantId: string): Promise<string | null> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from("enterprise_provisions")
    .select("owner_email")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return (data?.owner_email as string | null) ?? null;
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
          if (session.metadata?.type === "extra_agent") {
            await incrementExtraAgentPurchased(session);
          } else if (session.metadata?.type === "extra_whatsapp") {
            await incrementExtraWhatsAppSlots(session);
          } else {
            await provisionFromStripeSession(session);
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const isExtraAgent = sub.metadata?.type === "extra_agent";

        if (isExtraAgent) {
          // Caso A — decrementar agentes extras comprados
          const tenantId = sub.metadata?.tenant_id;
          const qty = sub.items.data[0]?.quantity ?? 1;
          if (tenantId) {
            const sb = createSupabaseServiceClient();
            const { data } = await sb
              .from("stripe_subscriptions")
              .select("extra_agents_purchased")
              .eq("tenant_id", tenantId)
              .maybeSingle();
            const current = (data?.extra_agents_purchased as number) ?? 0;
            const { error } = await sb
              .from("stripe_subscriptions")
              .update({ extra_agents_purchased: Math.max(0, current - qty) })
              .eq("tenant_id", tenantId);
            if (error) console.error("[extra-agent-cancel] Falha ao decrementar:", error);
          }
        } else if (sub.metadata?.type === "extra_whatsapp") {
          // Caso A2 — decrementar slots WhatsApp extras
          const tenantId = sub.metadata?.tenant_id;
          const qty = sub.items.data[0]?.quantity ?? 1;
          if (tenantId) {
            const sb = createSupabaseServiceClient();
            const { data } = await sb
              .from("stripe_subscriptions")
              .select("extra_whatsapp_slots")
              .eq("tenant_id", tenantId)
              .maybeSingle();
            const current = (data?.extra_whatsapp_slots as number) ?? 0;
            const { error } = await sb
              .from("stripe_subscriptions")
              .update({ extra_whatsapp_slots: Math.max(0, current - qty) })
              .eq("tenant_id", tenantId);
            if (error) console.error("[extra-whatsapp-cancel] Falha ao decrementar:", error);
          }
        } else {
          // Caso B — suspender tenant (plano principal cancelado)
          const tenantId = await getTenantIdBySubscriptionId(sub.id);
          if (tenantId) {
            await suspendTenant(tenantId);
            console.log("[stripe-webhook] Tenant suspenso:", tenantId);
          } else {
            console.warn("[stripe-webhook] subscription.deleted sem tenant_id mapeado:", sub.id);
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        // Caso C — notificar proprietário; não suspender (Stripe vai tentar de novo)
        const invoice = event.data.object as Stripe.Invoice;
        const subDetails = invoice.parent?.subscription_details;
        const subId =
          typeof subDetails?.subscription === "string"
            ? subDetails.subscription
            : subDetails?.subscription?.id;
        if (!subId) break;

        const tenantId = await getTenantIdBySubscriptionId(subId);
        if (!tenantId) break;

        const ownerEmail = await getOwnerEmail(tenantId);
        if (ownerEmail) {
          await sendTransactionalEmail({
            to: ownerEmail,
            subject: "Problema com o pagamento da sua assinatura MyChatCRM",
            html: "<p>Não foi possível cobrar a sua assinatura MyChatCRM. Por favor, actualize o método de pagamento para manter o acesso.</p>",
            text: "Não foi possível cobrar a sua assinatura MyChatCRM. Por favor, actualize o método de pagamento para manter o acesso.",
          });
        }
        break;
      }

      case "customer.subscription.updated": {
        // TODO: suspender/reativar ao mudar plano (fora do escopo atual)
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
