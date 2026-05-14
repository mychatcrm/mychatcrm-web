import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { broadcastAgendaChange } from "@/lib/server/agenda-realtime";
import { disconnectGoogleCalendar, isGoogleCalendarConfigured } from "@/lib/server/google-calendar";
import { deleteGoogleSyncedAgendaEvents, getGoogleCalendarToken } from "@/lib/server/google-calendar-db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const row = await getGoogleCalendarToken(session.tenantId);
  return NextResponse.json({
    tenantId: session.tenantId,
    configured: isGoogleCalendarConfigured(),
    connected: Boolean(row),
    email: row?.email ?? null,
    lastSyncISO: row?.updated_at ?? null,
  });
}

export async function DELETE(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const clearEvents = new URL(request.url).searchParams.get("clearEvents") === "true";
  let deletedCount = 0;
  if (clearEvents) {
    deletedCount = await deleteGoogleSyncedAgendaEvents(session.tenantId);
    await broadcastAgendaChange(session.tenantId, "delete");
  }
  await disconnectGoogleCalendar(session.tenantId);
  return NextResponse.json({ ok: true, cleared: clearEvents, deletedCount });
}
