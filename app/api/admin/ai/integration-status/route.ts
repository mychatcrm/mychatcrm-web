import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { checkAdminIaRateLimit } from "@/lib/admin-ai-rate-limit";
import { getAiIntegrationStatus } from "@/lib/ai/admin-integration-status";
import { logAdminIaDataPlaneIssue, surfacePostgrestForAdminUi } from "@/lib/server/admin-ia-data-plane-errors";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "ia")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }
  const rl = checkAdminIaRateLimit(session, "integration-status-get", 120, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: rl.message }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }

  try {
    const payload = await getAiIntegrationStatus();
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (e: unknown) {
    const raw = e instanceof Error ? e.message : "Erro ao ler estado da integração.";
    logAdminIaDataPlaneIssue("integration-status route", { message: raw, code: null });
    const surf = surfacePostgrestForAdminUi(raw, null);
    return NextResponse.json({ error: surf.headline }, { status: 502 });
  }
}
