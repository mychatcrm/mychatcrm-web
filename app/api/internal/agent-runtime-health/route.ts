import { NextResponse } from "next/server";
import {
  isAuthorizedAgentRuntimeHealthRequest,
  sanitizeAgentRuntimeHealth,
} from "@/lib/server/agent-runtime-health";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

type UnknownRecord = Record<string, unknown>;

function logHealth(event: UnknownRecord): void {
  console.log(JSON.stringify({
    scope: "agent-runtime-health",
    ...event,
  }));
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = request.headers.get("x-vercel-id") ?? null;
  const secretConfigured = Boolean(
    process.env.AGENT_RUNTIME_WATCHDOG_SECRET?.trim()
    || process.env.INTERNAL_API_TOKEN?.trim(),
  );

  if (!secretConfigured) {
    logHealth({ level: "error", event: "watchdog_secret_missing", requestId });
    return NextResponse.json(
      { ok: false, status: "unhealthy", reasons: ["watchdog_not_configured"] },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!isAuthorizedAgentRuntimeHealthRequest(request)) {
    logHealth({ level: "warning", event: "unauthorized", requestId });
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const sb = createSupabaseServiceClient();
    const { data, error } = await sb.rpc("get_agent_runtime_health_v1");
    if (error || !data) {
      logHealth({
        level: "error",
        event: "probe_failed",
        requestId,
        errorCode: error?.code ?? "empty_result",
        duration_ms: Date.now() - startedAt,
      });
      return NextResponse.json(
        { ok: false, status: "unhealthy", reasons: ["health_probe_failed"] },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    const health = sanitizeAgentRuntimeHealth(data);
    const healthy = health.status === "healthy";
    logHealth({
      level: healthy ? "info" : "error",
      event: "probe_completed",
      requestId,
      status: health.status,
      reasonCodes: health.reasons,
      duration_ms: Date.now() - startedAt,
    });
    return NextResponse.json(
      {
        ok: healthy,
        ...health,
        deploymentSha: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null,
      },
      {
        status: healthy ? 200 : 503,
        headers: {
          "Cache-Control": "no-store",
          "Server-Timing": `agent-runtime-health;dur=${Date.now() - startedAt}`,
        },
      },
    );
  } catch (error) {
    logHealth({
      level: "error",
      event: "probe_exception",
      requestId,
      errorCode: error instanceof Error ? error.name : "unknown",
      duration_ms: Date.now() - startedAt,
    });
    return NextResponse.json(
      { ok: false, status: "unhealthy", reasons: ["health_probe_failed"] },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
