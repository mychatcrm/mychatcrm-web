import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { verifySignedSchedulerRequest } from "@/lib/server/meta-scheduler-auth";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";
import {
  executeAgentResponseFallback,
  loadAgentResponseJob,
} from "@/lib/server/agent-response-fallback";
import {
  processDueAgentResponseJobs,
  waitAndProcessAgentResponseJob,
} from "@/lib/server/agent-response-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId")?.trim();
  console.info("[agent-response-jobs]", {
    event: "process_called",
    mode: jobId ? "wait_and_process" : "due_jobs",
    job_id: jobId ?? null,
  });

  const bearerAuthorized = verifyInternalApiRequest(request, {
      allowedSecrets: ["INTERNAL_API_TOKEN", "AGENT_RESPONSE_JOBS_SECRET", "CRON_SECRET"],
    });
  const signed = bearerAuthorized ? null : verifySignedSchedulerRequest(request, "/api/internal/agent-response-jobs/process");
  if (!bearerAuthorized && (!signed?.ok || url.search)) {
    console.info("[agent-response-jobs]", { event: "auth_failed" });
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  console.info("[agent-response-jobs]", { event: "auth_ok" });

  if (signed?.ok) {
    const started = Date.now();
    waitUntil((async () => {
      const audit = { operationId: signed.nonce, actorType: "cron" as const,
        module: "agent.response.recovery", resourceType: "agent_response_jobs", resourceId: "queue" };
      try {
        await appendOperationalAuditEvent({ ...audit, action: "run.started", status: "running" });
        const processed = await processDueAgentResponseJobs();
        await appendOperationalAuditEvent({ ...audit, action: "run.completed", status: "completed",
          durationMs: Date.now() - started, metadata: { processed } });
      } catch {
        await appendOperationalAuditEvent({ ...audit, action: "run.failed", status: "error",
          severity: "error", resultCode: "response_recovery_failed", durationMs: Date.now() - started });
      }
    })());
    return NextResponse.json({ ok: true, accepted: true }, { status: 202 });
  }

  if (jobId) {
    const outcome = await waitAndProcessAgentResponseJob(jobId, undefined, maxDuration * 1000);
    if (outcome === "timeout" || outcome === "failed") {
      const job = await loadAgentResponseJob(
        (await import("@/lib/supabase/server")).createSupabaseServiceClient(),
        jobId,
      );
      if (job) {
        await executeAgentResponseFallback({
          job,
          reason: outcome === "timeout" ? "processor_timeout" : "job_failed",
        });
      }
    }
    return NextResponse.json({ ok: true, mode: "wait_and_process", jobId, outcome });
  }

  const processed = await processDueAgentResponseJobs();
  return NextResponse.json({ ok: true, mode: "due_jobs", processed });
}
