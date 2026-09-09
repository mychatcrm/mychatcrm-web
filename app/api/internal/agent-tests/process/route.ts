import { NextResponse } from "next/server";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";
import { tickDueInternalLabRuns } from "@/lib/server/agent-test-lab/runs";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!verifyInternalApiRequest(request, { allowedSecrets: ["INTERNAL_API_TOKEN", "CRON_SECRET"] })) return NextResponse.json({ ok: false }, { status: 401 });
  const started = Date.now();
  try {
    const result = await tickDueInternalLabRuns();
    if (result.processed) await appendOperationalAuditEvent({ actorType: "worker", module: "agent.test_lab", action: "worker.tick", status: "completed",
      durationMs: Date.now() - started, metadata: { processed: result.processed } });
    return NextResponse.json({ ok: true, ...result });
  } catch {
    await appendOperationalAuditEvent({ actorType: "worker", module: "agent.test_lab", action: "worker.tick", status: "error",
      severity: "error", resultCode: "lab_worker_failed", durationMs: Date.now() - started });
    return NextResponse.json({ ok: false, code: "lab_worker_failed" }, { status: 503 });
  }
}
