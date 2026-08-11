import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { loadIntegrationsDashboardSnapshot } from "@/lib/server/integrations-dashboard-snapshot";

export const dynamic = "force-dynamic";
export const preferredRegion = "gru1";

export async function GET(): Promise<NextResponse> {
  const startedAt = performance.now();
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;

  try {
    const snapshot = await loadIntegrationsDashboardSnapshot(guard.session);
    const durationMs = Math.round(performance.now() - startedAt);
    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "private, no-store",
        "Server-Timing": `bootstrap;dur=${durationMs}`,
      },
    });
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    console.error("[integrations-bootstrap] request_failed", {
      tenant_id: guard.session.tenantId,
      duration_ms: durationMs,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Não foi possível carregar as integrações agora." },
      { status: 503, headers: { "Cache-Control": "private, no-store", "Server-Timing": `bootstrap;dur=${durationMs}` } },
    );
  }
}
