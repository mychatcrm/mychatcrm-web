import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { disconnectGoogleCalendar, isGoogleCalendarConfigured } from "@/lib/server/google-calendar";
import { getGoogleCalendarToken } from "@/lib/server/google-calendar-db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const row = await getGoogleCalendarToken(session.tenantId);
  return NextResponse.json({
    configured: isGoogleCalendarConfigured(),
    connected: Boolean(row),
    email: row?.email ?? null,
    lastSyncISO: row?.updated_at ?? null,
  });
}

export async function DELETE() {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  await disconnectGoogleCalendar(session.tenantId);
  return NextResponse.json({ ok: true });
}
