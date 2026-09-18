/**
 * Busca de domínio para comprar connosco.
 *
 * Só consulta. A compra é um passo separado, com confirmação explícita: é
 * dinheiro do cliente, e um clique acidental que registra domínio por um ano
 * não tem como ser desfeito.
 */
import { NextResponse } from "next/server";
import { isDomainPurchaseEnabled } from "@/lib/landing/config";
import { requireLandingAccess } from "@/lib/server/landing-page-guard";
import { checkDomainAvailability } from "@/lib/server/landing-domains";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const guard = await requireLandingAccess({ manageOnly: true });
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) {
    return NextResponse.json({ suggestions: [], enabled: isDomainPurchaseEnabled() });
  }

  const result = await checkDomainAvailability({ query });

  return NextResponse.json(
    {
      suggestions: result.suggestions,
      /**
       * `enabled` diz se a consulta funciona; `purchaseEnabled` diz se o botão
       * de comprar aparece. São coisas diferentes: dá para consultar
       * disponibilidade antes de a compra automática estar ligada.
       */
      enabled: result.enabled,
      purchaseEnabled: isDomainPurchaseEnabled(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
