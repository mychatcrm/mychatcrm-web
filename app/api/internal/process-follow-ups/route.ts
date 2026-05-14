import { NextResponse } from "next/server";
import { processDueFollowUpJobs } from "@/lib/server/follow-up-jobs";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  console.info("[follow-up-jobs]", { event: "process_called", route: "/api/internal/process-follow-ups" });

  if (!verifyInternalApiRequest(request)) {
    console.info("[follow-up-jobs]", { event: "auth_failed" });
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const result = await processDueFollowUpJobs();
    console.info("[follow-up-jobs]", { event: "process_completed", ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "process_failed";
    console.error("[follow-up-jobs]", { event: "process_error", error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
