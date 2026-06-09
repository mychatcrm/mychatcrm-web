import type { ClientSession } from "@/lib/client-auth";
import { getDashboardDataset, type DashboardDataset } from "@/lib/dashboard-data";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { fetchOverviewStats } from "@/lib/server/dashboard-stats-query";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function formatDateISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Carrega o dataset do dashboard com dados reais do Supabase.
 * O overviewStats é pré-carregado server-side para o range padrão (últimos 7 dias),
 * evitando flash de carregamento no primeiro render.
 * Se a query falhar (quota, erro de rede), retorna dataset sem overviewStats
 * e o client component faz o fetch por conta própria.
 */
export async function loadDashboardDataset(session: ClientSession): Promise<DashboardDataset> {
  const dataset = getDashboardDataset(session);

  try {
    const sb = createSupabaseServiceClient();
    const today = new Date();
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - 6); // 7 dias inclusive

    const overviewStats = await fetchOverviewStats({
      sb,
      tenantId: session.tenantId,
      fromISO: formatDateISO(fromDate),
      toISO: formatDateISO(today),
    });

    return { ...dataset, overviewStats };
  } catch (err) {
    // Fallback silencioso — o client vai carregar os dados via /api/client/stats/overview
    console.error("[dashboard] SSR stats failed, falling back to empty:", err);
    return dataset;
  }
}
