import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { processDueFollowUpJobs } from "@/lib/server/follow-up-jobs";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";
import {
  FOLLOW_UP_SCHEDULER_PATH,
  verifySignedSchedulerRequest,
} from "@/lib/server/meta-scheduler-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  return POST(request);
}

async function runFollowUpProcessing(): Promise<Record<string, unknown>> {
  try {
    const result = await processDueFollowUpJobs(undefined, { batchSize: 5, deadlineMs: 70_000 });

    console.info("[follow-up-jobs]", { event: "process_completed", ...result });
    return { ok: true, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "process_failed";
    console.error("[follow-up-jobs]", { event: "process_error", error: message });
    throw error;
  }
}

export async function POST(request: Request) {
  console.info("[follow-up-jobs]", { event: "process_called", route: FOLLOW_UP_SCHEDULER_PATH });

  const bearerAuthorized = verifyInternalApiRequest(request, {
    allowedSecrets: ["INTERNAL_API_TOKEN", "CRON_SECRET"],
  });
  const signedAuth = bearerAuthorized
    ? null
    : verifySignedSchedulerRequest(request, FOLLOW_UP_SCHEDULER_PATH);

  if (!bearerAuthorized && !signedAuth?.ok) {
    console.info("[follow-up-jobs]", {
      event: "auth_failed",
      reason: signedAuth?.code ?? "scheduler_signature_invalid",
    });
    return NextResponse.json(
      {
        error:
          signedAuth?.status === 503
            ? "Scheduler não configurado."
            : "Não autorizado",
      },
      { status: signedAuth?.status ?? 401 },
    );
  }

  // Supabase invokes this endpoint every minute. Acknowledge immediately and
  // let Vercel finish the durable claimed work in the background. Existing
  // bearer callers keep the synchronous response contract for operations and
  // the daily Vercel fallback.
  if (signedAuth?.ok) {
    waitUntil(
      runFollowUpProcessing().catch((error) => {
        console.error("[follow-up-jobs]", {
          event: "signed_process_failed",
          error: error instanceof Error ? error.message : "process_failed",
        });
      }),
    );
    return NextResponse.json(
      { ok: true, accepted: true },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    return NextResponse.json(await runFollowUpProcessing());
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "process_failed" },
      { status: 500 },
    );
  }
}
