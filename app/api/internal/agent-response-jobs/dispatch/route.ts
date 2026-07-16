import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import {
  executeAgentResponseFallback,
  loadAgentResponseJob,
} from "@/lib/server/agent-response-fallback";
import { waitAndProcessAgentResponseJob } from "@/lib/server/agent-response-jobs";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function processDispatchedJob(jobId: string): Promise<void> {
  const outcome = await waitAndProcessAgentResponseJob(jobId);
  if (outcome !== "timeout" && outcome !== "failed") return;
  const sb = createSupabaseServiceClient();
  const job = await loadAgentResponseJob(sb, jobId);
  if (!job) return;
  await executeAgentResponseFallback({
    sb,
    job,
    reason: outcome === "timeout" ? "processor_timeout" : "job_failed",
  });
}

export async function POST(request: Request) {
  if (
    !verifyInternalApiRequest(request, {
      allowedSecrets: ["INTERNAL_API_TOKEN", "AGENT_RESPONSE_JOBS_SECRET", "CRON_SECRET"],
    })
  ) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const body = (await request.json().catch(() => ({}))) as { jobId?: unknown };
  const jobId =
    (typeof body.jobId === "string" && body.jobId.trim()) ||
    url.searchParams.get("jobId")?.trim() ||
    "";
  if (!jobId) {
    return NextResponse.json({ error: "jobId obrigatório" }, { status: 400 });
  }

  waitUntil(
    processDispatchedJob(jobId).catch((error) => {
      console.error("[agent-response-jobs]", {
        event: "dispatch_failed",
        job_id: jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    }),
  );
  return NextResponse.json({ ok: true, accepted: true, jobId }, { status: 202 });
}
