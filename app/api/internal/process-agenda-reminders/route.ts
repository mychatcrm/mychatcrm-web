import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { processDueAgendaReminderJobs } from "@/lib/server/agenda-reminder-jobs";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";
import { AGENDA_REMINDER_SCHEDULER_PATH, verifySignedSchedulerRequest } from "@/lib/server/meta-scheduler-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  console.info("[agenda-reminder-jobs]", {
    event: "process_called",
    route: "/api/internal/process-agenda-reminders",
  });

  const bearerAuthorized = verifyInternalApiRequest(request, { allowedSecrets: ["INTERNAL_API_TOKEN", "CRON_SECRET"] });
  const signedAuth = bearerAuthorized ? null : verifySignedSchedulerRequest(request, AGENDA_REMINDER_SCHEDULER_PATH);
  if (!bearerAuthorized && !signedAuth?.ok) {
    console.info("[agenda-reminder-jobs]", { event: "auth_failed" });
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  if (signedAuth?.ok) {
    waitUntil(processDueAgendaReminderJobs({ batchSize: 8, deadlineMs: 45_000 }).catch((error) => {
      console.error("[agenda-reminder-v2] signed_process_failed", {
        error: error instanceof Error ? error.message : "process_failed",
      });
    }));
    return NextResponse.json({ ok: true, accepted: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const result = await processDueAgendaReminderJobs({ batchSize: 8, deadlineMs: 45_000 });
    console.info("[agenda-reminder-jobs]", { event: "process_complete", ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[agenda-reminder-jobs]", {
      event: "process_error",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
