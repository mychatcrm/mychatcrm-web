/**
 * Publicar e despublicar.
 *
 * Publicar não custa crédito de propósito: quem já pagou pela geração não pode
 * ter receio de colocar no ar, e voltar a uma versão anterior tem de ser de
 * graça — senão ninguém experimenta e o teste A/B morre antes de nascer.
 *
 * O limite do plano é conferido AQUI, não na criação: rascunho é ilimitado,
 * página publicada é que ocupa lugar.
 */
// operational-audit: reconciled — recordLandingAudit (lib/server/landing-audit.ts) regista dinheiro, exposição pública e captação.
import { NextResponse } from "next/server";
import { isLandingModuleConfigured, landingPublicUrl } from "@/lib/landing/config";
import { resolveLandingPageAllowance } from "@/lib/credits/pricing";
import {
  listTenantBillingEntitlements,
  sumTenantEntitlementQuantity,
} from "@/lib/server/billing-addons";
import { requireLandingAccess } from "@/lib/server/landing-page-guard";
import { recordLandingAudit } from "@/lib/server/landing-audit";
import {
  countPublishedLandingPages,
  getLandingPage,
  getLandingVersion,
  publishLandingPage,
  unpublishLandingPage,
} from "@/lib/server/landing-pages-db";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireLandingAccess({ manageOnly: true });
  if (!guard.ok) return guard.response;
  const { session, sb } = guard;

  if (!isLandingModuleConfigured()) {
    return NextResponse.json(
      {
        error: "Domínio das páginas ainda não configurado. Defina LANDING_PAGES_DOMAIN.",
        code: "NOT_CONFIGURED",
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
    body = {};
  }

  const versionId =
    typeof body.versionId === "string" && body.versionId.trim()
      ? body.versionId.trim()
      : page.draftVersionId;

  if (!versionId) {
    return NextResponse.json({ error: "Não há versão para publicar." }, { status: 400 });
  }

  const version = await getLandingVersion({ versionId, client: sb });
  if (!version || version.pageId !== page.id) {
    return NextResponse.json({ error: "Versão inválida para esta página." }, { status: 400 });
  }

  // Republicar a mesma página não ocupa um lugar novo.
  if (page.status !== "published") {
    const [publishedCount, entitlements] = await Promise.all([
      countPublishedLandingPages({ tenantId: session.tenantId, client: sb }),
      listTenantBillingEntitlements({ tenantId: session.tenantId, kind: "landing_page" }).catch(
        () => [],
      ),
    ]);

    const allowance = resolveLandingPageAllowance({
      plan: session.plan,
      extraEntitlements: sumTenantEntitlementQuantity(entitlements, "landing_page"),
      publishedCount,
    });

    if (allowance.remaining <= 0) {
      return NextResponse.json(
        {
          error: `O seu plano permite ${allowance.cap} página${allowance.cap === 1 ? "" : "s"} publicada${allowance.cap === 1 ? "" : "s"}. Despublique uma ou adicione páginas extra.`,
          code: "PAGE_LIMIT_REACHED",
          allowance,
        },
        { status: 402 },
      );
    }
  }

  const ok = await publishLandingPage({
    tenantId: session.tenantId,
    pageId: page.id,
    versionId,
    client: sb,
  });
  if (!ok) return NextResponse.json({ error: "Não foi possível publicar." }, { status: 500 });

  /**
   * Reconferência depois de publicar.
   *
   * A contagem e a publicação não são uma transação: duas abas a clicar ao
   * mesmo tempo leem ambas `publishedCount` antigo e passam ambas no limite.
   * Em vez de uma transação para um caso raro, conta-se outra vez depois —
   * quem excedeu volta atrás sozinho. O pior desfecho passa de "cliente com
   * página a mais de graça, para sempre" para "publicação recusada com a
   * mensagem certa".
   */
  if (page.status !== "published") {
    const depois = await countPublishedLandingPages({ tenantId: session.tenantId, client: sb });
    const entitlements = await listTenantBillingEntitlements({
      tenantId: session.tenantId,
      kind: "landing_page",
    }).catch(() => []);
    const allowance = resolveLandingPageAllowance({
      plan: session.plan,
      extraEntitlements: sumTenantEntitlementQuantity(entitlements, "landing_page"),
      publishedCount: depois,
    });

    if (depois > allowance.cap) {
      await unpublishLandingPage({ tenantId: session.tenantId, pageId: page.id, client: sb });
      return NextResponse.json(
        {
          error: `O seu plano permite ${allowance.cap} página${allowance.cap === 1 ? "" : "s"} publicada${allowance.cap === 1 ? "" : "s"}. Despublique uma ou adicione páginas extra.`,
          code: "PAGE_LIMIT_REACHED",
          allowance,
        },
        { status: 402 },
      );
    }
  }

  recordLandingAudit({
    tenantId: session.tenantId,
    action: "page_published",
    resourceId: page.id,
    metadata: { slug: page.slug, versionNo: version.versionNo },
  });

  return NextResponse.json({
    published: true,
    versionId,
    publicUrl: landingPublicUrl({ slug: page.slug }),
  });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireLandingAccess({ manageOnly: true });
  if (!guard.ok) return guard.response;
  const { session, sb } = guard;

  const page = await getLandingPage({ tenantId: session.tenantId, pageId: params.id, client: sb });
  if (!page) return NextResponse.json({ error: "Página não encontrada." }, { status: 404 });

  const ok = await unpublishLandingPage({
    tenantId: session.tenantId,
    pageId: page.id,
    client: sb,
  });
  if (!ok) return NextResponse.json({ error: "Não foi possível despublicar." }, { status: 500 });

  recordLandingAudit({
    tenantId: session.tenantId,
    action: "page_unpublished",
    resourceId: page.id,
    metadata: { slug: page.slug },
  });

  return NextResponse.json({ published: false });
}
