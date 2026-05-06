import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { checkAdminIaRateLimit } from "@/lib/admin-ai-rate-limit";
import { getAiTimeseries, parseAiRange } from "@/lib/ai/admin-metrics";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "ia")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }
  const rl = checkAdminIaRateLimit(session, "timeseries-get", 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: rl.message }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }

  const range = parseAiRange(new URL(request.url).searchParams);
  const series = await getAiTimeseries(range);
  return NextResponse.json({ meta: range, series }, { headers: { "Cache-Control": "no-store" } });
}
