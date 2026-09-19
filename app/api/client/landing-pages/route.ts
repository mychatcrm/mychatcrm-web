/**
 * Páginas de captura do tenant.
 *
 * GET  — lista, limite do plano, saldo de créditos e estado da configuração.
 * POST — cria a página a partir de um modelo (não gasta crédito: gerar gasta).
 */
// operational-audit: reconciled — recordLandingAudit (lib/server/landing-audit.ts) regista dinheiro, exposição pública e captação.
import { NextResponse } from "next/server";
import {
  isLandingModuleConfigured,
  isLandingPlatformSubdomainEnabled,
  landingPagesDomain,
  landingPublicUrl,
  landingWelcomeCredits,
} from "@/lib/landing/config";
import { slugifyLandingName, validateLandingSlug } from "@/lib/landing/slug";
import { PLATFORM_OWNER_TENANT_ID } from "@/lib/tenant-session-defaults";
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
import { recordLandingAudit } from "@/lib/server/landing-audit";
import {
  listTenantBillingEntitlements,
  sumTenantEntitlementQuantity,
} from "@/lib/server/billing-addons";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireLandingAccess();
  if (!guard.ok) return guard.response;
  const { session, sb, canManage } = guard;

  const [list, initialWallet, domains] = await Promise.all([
    listLandingPages({ tenantId: session.tenantId, client: sb }),
    getCreditWallet(session.tenantId, sb),
    listLandingDomains({ tenantId: session.tenantId, client: sb }),
  ]);

  /**
   * Crédito de boas-vindas só para quem nunca recebeu nada.
   *
   * A concessão é idempotente no banco, então chamá-la sempre seria correto —
   * mas somaria uma ida ao banco a cada carregamento da tela, para sempre, por
   * causa de algo que acontece uma vez na vida do tenant. `lifetimeGranted`
   * responde isso com o dado que já veio na leitura da carteira.
   */
  const welcomeAmount = landingWelcomeCredits();
  let wallet = initialWallet;
  if (welcomeAmount > 0 && wallet.available && wallet.lifetimeGranted === 0) {
    await ensureWelcomeCredits({
      tenantId: session.tenantId,
      amount: welcomeAmount,
      client: sb,
    });
    wallet = await getCreditWallet(session.tenantId, sb);
  }

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
      /**
       * Só a conta titular vê detalhe de infraestrutura. Um cliente pagante a
       * ler "aplique a migração no Supabase" no painel dele não aprende nada,
       * não pode agir, e fica com a impressão de produto inacabado.
       */
      platformOwner: session.tenantId === PLATFORM_OWNER_TENANT_ID,
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

  recordLandingAudit({
    tenantId: session.tenantId,
    actorId: landingActorLabel(session),
    action: "page_created",
    resourceId: created.page.id,
    metadata: { slug: created.page.slug, template: String(body.templateId ?? "direto") },
  });

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
