import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";
import { assertLabUuid } from "@/lib/agent-test-lab/policy";
import { waitAndProcessLabRun, triggerLabRunProcessor } from "@/lib/server/agent-test-lab/dispatch";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (process.env.AGENT_TEST_LAB_ENABLED !== "true") return NextResponse.json({ ok: false, code: "lab_disabled" }, { status: 503 });
  if (!verifyInternalApiRequest(request, { allowedSecrets: ["INTERNAL_API_TOKEN", "CRON_SECRET"] })) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const started = Date.now();
  try {
    const body = await request.json().catch(() => ({}));
    const runId = assertLabUuid(typeof body.runId === "string" ? body.runId : "");
    // Acknowledge before doing work: the caller has an 8s deadline, whereas a
    // processing invocation may last 50s. Never report an accepted run as timeout.
    waitUntil((async () => {
    const outcome = await waitAndProcessLabRun(runId);
    // A run that is still open continues in a fresh invocation rather than
    // holding this one open for the whole conversation.
    if (outcome === "rescheduled") await triggerLabRunProcessor(runId);
    await appendOperationalAuditEvent({ actorType: "worker", module: "agent.test_lab", action: "dispatch.invocation",
      status: "completed", durationMs: Date.now() - started, resourceType: "agent_test_lab_run", resourceId: runId,
      resultCode: outcome, relatedIds: { runId } });
    })().catch(async () => {
      await appendOperationalAuditEvent({ actorType: "worker", module: "agent.test_lab", action: "dispatch.invocation",
        status: "error", severity: "error", resultCode: "lab_dispatch_failed", resourceId: runId });
    }));
    return NextResponse.json({ ok: true, outcome: "accepted" }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "lab_dispatch_failed";
    await appendOperationalAuditEvent({ actorType: "worker", module: "agent.test_lab", action: "dispatch.invocation",
      status: "error", severity: "error", resultCode: code, durationMs: Date.now() - started });
    return NextResponse.json({ ok: false, code }, { status: code === "invalid_identifier" ? 400 : 503 });
  }
}
