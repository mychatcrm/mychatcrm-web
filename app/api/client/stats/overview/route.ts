/**
 * GET /api/client/stats/overview?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Retorna OverviewStats para o tenant autenticado.
 * Chamado pelo DashboardOverviewContent sempre que o filtro de data muda.
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { fetchOverviewStats } from "@/lib/server/dashboard-stats-query";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function formatDateISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export async function GET(req: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const rawFrom = searchParams.get("from");
  const rawTo = searchParams.get("to");

  // Fallback: últimos 7 dias
  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setDate(defaultFrom.getDate() - 6);

  const fromISO = rawFrom && ISO_DATE.test(rawFrom) ? rawFrom : formatDateISO(defaultFrom);
  const toISO = rawTo && ISO_DATE.test(rawTo) ? rawTo : formatDateISO(today);

  try {
    const sb = createSupabaseServiceClient();
    const stats = await fetchOverviewStats({
      sb,
      tenantId: session.tenantId,
      fromISO,
      toISO,
    });
    return NextResponse.json(stats);
  } catch (err) {
    console.error("[stats/overview] query failed:", err);
    return NextResponse.json({ error: "Erro ao carregar métricas" }, { status: 500 });
  }
}
