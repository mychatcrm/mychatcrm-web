import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import {
  canAccessPlatformMetricsApi,
  computePlatformMetrics,
  parsePlatformMetricsQuery,
} from "@/lib/admin-platform-metrics";
import { getAdminDataset } from "@/lib/admin-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  if (!canAccessPlatformMetricsApi(session.role)) {
    return NextResponse.json(
      { error: "Sem permissão para métricas consolidadas da plataforma." },
      { status: 403 },
    );
  }

  if (!hasAdminAccess(session, "dashboard")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const dataset = getAdminDataset(session);
  const { searchParams } = new URL(request.url);
  const query = parsePlatformMetricsQuery(searchParams, dataset.clients);
  const payload = computePlatformMetrics(dataset.clients, query);

  return NextResponse.json(payload, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
