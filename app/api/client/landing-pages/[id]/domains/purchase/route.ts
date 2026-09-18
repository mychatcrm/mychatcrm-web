/**
 * Compra do domínio pela plataforma.
 *
 * Exige `confirm: true` no corpo. Não é burocracia: um POST acidental aqui
 * registra um domínio por um ano e cobra por isso, e registo de domínio não se
 * desfaz. A interface tem de ter mostrado o preço e o nome exato antes.
 */
// operational-audit: reconciled — recordLandingAudit (lib/server/landing-audit.ts) regista dinheiro, exposição pública e captação.
import { NextResponse } from "next/server";
import { isDomainPurchaseEnabled } from "@/lib/landing/config";
import { requireLandingAccess } from "@/lib/server/landing-page-guard";
import { getLandingPage } from "@/lib/server/landing-pages-db";
import { recordLandingAudit } from "@/lib/server/landing-audit";
import { purchaseDomainForPage } from "@/lib/server/landing-domains";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireLandingAccess({ manageOnly: true });
  if (!guard.ok) return guard.response;
  const { session, sb } = guard;

  if (!isDomainPurchaseEnabled()) {
    return NextResponse.json(
      {
        error: "A compra de domínios ainda não está ligada nesta conta.",
        code: "PURCHASE_DISABLED",
      },
      { status: 503 },
    );
  }

  const page = await getLandingPage({ tenantId: session.tenantId, pageId: params.id, client: sb });
  if (!page) return NextResponse.json({ error: "Página não encontrada." }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  if (body.confirm !== true) {
    return NextResponse.json(
      { error: "Confirme a compra para continuar.", code: "CONFIRMATION_REQUIRED" },
      { status: 400 },
    );
  }

  const result = await purchaseDomainForPage({
    tenantId: session.tenantId,
    pageId: page.id,
    host: typeof body.host === "string" ? body.host : "",
    whoisProfileId: typeof body.whoisProfileId === "number" ? body.whoisProfileId : null,
    client: sb,
  });

  if (!result.ok) {
    const status =
      result.code === "disabled" ? 503 : result.code === "taken" ? 409 : result.code === "unavailable" ? 410 : 400;
    return NextResponse.json({ error: result.message, code: result.code }, { status });
  }

  recordLandingAudit({
    tenantId: session.tenantId,
    action: "domain_purchased",
    resourceId: page.id,
    critical: true,
    metadata: { host: result.domain.host, orderRef: result.orderRef ?? "" },
  });

  return NextResponse.json(
    { domain: result.domain, orderRef: result.orderRef, message: result.message },
    { status: 201 },
  );
}
