/**
 * Páginas de captura do tenant.
 *
 * GET  — lista, limite do plano, saldo de créditos e estado da configuração.
 * POST — cria a página a partir de um modelo (não gasta crédito: gerar gasta).
 */
import { NextResponse } from "next/server";
import {
  isLandingModuleConfigured,
  isLandingPlatformSubdomainEnabled,
  landingPagesDomain,
  landingPublicUrl,
  landingWelcomeCredits,
} from "@/lib/landing/config";
import { slugifyLandingName, validateLandingSlug } from "@/lib/landing/slug";
import { LANDING_TEMPLATES } from "@/lib/landing/templates";
import { resolveLandingPageAllowance } from "@/lib/credits/pricing";
import { ensureWelcomeCredits, getCreditWallet } from "@/lib/server/credits";
import { landingActorLabel, requireLandingAccess } from "@/lib/server/landing-page-guard";
import {
  createLandingPage,
  listLandingPages,
  resolveAvailableSlug,
} from "@/lib/server/landing-pages-db";
import { listLandingDomains } from "@/lib/server/landing-domains";
import {
  listTenantBillingEntitlements,
  sumTenantEntitlementQuantity,
} from "@/lib/server/billing-addons";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireLandingAccess();
  if (!guard.ok) return guard.response;
  const { session, sb, canManage } = guard;

  // Antes de ler o saldo: senão o cliente vê zero na primeira visita e só na
  // segunda é que o crédito aparece.
  await ensureWelcomeCredits({
    tenantId: session.tenantId,
    amount: landingWelcomeCredits(),
    client: sb,
  });

  const [list, wallet, domains] = await Promise.all([
    listLandingPages({ tenantId: session.tenantId, client: sb }),
    getCreditWallet(session.tenantId, sb),
    listLandingDomains({ tenantId: session.tenantId, client: sb }),
  ]);

  const extra = await listTenantBillingEntitlements({
    tenantId: session.tenantId,
    kind: "landing_page",
  })
    .then((rows) => sumTenantEntitlementQuantity(rows, "landing_page"))
    .catch(() => 0);

  const allowance = resolveLandingPageAllowance({
    plan: session.plan,
    extraEntitlements: extra,
    publishedCount: list.publishedCount,
  });

  return NextResponse.json(
    {
      configured: isLandingModuleConfigured(),
      /** Endereço grátis só existe com o wildcard; domínio próprio funciona sem ele. */
      platformSubdomainEnabled: isLandingPlatformSubdomainEnabled(),
      pagesDomain: landingPagesDomain(),
      canManage,
      available: list.available,
      allowance,
      wallet,
      templates: LANDING_TEMPLATES.map(({ id, name, summary, bestFor }) => ({
        id,
        name,
        summary,
        bestFor,
      })),
      domains: domains.domains,
      pages: list.pages.map((page) => ({
        ...page,
        publicUrl: landingPublicUrl({
          slug: page.slug,
          host: domains.domains.find(
            (domain) => domain.id === page.primaryDomainId && domain.status === "active",
          )?.host ?? null,
        }),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const guard = await requireLandingAccess({ manageOnly: true });
  if (!guard.ok) return guard.response;
  const { session, sb } = guard;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2) {
    return NextResponse.json({ error: "Dê um nome à página." }, { status: 400 });
  }

  const requestedSlug = typeof body.slug === "string" && body.slug.trim()
    ? body.slug.trim()
    : slugifyLandingName(name);
  const slugCheck = validateLandingSlug(requestedSlug);
  if (!slugCheck.ok) {
    return NextResponse.json({ error: slugCheck.message, code: slugCheck.code }, { status: 400 });
  }

  // Slug pedido ocupado: em vez de erro, propõe o próximo livre.
  const slug = await resolveAvailableSlug({ base: slugCheck.slug, client: sb });
  if (!slug) {
    return NextResponse.json(
      { error: "Esse endereço já está em uso. Escolha outro." },
      { status: 409 },
    );
  }

  const created = await createLandingPage({
    tenantId: session.tenantId,
    name,
    slug,
    templateId: typeof body.templateId === "string" ? body.templateId : "direto",
    seed: {
      businessName: typeof body.businessName === "string" ? body.businessName : name,
      proposition: typeof body.proposition === "string" ? body.proposition : "",
      desiredAction:
        typeof body.desiredAction === "string" ? body.desiredAction : "falar com a nossa equipa",
      city: typeof body.city === "string" ? body.city : null,
    },
    ruleId: typeof body.ruleId === "string" ? body.ruleId : null,
    funnelId: typeof body.funnelId === "string" ? body.funnelId : null,
    columnId: typeof body.columnId === "string" ? body.columnId : null,
    createdBy: landingActorLabel(session),
    client: sb,
  });

  if (!created.ok) {
    const status = created.code === "schema_missing" ? 503 : created.code === "slug_taken" ? 409 : 400;
    return NextResponse.json({ error: created.message, code: created.code }, { status });
  }

  return NextResponse.json(
    {
      page: created.page,
      versionId: created.versionId,
      publicUrl: landingPublicUrl({ slug: created.page.slug }),
      slugChanged: slug !== slugCheck.slug,
    },
    { status: 201 },
  );
}
