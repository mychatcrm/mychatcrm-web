import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { getStripe } from "@/lib/stripe";
import { listBillingAddonCatalog } from "@/lib/server/billing-addons";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type CatalogInput = {
  id?: unknown;
  code?: unknown;
  title?: unknown;
  description?: unknown;
  kind?: unknown;
  billingMode?: unknown;
  includedQuantity?: unknown;
  stripePriceId?: unknown;
  stripeProductId?: unknown;
  amountCents?: unknown;
  currency?: unknown;
  intervalUnit?: unknown;
  createStripePrice?: unknown;
  active?: unknown;
};

function requireAdmin() {
  return getAdminSessionFromCookies();
}

function inputError(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function normalizedCode(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9][a-z0-9_-]{2,63}$/.test(code) ? code : null;
}

function productId(value: string | { id: string }): string {
  return typeof value === "string" ? value : value.id;
}

function normalizedCurrency(value: unknown): string | null {
  const currency = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z]{3}$/.test(currency) ? currency : null;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "planos")) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  try {
    return NextResponse.json({ addons: await listBillingAddonCatalog() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[admin/billing/addons] GET", error);
    return NextResponse.json({ error: "Não foi possível carregar o catálogo de capacidades." }, { status: 503 });
  }
}

async function saveCatalogItem(request: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "planos")) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });

  const input = (await request.json().catch(() => null)) as CatalogInput | null;
  if (!input) return inputError("Dados inválidos.");
  const code = normalizedCode(input.code);
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 120) : "";
  const description = typeof input.description === "string" ? input.description.trim().slice(0, 500) || null : null;
  const kind = input.kind === "whatsapp_line" || input.kind === "lead_capacity" || input.kind === "api_connector" ? input.kind : null;
  const billingMode = input.billingMode === "one_time" ? "one_time" : input.billingMode === "recurring" ? "recurring" : null;
  const includedQuantity = Number(input.includedQuantity);
  const active = input.active === true;
  const suppliedPriceId = typeof input.stripePriceId === "string" ? input.stripePriceId.trim() || null : null;
  const suppliedProductId = typeof input.stripeProductId === "string" ? input.stripeProductId.trim() || null : null;
  const createStripePrice = input.createStripePrice === true;
  const suppliedAmountCents = Number(input.amountCents);
  const suppliedCurrency = normalizedCurrency(input.currency) ?? "brl";
  const suppliedIntervalUnit = input.intervalUnit === "year" ? "year" : input.intervalUnit === "month" ? "month" : null;

  if (!code) return inputError("Use um código com letras minúsculas, números, hífen ou sublinhado.");
  if (!title) return inputError("Informe um nome para a capacidade adicional.");
  if (!kind || !billingMode) return inputError("Tipo ou cobrança inválidos.");
  if (!Number.isInteger(includedQuantity) || includedQuantity < 1 || includedQuantity > 1000000) {
    return inputError("A quantidade incluída deve ser um inteiro positivo.");
  }
  if (active && !suppliedPriceId && !createStripePrice) {
    return inputError("Selecione um Price Stripe ou crie um novo antes de ativar esta capacidade.");
  }

  let stripeProductId: string | null = null;
  let currency = "brl";
  let amountCents: number | null = null;
  let intervalUnit: "month" | "year" | null = null;
  let stripePriceId = suppliedPriceId;
  let createdStripePriceId: string | null = null;

  if (createStripePrice) {
    if (!Number.isInteger(suppliedAmountCents) || suppliedAmountCents < 1) {
      return inputError("Informe um valor positivo em centavos para criar o Price Stripe.");
    }
    if (billingMode === "recurring" && !suppliedIntervalUnit) {
      return inputError("Escolha cobrança mensal ou anual para criar uma capacidade recorrente.");
    }
    try {
      const stripe = getStripe();
      if (suppliedProductId) {
        const product = await stripe.products.retrieve(suppliedProductId);
        if (!product.active) return inputError("O produto Stripe selecionado está inativo.");
        stripeProductId = product.id;
      } else {
        const product = await stripe.products.create({
          name: title,
          description: description ?? undefined,
          metadata: {
            managed_by: "mychatcrm_billing_addon_catalog",
            addon_code: code,
            addon_kind: kind,
          },
        });
        stripeProductId = product.id;
      }
      const price = await stripe.prices.create({
        product: stripeProductId,
        currency: suppliedCurrency,
        unit_amount: suppliedAmountCents,
        ...(billingMode === "recurring" ? { recurring: { interval: suppliedIntervalUnit! } } : {}),
        metadata: {
          managed_by: "mychatcrm_billing_addon_catalog",
          addon_code: code,
        },
      });
      stripePriceId = price.id;
      createdStripePriceId = price.id;
      currency = price.currency || suppliedCurrency;
      amountCents = price.unit_amount ?? suppliedAmountCents;
      intervalUnit = price.recurring?.interval === "year" ? "year" : price.recurring?.interval === "month" ? "month" : null;
    } catch (error) {
      console.error("[admin/billing/addons] create Stripe product/price", error);
      return inputError("Não foi possível criar o produto/preço no Stripe.");
    }
  }

  if (stripePriceId && !createStripePrice) {
    try {
      const price = await getStripe().prices.retrieve(stripePriceId);
      if (!price.active) return inputError("O Price selecionado está inativo no Stripe.");
      const isRecurring = Boolean(price.recurring);
      if ((billingMode === "recurring") !== isRecurring) {
        return inputError("O tipo de cobrança não corresponde à periodicidade do Price no Stripe.");
      }
      stripeProductId = productId(price.product);
      currency = price.currency || "brl";
      amountCents = price.unit_amount ?? null;
      intervalUnit = price.recurring?.interval === "year" ? "year" : price.recurring?.interval === "month" ? "month" : null;
      if (billingMode === "recurring" && !intervalUnit) {
        return inputError("Use um Price Stripe mensal ou anual para uma capacidade recorrente.");
      }
    } catch (error) {
      console.error("[admin/billing/addons] Stripe price", error);
      return inputError("Não foi possível validar este Price no Stripe.");
    }
  }

  const sb = createSupabaseServiceClient();
  const payload = {
    code,
    title,
    description,
    kind,
    billing_mode: billingMode,
    included_quantity: includedQuantity,
    stripe_product_id: stripeProductId,
    stripe_price_id: stripePriceId,
    currency,
    amount_cents: amountCents,
    interval_unit: intervalUnit,
    active,
    metadata: { managed_by: "admin_catalog", updated_by: session.adminId },
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from("billing_addon_catalog").upsert(payload, { onConflict: "code" });
  if (error) {
    console.error("[admin/billing/addons] save", error.message);
    if (createdStripePriceId) {
      // A price is immutable in Stripe. If the database write failed, disable
      // the newly-created price so it cannot become an orphan purchasable item.
      await getStripe().prices.update(createdStripePriceId, { active: false }).catch((stripeError) => {
        console.error("[admin/billing/addons] rollback Stripe price", stripeError);
      });
    }
    return NextResponse.json({ error: "Não foi possível salvar esta capacidade adicional." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, stripePriceId, stripeProductId, createdStripePriceId });
}

export async function POST(request: Request) {
  return saveCatalogItem(request);
}

export async function PATCH(request: Request) {
  return saveCatalogItem(request);
}
