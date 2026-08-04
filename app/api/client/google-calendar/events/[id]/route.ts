import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { applyAgendaCrmMove } from "@/lib/server/agenda-crm-move";
import { broadcastAgendaChange } from "@/lib/server/agenda-realtime";
import { toClientAgendaEvent } from "@/lib/agenda/client-event";
import { cancelGoogleCalendarEvent, updateGoogleCalendarEvent } from "@/lib/server/google-calendar";
import { cancelAgendaEvent, getAgendaEventById, updateAgendaEvent } from "@/lib/server/google-calendar-db";

export const dynamic = "force-dynamic";

function buildDescription(body: { description?: string; meetLink?: string }) {
  const parts = [body.description?.trim(), body.meetLink?.trim() ? `Link: ${body.meetLink.trim()}` : ""].filter(Boolean);
  return parts.join("\n") || null;
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const id = params.id?.trim();
  if (!id) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }
  const row = await getAgendaEventById(session.tenantId, id);
  if (!row) {
    return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
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
    meetLink?: string;
    syncToGoogle?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const title = body.title?.trim() || row.title;
  const startAt = body.startAt ? new Date(body.startAt) : new Date(row.start_at);
  const endAt = body.endAt ? new Date(body.endAt) : new Date(row.end_at);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return NextResponse.json({ error: "Datas inválidas." }, { status: 400 });
  }

  const description = body.description !== undefined || body.meetLink !== undefined ? buildDescription(body) : row.description;
  const location = body.location !== undefined ? body.location.trim() || null : row.location;
  const color = body.color?.trim() || row.color || "#f24400";
  const attendeeEmail = body.attendeeEmail !== undefined ? body.attendeeEmail.trim() || null : row.attendee_email;
  const attendeeName = body.attendeeName !== undefined ? body.attendeeName.trim() || null : row.attendee_name;
  const attendeePhone = body.attendeePhone !== undefined ? body.attendeePhone.trim() || null : row.attendee_phone;

  if (row.google_event_id && body.syncToGoogle !== false) {
    try {
      await updateGoogleCalendarEvent(session.tenantId, row.google_event_id, {
        title,
        description,
        location,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        attendeeEmail,
      });
    } catch (err) {
      console.warn("[google-calendar/events] update on Google failed", err);
    }
  }

  await updateAgendaEvent(session.tenantId, id, {
    title,
    description,
    location,
    color,
    start_at: startAt.toISOString(),
    end_at: endAt.toISOString(),
    attendee_email: attendeeEmail,
    attendee_name: attendeeName,
    attendee_phone: attendeePhone,
  });

  const updated = await getAgendaEventById(session.tenantId, id);
  await broadcastAgendaChange(session.tenantId, "update");
  return NextResponse.json({ event: updated ? toClientAgendaEvent(updated) : null });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const id = params.id?.trim();
  if (!id) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }
  const row = await getAgendaEventById(session.tenantId, id);
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
  // O card no CRM acompanha o estado real da agenda, não importa se o
  // cancelamento veio da conversa ou daqui. Nunca bloqueia o cancelamento.
  await applyAgendaCrmMove({
    sb: createSupabaseServiceClient(),
    tenantId: session.tenantId,
    action: "cancelled",
    agentId: row.agent_id,
    leadId: row.lead_id,
    attendeePhone: row.attendee_phone,
  }).catch(() => undefined);
  await broadcastAgendaChange(session.tenantId, "delete");
  return NextResponse.json({ ok: true });
}
