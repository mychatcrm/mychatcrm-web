/**
 * Detalhe, edição e arquivamento de uma página.
 *
 * DELETE arquiva, nunca apaga — mesma decisão de produto da Central de Leads.
 * Uma página apagada levaria junto o histórico de submissões que prova de onde
 * vieram os leads daquela campanha.
 */
import { NextResponse } from "next/server";
import { landingPublicUrl } from "@/lib/landing/config";
import { landingActorLabel, requireLandingAccess } from "@/lib/server/landing-page-guard";
import {
  archiveLandingPage,
  getLandingPage,
  getLandingVersion,
  listLandingVersions,
  updateLandingPageFields,
} from "@/lib/server/landing-pages-db";
import { dnsRecordsForDomain, listLandingDomains } from "@/lib/server/landing-domains";
import { summarizeLandingSubmissions } from "@/lib/server/landing-submission";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireLandingAccess();
  if (!guard.ok) return guard.response;
  const { session, sb, canManage } = guard;

  const page = await getLandingPage({ tenantId: session.tenantId, pageId: params.id, client: sb });
  if (!page) return NextResponse.json({ error: "Página não encontrada." }, { status: 404 });

  const [versions, domains, submissions, draft, published] = await Promise.all([
    listLandingVersions({ pageId: page.id, client: sb }),
    listLandingDomains({ tenantId: session.tenantId, pageId: page.id, client: sb }),
    summarizeLandingSubmissions({ tenantId: session.tenantId, pageId: page.id, client: sb }),
    page.draftVersionId ? getLandingVersion({ versionId: page.draftVersionId, client: sb }) : null,
    page.publishedVersionId
      ? getLandingVersion({ versionId: page.publishedVersionId, client: sb })
      : null,
  ]);

  const activeDomain = domains.domains.find((domain) => domain.status === "active");

  return NextResponse.json(
    {
      page,
      canManage,
      publicUrl: landingPublicUrl({ slug: page.slug, host: activeDomain?.host ?? null }),
      platformUrl: landingPublicUrl({ slug: page.slug }),
      draft,
      published,
      versions,
      domains: domains.domains.map((domain) => ({
        ...domain,
        records: dnsRecordsForDomain(domain),
      })),
      submissions: submissions.summary,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
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

  const patch: Parameters<typeof updateLandingPageFields>[0]["patch"] = {};
  if (typeof body.name === "string" && body.name.trim().length >= 2) patch.name = body.name;
  if ("ruleId" in body) patch.ruleId = typeof body.ruleId === "string" ? body.ruleId : null;
  if ("funnelId" in body) patch.funnelId = typeof body.funnelId === "string" ? body.funnelId : null;
  if ("columnId" in body) patch.columnId = typeof body.columnId === "string" ? body.columnId : null;
  if ("teamId" in body) patch.teamId = typeof body.teamId === "string" ? body.teamId : null;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
  }

  const ok = await updateLandingPageFields({
    tenantId: session.tenantId,
    pageId: page.id,
    patch,
    client: sb,
  });
  if (!ok) return NextResponse.json({ error: "Não foi possível atualizar." }, { status: 500 });

  const updated = await getLandingPage({ tenantId: session.tenantId, pageId: page.id, client: sb });
  return NextResponse.json({ page: updated });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireLandingAccess({ manageOnly: true });
  if (!guard.ok) return guard.response;
  const { session, sb } = guard;

  const page = await getLandingPage({ tenantId: session.tenantId, pageId: params.id, client: sb });
  if (!page) return NextResponse.json({ error: "Página não encontrada." }, { status: 404 });

  const ok = await archiveLandingPage({
    tenantId: session.tenantId,
    pageId: page.id,
    actor: landingActorLabel(session),
    client: sb,
  });
  if (!ok) return NextResponse.json({ error: "Não foi possível arquivar." }, { status: 500 });
  return NextResponse.json({ archived: true });
}
