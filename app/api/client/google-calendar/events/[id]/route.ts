import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { cancelGoogleCalendarEvent } from "@/lib/server/google-calendar";
import { cancelAgendaEvent, listAgendaEvents } from "@/lib/server/google-calendar-db";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const id = params.id?.trim();
  if (!id) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }
  const rows = await listAgendaEvents(session.tenantId);
  const row = rows.find((r) => r.id === id);
  if (!row) {
    return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
  }
  if (row.google_event_id) {
    try {
      await cancelGoogleCalendarEvent(session.tenantId, row.google_event_id);
    } catch (err) {
      console.warn("[google-calendar/events] cancel on Google failed", err);
    }
  }
  await cancelAgendaEvent(session.tenantId, id);
  return NextResponse.json({ ok: true });
}
