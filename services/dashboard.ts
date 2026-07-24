import type { ClientSession } from "@/lib/client-auth";
import { getDashboardDataset, type DashboardDataset, type DashboardRouteKey } from "@/lib/dashboard-data";
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
 *
 * O overviewStats (15 queries, uma delas até 10k linhas de whatsapp_messages)
 * SÓ é pré-carregado server-side quando a rota é o próprio Overview — que é o
 * único consumidor de `overviewStats`. Em qualquer outra rota (configuracoes,
 * agentes, disparos…) essas queries eram puro desperdício bloqueando o render,
 * a causa da lentidão percebida. Fora do Overview retornamos o dataset base
 * síncrono, sem tocar o banco. O Overview mantém o pré-load (sem flash) e, se
 * falhar, o próprio componente já faz o fetch client-side (fallback existente).
 */
export async function loadDashboardDataset(
  session: ClientSession,
  routeKey?: DashboardRouteKey,
): Promise<DashboardDataset> {
  const dataset = getDashboardDataset(session);

  if (routeKey !== "overview") {
    return dataset;
  }

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
