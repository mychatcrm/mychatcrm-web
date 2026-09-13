import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";
import { AGENT_TEST_LAB_SCHEDULER_PATH, verifySignedSchedulerRequest } from "@/lib/server/meta-scheduler-auth";
import { tickDueLabRuns } from "@/lib/server/agent-test-lab/runs";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
// Vercel Cron uses GET; internal dispatchers may continue using POST.
export const GET = POST;
export async function POST(request: Request) {
  const bearerAuthorized = verifyInternalApiRequest(request, { allowedSecrets: ["INTERNAL_API_TOKEN", "CRON_SECRET"] });
  const signed = bearerAuthorized ? null : verifySignedSchedulerRequest(request, AGENT_TEST_LAB_SCHEDULER_PATH);
  if (!bearerAuthorized && (!signed?.ok || new URL(request.url).search)) {
    const status = signed && !signed.ok ? signed.status : 401;
    return NextResponse.json({ ok: false }, { status });
  }
  const started = Date.now();
  const execute = async () => {
    try {
      const result = await tickDueLabRuns();
      if (signed?.ok || result.processed) await appendOperationalAuditEvent({ operationId: signed?.ok ? signed.nonce : undefined,
        actorType: signed?.ok ? "cron" : "worker", module: "agent.test_lab", action: "worker.tick", status: "completed",
        durationMs: Date.now() - started, metadata: { processed: result.processed, failed: result.failed } });
      return result;
    } catch {
      await appendOperationalAuditEvent({ operationId: signed?.ok ? signed.nonce : undefined,
        actorType: signed?.ok ? "cron" : "worker", module: "agent.test_lab", action: "worker.tick", status: "error",
      severity: "error", resultCode: "lab_worker_failed", durationMs: Date.now() - started });
      throw new Error("lab_worker_failed");
    }
  };
  if (signed?.ok) {
    waitUntil(execute().catch(() => undefined));
    return NextResponse.json({ ok: true, accepted: true }, { status: 202 });
  }
  try { return NextResponse.json({ ok: true, ...(await execute()) }); }
  catch { return NextResponse.json({ ok: false, code: "lab_worker_failed" }, { status: 503 }); }
}
