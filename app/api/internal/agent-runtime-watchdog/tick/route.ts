import { NextResponse } from "next/server";
import { sanitizeAgentRuntimeHealth } from "@/lib/server/agent-runtime-health";
import { sendWatchdogEmailNotification, type WatchdogNotificationKind } from "@/lib/server/agent-runtime-watchdog-notifications";
import { AGENT_RUNTIME_WATCHDOG_TICK_PATH, verifySignedSchedulerRequest } from "@/lib/server/meta-scheduler-auth";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

type ProbeTransition = { notification?: WatchdogNotificationKind | null };

export async function POST(request: Request) {
  const startedAt = Date.now();
  const auth = verifySignedSchedulerRequest(request, AGENT_RUNTIME_WATCHDOG_TICK_PATH);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, code: auth.code }, { status: auth.status });
  }

  const operationId = auth.nonce;
  const baseEvent = {
    operationId,
    actorType: "cron" as const,
    actorId: "supabase-agent-runtime-watchdog",
    module: "runtime.watchdog",
    resourceType: "agent_runtime",
    resourceId: "global",
    relatedIds: { scheduler_nonce: auth.nonce },
    metadata: { source: "supabase_pg_cron", issuedAt: auth.issuedAt },
  };

  try {
    await appendOperationalAuditEvent({
      ...baseEvent,
      action: "check.started",
      status: "running",
      resultCode: "watchdog_started",
    }, { strict: true });

    const sb = createSupabaseServiceClient({ noStore: true });
    const { data, error } = await sb.rpc("get_agent_runtime_health_v1");
    if (error || !data) throw new Error(error?.code ?? "runtime_health_missing");
    const health = sanitizeAgentRuntimeHealth(data);
    const healthy = health.status === "healthy";
    const { data: transitionData, error: transitionError } = await sb.rpc(
      "record_agent_runtime_watchdog_probe_v1",
      { p_healthy: healthy, p_source: "supabase_pg_cron" },
    );
    if (transitionError) throw new Error(transitionError.code ?? "watchdog_transition_failed");

    const transition = (transitionData ?? {}) as ProbeTransition;
    const notification = transition.notification ?? null;
    const notificationResult = notification
      ? await sendWatchdogEmailNotification({ kind: notification, mode: "live", reasons: health.reasons })
      : { ok: true, code: "not_required" };

    await appendOperationalAuditEvent({
      ...baseEvent,
      action: "check.completed",
      status: healthy ? "completed" : "error",
      severity: healthy ? "info" : "critical",
      critical: !healthy,
      durationMs: Date.now() - startedAt,
      resultCode: healthy ? "runtime_healthy" : (health.reasons[0] ?? "runtime_unhealthy"),
      metadata: {
        ...baseEvent.metadata,
        reasonCodes: health.reasons,
        notification,
        emailNotification: notificationResult.code,
      },
    }, { strict: true });

    return NextResponse.json(
      { ok: healthy, status: health.status, reasons: health.reasons, notification, notificationDelivered: notificationResult.ok },
      { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 120) : "watchdog_tick_failed";
    await appendOperationalAuditEvent({
      ...baseEvent,
      action: "check.completed",
      status: "error",
      severity: "critical",
      critical: true,
      durationMs: Date.now() - startedAt,
      resultCode: code,
    }).catch(() => null);
    return NextResponse.json({ ok: false, code: "watchdog_tick_failed" }, { status: 503 });
  }
}
