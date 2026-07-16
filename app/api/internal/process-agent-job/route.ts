import { NextResponse } from "next/server";
import {
  executeAgentResponseFallback,
  loadAgentResponseJob,
} from "@/lib/server/agent-response-fallback";
import {
  processDueAgentResponseJobs,
  waitAndProcessAgentResponseJob,
} from "@/lib/server/agent-response-jobs";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function resolveJobId(request: Request): Promise<string | null> {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("jobId")?.trim();
  if (fromQuery) return fromQuery;
  try {
    const body = (await request.json()) as { jobId?: unknown };
    return typeof body.jobId === "string" && body.jobId.trim() ? body.jobId.trim() : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const jobId = await resolveJobId(request);

  console.info("[agent-response-jobs]", {
    event: "process_called",
    route: "/api/internal/process-agent-job",
    mode: jobId ? "wait_and_process" : "due_jobs",
    job_id: jobId ?? null,
  });

  if (
    !verifyInternalApiRequest(request, {
      allowedSecrets: ["INTERNAL_API_TOKEN", "AGENT_RESPONSE_JOBS_SECRET", "CRON_SECRET"],
    })
  ) {
    console.info("[agent-response-jobs]", { event: "auth_failed", route: "process-agent-job" });
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  console.info("[agent-response-jobs]", { event: "auth_ok", route: "process-agent-job" });

  try {
    if (jobId) {
      const outcome = await waitAndProcessAgentResponseJob(jobId);
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "process_failed";
    console.error("[agent-response-jobs]", { event: "process_error", error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
