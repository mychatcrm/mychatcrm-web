/**
 * GET /api/client/meta/lead-events/performance
 *
 * Desempenho por campanha no recorte atual: leads, contato, resposta,
 * agendamento, fechamento e — só para o titular — investimento, CPL, custo por
 * agendamento e custo por venda.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireCentralAccess } from "@/lib/server/meta-lead-central-guard";
import { buildCampaignPerformance } from "@/lib/server/meta-lead-campaign-performance";
import { resolveLeadIdsForOutcomes } from "@/lib/server/meta-lead-outcome";
import { parseCentralFilters } from "@/lib/meta-leads/central-filters";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await requireCentralAccess();
  if (!guard.ok) return guard.response;
  const { session, sb, scope, canSeeSpend } = guard;

  const filters = parseCentralFilters(req.nextUrl.searchParams);

  try {
    const leadIdFilter = filters.outcomes.length
      ? await resolveLeadIdsForOutcomes({ sb, tenantId: session.tenantId, outcomes: filters.outcomes })
      : null;

    const result = await buildCampaignPerformance({
      sb,
      tenantId: session.tenantId,
      scope,
      filters,
      includeSpend: canSeeSpend,
      leadIdFilter,
    });

    return NextResponse.json(
      { ...result, canSeeSpend },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message.includes("PGRST205") || message.includes("42P01")) {
      return NextResponse.json({
        rows: [], totals: { leads: 0, responded: 0, scheduled: 0, won: 0, spend: null },
        spendAvailable: false, truncated: false, canSeeSpend,
      });
    }
    console.error("[meta-lead-central] performance_failed", { tenant_id: session.tenantId, message });
    return NextResponse.json({ error: "Não foi possível calcular o desempenho." }, { status: 500 });
  }
}
