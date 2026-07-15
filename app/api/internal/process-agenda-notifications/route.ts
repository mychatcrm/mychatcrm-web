import { NextResponse } from "next/server";
import {
  processAgendaNotificationOutbox,
  reconcileAgendaOutboxDelivery,
  reconcileMissingAgendaNotifications,
} from "@/lib/server/agenda-notification-outbox";
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
    // 1) Recupera obrigações que a janela pós-commit possa ter perdido.
    const reconciled = await reconcileMissingAgendaNotifications({ maxAgeMinutes: 1440 });
    // 2) Reivindica e envia pendentes (claim transacional).
    const processed = await processAgendaNotificationOutbox({ limit: 50 });
    // 3) Promove entregues / devolve a retry conforme os webhooks de entrega.
    const delivery = await reconcileAgendaOutboxDelivery({ limit: 50 });
    console.info("[agenda-notification-outbox]", { event: "process_complete", reconciled, processed, delivery });
    return NextResponse.json({ ok: true, reconciled, processed, delivery });
  } catch (err) {
    console.error("[agenda-notification-outbox]", {
      event: "process_error",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
