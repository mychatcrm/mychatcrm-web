import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { buildCommercialMetrics } from "@/lib/commercial/metrics";
import { buildCommercialStoreFromDb } from "@/lib/server/commercial-store-db";

export async function GET(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "parcerias")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const store = await buildCommercialStoreFromDb();
  const metrics = buildCommercialMetrics(store, from, to);
  return NextResponse.json(metrics);
}
