import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { checkAdminIaRateLimit } from "@/lib/admin-ai-rate-limit";
import { getAiUsageLimitsSnapshot } from "@/lib/ai/admin-metrics";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "ia")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }
  const rl = checkAdminIaRateLimit(session, "usage-limits-get", 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: rl.message }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }

  const snap = await getAiUsageLimitsSnapshot();
  if (snap.error) {
    return NextResponse.json({ rows: [], hint: snap.error }, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ rows: snap.rows }, { headers: { "Cache-Control": "no-store" } });
}
