import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { toClientAgendaEvent } from "@/lib/agenda/client-event";
import { broadcastAgendaChange } from "@/lib/server/agenda-realtime";
import { createGoogleCalendarEvent } from "@/lib/server/google-calendar";
import { insertAgendaEvent, listAgendaEvents } from "@/lib/server/google-calendar-db";

export const dynamic = "force-dynamic";

function buildDescription(body: {
  description?: string;
  meetLink?: string;
}) {
  const parts = [body.description?.trim(), body.meetLink?.trim() ? `Link: ${body.meetLink.trim()}` : ""].filter(Boolean);
  return parts.join("\n") || null;
}

export async function GET(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const url = new URL(request.url);
  const from = url.searchParams.get("from") || undefined;
  const to = url.searchParams.get("to") || undefined;
  const q = url.searchParams.get("q")?.trim().toLowerCase();
  let rows = await listAgendaEvents(session.tenantId, from, to);
  if (q) {
    rows = rows.filter((r) => r.title.toLowerCase().includes(q) || (r.location ?? "").toLowerCase().includes(q));
  }
  return NextResponse.json({ events: rows.map(toClientAgendaEvent) });
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
    location?: string;
    color?: string;
    attendeeEmail?: string;
    attendeeName?: string;
    attendeePhone?: string;
    syncToGoogle?: boolean;
    meetLink?: string;
    notifyWa?: boolean;
    allDay?: boolean;
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

  const description = buildDescription(body);
  const location = body.location?.trim() || null;
  const color = body.color?.trim() || "#f24400";

  let googleEventId: string | null = null;
  if (body.syncToGoogle !== false) {
    try {
      const g = await createGoogleCalendarEvent(session.tenantId, {
        title,
        description,
        location,
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
    description,
    location,
    color,
    start_at: startDate.toISOString(),
    end_at: endDate.toISOString(),
    all_day: body.allDay === true,
    attendee_name: body.attendeeName?.trim() || null,
    attendee_phone: body.attendeePhone?.trim() || null,
    attendee_email: body.attendeeEmail?.trim() || null,
    status: "confirmed",
    created_by: "user",
  });

  await broadcastAgendaChange(session.tenantId, "insert");
  return NextResponse.json({ event: toClientAgendaEvent(row), notifyWa: body.notifyWa === true });
}
