import { NextResponse } from "next/server";
import {
  processDueAgentResponseJobs,
  waitAndProcessAgentResponseJob,
} from "@/lib/server/agent-response-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function verifyInternalSecret(request: Request): boolean {
  const expected =
    process.env.AGENT_RESPONSE_JOBS_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
  if (!expected) return false;
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${expected}`) return true;
  const header = request.headers.get("x-agent-jobs-secret");
  return Boolean(header && header === expected);
}

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

  if (!verifyInternalSecret(request)) {
    console.info("[agent-response-jobs]", { event: "auth_failed" });
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  console.info("[agent-response-jobs]", { event: "auth_ok" });

  if (jobId) {
    await waitAndProcessAgentResponseJob(jobId);
    return NextResponse.json({ ok: true, mode: "wait_and_process", jobId });
  }

  const processed = await processDueAgentResponseJobs();
  return NextResponse.json({ ok: true, mode: "due_jobs", processed });
}
