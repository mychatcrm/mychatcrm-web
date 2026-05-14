import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createGoogleCalendarEvent } from "@/lib/server/google-calendar";
import { insertAgendaEvent, listAgendaEvents } from "@/lib/server/google-calendar-db";

export const dynamic = "force-dynamic";

function toClientEvent(row: Awaited<ReturnType<typeof listAgendaEvents>>[number]) {
  return {
    id: row.id,
    title: row.title,
    startISO: row.start_at,
    endISO: row.end_at,
    description: row.description,
    googleEventId: row.google_event_id,
    status: row.status,
    attendeeName: row.attendee_name,
    attendeePhone: row.attendee_phone,
    attendeeEmail: row.attendee_email,
    createdBy: row.created_by,
  };
}

export async function GET(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const url = new URL(request.url);
  const from = url.searchParams.get("from") || undefined;
  const to = url.searchParams.get("to") || undefined;
  const rows = await listAgendaEvents(session.tenantId, from, to);
  return NextResponse.json({ events: rows.map(toClientEvent) });
}

export async function POST(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  let body: {
    title?: string;
    startAt?: string;
    endAt?: string;
    description?: string;
    attendeeEmail?: string;
    attendeeName?: string;
    attendeePhone?: string;
    syncToGoogle?: boolean;
    kind?: string;
    meetLink?: string;
    notifyWa?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const title = body.title?.trim();
  const startAt = body.startAt?.trim();
  if (!title || !startAt) {
    return NextResponse.json({ error: "Informe título e início." }, { status: 400 });
  }
  const startDate = new Date(startAt);
  if (Number.isNaN(startDate.getTime())) {
    return NextResponse.json({ error: "Data de início inválida." }, { status: 400 });
  }
  const endDate = body.endAt ? new Date(body.endAt) : new Date(startDate.getTime() + 60 * 60 * 1000);
  if (Number.isNaN(endDate.getTime())) {
    return NextResponse.json({ error: "Data de fim inválida." }, { status: 400 });
  }

  const descriptionParts = [body.description?.trim(), body.kind ? `Tipo: ${body.kind}` : "", body.meetLink?.trim() ? `Link: ${body.meetLink.trim()}` : ""]
    .filter(Boolean)
    .join("\n");

  let googleEventId: string | null = null;
  if (body.syncToGoogle !== false) {
    try {
      const g = await createGoogleCalendarEvent(session.tenantId, {
        title,
        description: descriptionParts || null,
        startAt: startDate.toISOString(),
        endAt: endDate.toISOString(),
        attendeeEmail: body.attendeeEmail?.trim() || null,
      });
      googleEventId = g.id;
    } catch (err) {
      console.warn("[google-calendar/events] create on Google failed", err);
    }
  }

  const row = await insertAgendaEvent({
    tenant_id: session.tenantId,
    google_event_id: googleEventId,
    title,
    description: descriptionParts || null,
    start_at: startDate.toISOString(),
    end_at: endDate.toISOString(),
    attendee_name: body.attendeeName?.trim() || null,
    attendee_phone: body.attendeePhone?.trim() || null,
    attendee_email: body.attendeeEmail?.trim() || null,
    status: "confirmed",
    created_by: "user",
  });

  return NextResponse.json({ event: toClientEvent(row), notifyWa: body.notifyWa === true });
}
