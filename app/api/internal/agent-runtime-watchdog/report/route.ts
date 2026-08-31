import { NextResponse } from "next/server";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MODES = new Set(["live", "test_failure", "test_repeat", "test_recovery"]);

function authorized(request: Request): boolean {
  const expected = process.env.AGENT_RUNTIME_WATCHDOG_SECRET?.trim();
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return Boolean(expected && received && expected.length >= 24 && received === expected);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const mode = typeof body.mode === "string" && MODES.has(body.mode) ? body.mode : "live";
  const phase = body.phase === "started" ? "started" : "completed";
  const healthy = body.healthy === true;
  const reasons = Array.isArray(body.reasonCodes)
    ? body.reasonCodes.filter((item: unknown) => typeof item === "string" && /^[a-z0-9_:-]{1,80}$/i.test(item)).slice(0, 10)
    : [];
  const isTest = mode.startsWith("test_");
  const action = mode.startsWith("test_") ? "test.completed" : `check.${phase}`;
  const result = await appendOperationalAuditEvent({
    actorType: "cron", actorId: "github-agent-runtime-watchdog",
    module: "runtime.watchdog", action,
    status: phase === "started" ? "running" : (isTest || healthy ? "completed" : "error"),
    severity: isTest || healthy ? "info" : "critical", critical: !isTest && !healthy,
    resourceType: "agent_runtime", resourceId: "global",
    durationMs: Number.isFinite(Number(body.durationMs)) ? Number(body.durationMs) : null,
    resultCode: healthy ? "runtime_healthy" : (reasons[0] ?? "runtime_unhealthy"),
    relatedIds: typeof body.runId === "string" ? { github_run_id: body.runId } : {},
    metadata: {
      mode, phase, isTest, httpStatus: Number(body.httpStatus) || null,
      reasonCodes: reasons, notification: typeof body.notification === "string" ? body.notification : null,
      notificationDelivered: body.notificationDelivered === true,
      repository: typeof body.repository === "string" ? body.repository : null,
    },
  }, { strict: true });
  return NextResponse.json({ ok: true, eventId: result?.eventId ?? null });
}
