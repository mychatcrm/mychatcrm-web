/**
 * Verificação de posse do domínio.
 *
 * Confere o TXT, e só com ele batendo regista o domínio na hospedagem para o
 * certificado sair. Pode ser chamado quantas vezes o cliente quiser — o DNS
 * demora e ele vai clicar em "verificar" várias vezes.
 */
import { NextResponse } from "next/server";
import { requireLandingAccess } from "@/lib/server/landing-page-guard";
import { getLandingPage } from "@/lib/server/landing-pages-db";
import { verifyLandingDomain } from "@/lib/server/landing-domains";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireLandingAccess({ manageOnly: true });
  if (!guard.ok) return guard.response;
  const { session, sb } = guard;

  const page = await getLandingPage({ tenantId: session.tenantId, pageId: params.id, client: sb });
  if (!page) return NextResponse.json({ error: "Página não encontrada." }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const domainId = typeof body.domainId === "string" ? body.domainId.trim() : "";
  if (!domainId) {
    return NextResponse.json({ error: "Informe o domínio a verificar." }, { status: 400 });
  }

  const result = await verifyLandingDomain({
    tenantId: session.tenantId,
    domainId,
    client: sb,
  });

  return NextResponse.json(result, { status: result.verified ? 200 : 202 });
}
