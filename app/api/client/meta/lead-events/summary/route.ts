/**
 * POST /api/client/meta/lead-events/summary
 *
 * Leitura em português do desempenho do recorte atual.
 *
 * Os números são calculados aqui e entregues prontos ao modelo — ele
 * interpreta e prioriza, não conta. Modelo somando lead é modelo inventando
 * lead, e este painel é a base para o cliente decidir onde pôr dinheiro.
 */
// operational-audit: reconciled — leitura sem efeito; é POST só por causa do corpo do recorte.

import { NextRequest, NextResponse } from "next/server";
import { requireCentralAccess } from "@/lib/server/meta-lead-central-guard";
import { buildCampaignPerformance } from "@/lib/server/meta-lead-campaign-performance";
import { parseCentralFilters } from "@/lib/meta-leads/central-filters";
import { generateAIResponse } from "@/lib/ai/gateway";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_CAMPAIGNS_IN_PROMPT = 12;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await requireCentralAccess();
  if (!guard.ok) return guard.response;
  const { session, sb, scope, canSeeSpend } = guard;

  const filters = parseCentralFilters(new URL(req.url).searchParams);

  try {
    const performance = await buildCampaignPerformance({
      sb,
      tenantId: session.tenantId,
      scope,
      filters,
      includeSpend: canSeeSpend,
    });

    if (performance.rows.length === 0) {
      return NextResponse.json({ summary: "Ainda não há leads suficientes neste recorte para uma leitura." });
    }

    const showSpend = canSeeSpend && performance.spendAvailable;
    const table = performance.rows
      .slice(0, MAX_CAMPAIGNS_IN_PROMPT)
      .map((row) => {
        const base =
          `${row.campaignName}: ${row.leads} leads, ${row.responded} responderam, ` +
          `${row.scheduled} agendaram, ${row.won} fecharam` +
          (row.medianFirstReplyMinutes !== null
            ? `, 1ª resposta mediana ${row.medianFirstReplyMinutes} min`
            : "");
        return showSpend && row.spend !== null
          ? `${base}, investido R$ ${row.spend.toFixed(2)}, CPL R$ ${(row.costPerLead ?? 0).toFixed(2)}` +
              (row.costPerWon !== null ? `, custo por venda R$ ${row.costPerWon.toFixed(2)}` : "")
          : base;
      })
      .join("\n");

    const period =
      filters.from && filters.to ? `de ${filters.from} a ${filters.to}` : "do período carregado";

    const result = await generateAIResponse({
      tenantId: session.tenantId,
      agentId: "central-leads",
      feature: "lead_insights",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Você lê números de campanhas de anúncios para um gestor comercial brasileiro. " +
            "Responda em português do Brasil, no máximo 5 linhas curtas. " +
            "Use SOMENTE os números fornecidos — nunca estime, some ou invente valores. " +
            "Aponte a campanha que mais entrega resultado, a que mais preocupa e uma ação concreta. " +
            "Sem saudação, sem introdução, sem markdown.",
        },
        {
          role: "user",
          content: `Desempenho das campanhas ${period}:\n${table}\n\nTotais: ${performance.totals.leads} leads, ${performance.totals.responded} responderam, ${performance.totals.scheduled} agendaram, ${performance.totals.won} fecharam.`,
        },
      ],
    });

    if (!result.ok) {
      return NextResponse.json({ summary: null, error: "A leitura automática não está disponível agora." });
    }

    return NextResponse.json({ summary: result.text.trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error("[meta-lead-central] summary_failed", { tenant_id: session.tenantId, message });
    return NextResponse.json({ summary: null, error: "Não foi possível gerar a leitura." });
  }
}
