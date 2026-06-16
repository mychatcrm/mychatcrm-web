import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import {
  canAccessPlatformMetricsApi,
  computePlatformMetricsReal,
  parsePlatformMetricsQuery,
  resolvePlatformRanges,
  type AnalyticsExtras,
  type RealPlatformInput,
} from "@/lib/admin-platform-metrics";
import {
  fetchActiveIntegrationsByTenant,
  fetchAgentConversationsDaily,
  fetchAgentOriginShare,
  fetchAutomationsByTenant,
  fetchMessagesByTenant,
  fetchMessagesDailySeries,
  fetchRealMrrArr,
  fetchRealRevenue,
  fetchRealTenants,
  fetchSessionsByTenant,
  fetchTenantAcquisition,
  fetchTopAgents,
  fetchUsageByTenant,
  fetchUsageDailySeries,
  getUsdToBrlRate,
} from "@/lib/server/admin-platform-metrics-db";

export const dynamic = "force-dynamic";

function bucketAgentDistribution(tenants: { agentsTotal: number }[]): { faixa: string; totalClientes: number }[] {
  const buckets = { "0 agentes": 0, "1 agente": 0, "2–3 agentes": 0, "4+ agentes": 0 };
  for (const t of tenants) {
    if (t.agentsTotal <= 0) buckets["0 agentes"] += 1;
    else if (t.agentsTotal === 1) buckets["1 agente"] += 1;
    else if (t.agentsTotal <= 3) buckets["2–3 agentes"] += 1;
    else buckets["4+ agentes"] += 1;
  }
  return Object.entries(buckets)
    .filter(([, count]) => count > 0)
    .map(([faixa, totalClientes]) => ({ faixa, totalClientes }));
}

function normalizeToPercentBars(rows: { label: string; raw: number }[]): { label: string; value: number }[] {
  const max = Math.max(1, ...rows.map((r) => r.raw));
  return rows.map((r) => ({ label: r.label, value: Math.round((r.raw / max) * 100) }));
}

export async function GET(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  if (!canAccessPlatformMetricsApi(session.role)) {
    return NextResponse.json({ error: "Sem permissão para métricas consolidadas da plataforma." }, { status: 403 });
  }
  if (!hasAdminAccess(session, "dashboard")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const query = parsePlatformMetricsQuery(searchParams);
  const { from, to, prevFrom, prevTo } = resolvePlatformRanges(query.from, query.to);

  const fromISO = from.toISOString();
  const toISO = to.toISOString();
  const prevFromISO = prevFrom.toISOString();
  const prevToISO = prevTo.toISOString();
  const fromSec = Math.floor(from.getTime() / 1000);
  const toSec = Math.floor(to.getTime() / 1000);
  const prevFromSec = Math.floor(prevFrom.getTime() / 1000);
  const prevToSec = Math.floor(prevTo.getTime() / 1000);

  const [
    tenants,
    usageByTenant,
    prevUsageByTenant,
    messagesByTenant,
    prevMessagesByTenant,
    sessionsByTenant,
    integrationsByTenant,
    automationsByTenant,
    messagesDailySeries,
    usageDailySeries,
    mrrArr,
    revenueCurrent,
    revenuePrevious,
    acquisition,
    topAgentsRaw,
    agentOriginShare,
    agentConversationsDaily,
  ] = await Promise.all([
    fetchRealTenants(),
    fetchUsageByTenant(fromISO, toISO),
    fetchUsageByTenant(prevFromISO, prevToISO),
    fetchMessagesByTenant(fromISO, toISO),
    fetchMessagesByTenant(prevFromISO, prevToISO),
    fetchSessionsByTenant(fromISO, toISO),
    fetchActiveIntegrationsByTenant(),
    fetchAutomationsByTenant(fromISO, toISO),
    fetchMessagesDailySeries(fromISO, toISO),
    fetchUsageDailySeries(fromISO, toISO),
    fetchRealMrrArr(),
    fetchRealRevenue(fromSec, toSec),
    fetchRealRevenue(prevFromSec, prevToSec),
    fetchTenantAcquisition(fromISO, toISO),
    fetchTopAgents(fromISO, toISO),
    fetchAgentOriginShare(),
    fetchAgentConversationsDaily(fromISO, toISO),
  ]);

  void prevUsageByTenant; // reservado para futura comparação de tokens/custo período-a-período

  const prevMessagesTotal = Array.from(prevMessagesByTenant.values()).reduce((s, n) => s + n, 0);

  const revenueDailySeriesBrl = new Map<string, number>();
  for (const point of revenueCurrent.seriesDaily) {
    const netCents = Math.max(0, point.grossCents - point.refundedCents);
    revenueDailySeriesBrl.set(point.day, Math.round((netCents / 100) * 100) / 100);
  }

  const analyticsExtras: AnalyticsExtras = {
    acquisitionBars: normalizeToPercentBars(
      acquisition.map((a) => ({ label: `${a.bucket} (${a.count} novo${a.count === 1 ? "" : "s"})`, raw: a.count })),
    ),
    retentionBars: null,
    revenueBars: normalizeToPercentBars(
      Array.from(revenueDailySeriesBrl.entries()).map(([day, brl]) => ({
        label: `${day.slice(5)} (R$ ${brl.toFixed(2)})`,
        raw: brl,
      })),
    ),
    topAgents: topAgentsRaw.map((a) => ({
      nome: a.displayName,
      cliente: `Workspace · ${a.tenantId}`,
      conversasDia: a.conversasDia,
      origemPrincipal: a.origemPrincipal,
    })),
    agentDistribution: bucketAgentDistribution(tenants),
    agentOriginShare,
    agentConversationsDaily,
  };

  const input: RealPlatformInput = {
    tenants,
    usageByTenant,
    messagesByTenant,
    sessionsByTenant,
    integrationsByTenant,
    automationsByTenant,
    prevMessagesTotal,
    messagesDailySeries,
    usageDailySeries,
    revenueDailySeriesBrl,
    revenueCurrentNetCents: Math.max(0, revenueCurrent.kpis.grossChargesCents - revenueCurrent.kpis.totalRefundedCents),
    revenuePreviousNetCents: Math.max(0, revenuePrevious.kpis.grossChargesCents - revenuePrevious.kpis.totalRefundedCents),
    mrrCents: mrrArr.mrrCents,
    arrCents: mrrArr.arrCents,
    mrrByTenantCents: mrrArr.byTenantCents,
    usdToBrlRate: getUsdToBrlRate(),
    analyticsExtras,
  };

  const payload = computePlatformMetricsReal(input, query);

  return NextResponse.json(payload, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
