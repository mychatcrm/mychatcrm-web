/**
 * Domínio próprio da página.
 *
 * POST liga um domínio que o cliente já tem (traz de onde quiser) e devolve os
 * registos exatos para ele copiar no registador. A verificação é um passo
 * separado — `POST .../domains/verify` — porque o DNS demora, e o cliente
 * precisa de poder voltar depois sem refazer nada.
 */
import { NextResponse } from "next/server";
import { requireLandingAccess } from "@/lib/server/landing-page-guard";
import { getLandingPage } from "@/lib/server/landing-pages-db";
import {
  attachExistingDomain,
  dnsRecordsForDomain,
  listLandingDomains,
  removeLandingDomain,
} from "@/lib/server/landing-domains";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireLandingAccess();
  if (!guard.ok) return guard.response;
  const { session, sb } = guard;

  const domains = await listLandingDomains({
    tenantId: session.tenantId,
    pageId: params.id,
    client: sb,
  });

  return NextResponse.json(
    {
      available: domains.available,
      domains: domains.domains.map((domain) => ({
        ...domain,
        records: dnsRecordsForDomain(domain),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

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
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const host = typeof body.host === "string" ? body.host : "";
  const attached = await attachExistingDomain({
    tenantId: session.tenantId,
    pageId: page.id,
    host,
    client: sb,
  });

  if (!attached.ok) {
    const status =
      attached.code === "taken" ? 409 : attached.code === "schema_missing" ? 503 : 400;
    return NextResponse.json({ error: attached.message, code: attached.code }, { status });
  }

  return NextResponse.json(
    { domain: attached.domain, records: attached.records },
    { status: 201 },
  );
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireLandingAccess({ manageOnly: true });
  if (!guard.ok) return guard.response;
  const { session, sb } = guard;

  const url = new URL(request.url);
  const domainId = url.searchParams.get("domainId")?.trim() ?? "";
  if (!domainId) {
    return NextResponse.json({ error: "Informe o domínio a remover." }, { status: 400 });
  }

  const page = await getLandingPage({ tenantId: session.tenantId, pageId: params.id, client: sb });
  if (!page) return NextResponse.json({ error: "Página não encontrada." }, { status: 404 });

  const ok = await removeLandingDomain({
    tenantId: session.tenantId,
    domainId,
    client: sb,
  });
  if (!ok) return NextResponse.json({ error: "Não foi possível remover." }, { status: 500 });
  return NextResponse.json({ removed: true });
}
