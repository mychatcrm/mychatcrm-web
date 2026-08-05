import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createBillingAddonCheckout, ensureExternalApiConnectorStripeCatalog } from "@/lib/server/billing-addons";
import { resolveOrganizationRole } from "@/lib/organization-role";

export const dynamic = "force-dynamic";

function responseForCheckoutError(error: unknown): NextResponse {
  const code = error instanceof Error ? error.message : "billing_addon_checkout_failed";
  const messages: Record<string, string> = {
    billing_addon_invalid_quantity: "Escolha uma quantidade válida.",
    billing_addon_not_available: "Esta capacidade adicional não está disponível no momento.",
    billing_addon_price_not_configured: "Esta capacidade adicional ainda não foi configurada pelo administrador.",
    billing_addon_price_inactive: "O preço desta capacidade adicional não está ativo no Stripe.",
    billing_addon_price_product_mismatch: "A configuração comercial desta capacidade adicional precisa ser revisada.",
    billing_addon_price_mode_mismatch: "A periodicidade desta capacidade adicional precisa ser revisada.",
  };
  const status = code === "billing_addon_invalid_quantity" ? 400 : code.startsWith("billing_addon_") ? 409 : 502;
  return NextResponse.json({ error: messages[code] ?? "Não foi possível iniciar a compra da capacidade adicional." }, { status });
}

/** Creates a Stripe Checkout only for an active, server-managed catalog item. */
export async function POST(request: Request) {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => null)) as { addonCode?: unknown; quantity?: unknown } | null;
  const addonCode = typeof body?.addonCode === "string" ? body.addonCode : "";
  const quantity = Number(body?.quantity);
  if (!addonCode.trim()) return NextResponse.json({ error: "Capacidade adicional inválida." }, { status: 400 });
  if (addonCode === "api_connector_recurring" && resolveOrganizationRole(guard.session) !== "owner") {
    return NextResponse.json({ error: "Apenas o titular pode contratar APIs adicionais." }, { status: 403 });
  }

  try {
    if (addonCode === "api_connector_recurring") await ensureExternalApiConnectorStripeCatalog();
    const checkout = await createBillingAddonCheckout({
      tenantId: guard.session.tenantId,
      addonCode,
      quantity,
      successPath: addonCode.includes("whatsapp") || addonCode.includes("api_connector") ? "/dashboard/integracoes" : "/dashboard/configuracoes",
      cancelPath: addonCode.includes("whatsapp") || addonCode.includes("api_connector") ? "/dashboard/integracoes" : "/dashboard/configuracoes",
    });
    return NextResponse.json({ url: checkout.url, checkoutSessionId: checkout.checkoutSessionId });
  } catch (error) {
    console.error("[client/billing/addons/checkout] create", error);
    return responseForCheckoutError(error);
  }
}
