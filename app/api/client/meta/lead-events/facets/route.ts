/**
 * GET /api/client/meta/lead-events/facets
 *
 * Opções do super filtro com contagem, calculadas sobre o período escolhido e
 * não sobre a página visível — o painel antigo montava os selects a partir dos
 * leads já carregados, então campanha antiga nem aparecia como opção.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireCentralAccess } from "@/lib/server/meta-lead-central-guard";
import { loadCentralFacets } from "@/lib/server/meta-lead-central";
import { parseCentralFilters } from "@/lib/meta-leads/central-filters";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await requireCentralAccess();
  if (!guard.ok) return guard.response;
  const { session, sb, scope } = guard;

  const filters = parseCentralFilters(req.nextUrl.searchParams);

  try {
    const facets = await loadCentralFacets({ sb, tenantId: session.tenantId, scope, filters });
    return NextResponse.json(facets, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message.includes("PGRST205") || message.includes("42P01")) {
      return NextResponse.json({
        pages: [], forms: [], campaigns: [], adsets: [], ads: [], agents: [],
        sampled: 0, truncated: false,
      });
    }
    console.error("[meta-lead-central] facets_failed", { tenant_id: session.tenantId, message });
    return NextResponse.json({ error: "Não foi possível carregar os filtros." }, { status: 500 });
  }
}
