import { NextResponse } from "next/server";
import { processAgendaNotificationOutbox } from "@/lib/server/agenda-notification-outbox";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  console.info("[agenda-notification-outbox]", {
    event: "process_called",
    route: "/api/internal/process-agenda-notifications",
  });

  if (!verifyInternalApiRequest(request)) {
    console.info("[agenda-notification-outbox]", { event: "auth_failed" });
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const result = await processAgendaNotificationOutbox({ limit: 50 });
    console.info("[agenda-notification-outbox]", { event: "process_complete", ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[agenda-notification-outbox]", {
      event: "process_error",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
