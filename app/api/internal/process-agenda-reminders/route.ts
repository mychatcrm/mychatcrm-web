import { NextResponse } from "next/server";
import { processDueAgendaReminderJobs } from "@/lib/server/agenda-reminder-jobs";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  if (!verifyInternalApiRequest(request)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const result = await processDueAgendaReminderJobs();
    console.info("[agenda-reminder-jobs]", { event: "process_completed", ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[agenda-reminder-jobs]", { event: "process_failed", error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
