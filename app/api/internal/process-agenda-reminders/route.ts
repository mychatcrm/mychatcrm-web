import { NextResponse } from "next/server";
import { processDueAgendaReminderJobs } from "@/lib/server/agenda-reminder-jobs";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";

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

  if (!verifyInternalApiRequest(request, { allowedSecrets: ["INTERNAL_API_TOKEN", "CRON_SECRET"] })) {
    console.info("[agenda-reminder-jobs]", { event: "auth_failed" });
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const result = await processDueAgendaReminderJobs({});
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
