import type { AgendaEventRow } from "@/lib/server/google-calendar-db";

export type ClientAgendaEvent = {
  id: string;
  title: string;
  startISO: string;
  endISO: string;
  allDay: boolean;
  description: string | null;
  location: string | null;
  color: string | null;
  googleEventId: string | null;
  status: string;
  attendeeName: string | null;
  attendeePhone: string | null;
  attendeeEmail: string | null;
  createdBy: string;
  calendarLabel?: string;
};

export function toClientAgendaEvent(row: AgendaEventRow): ClientAgendaEvent {
  return {
    id: row.id,
    title: row.title,
    startISO: row.start_at,
    endISO: row.end_at,
    allDay: row.all_day ?? false,
    description: row.description,
    location: row.location,
    color: row.color,
    googleEventId: row.google_event_id,
    status: row.status,
    attendeeName: row.attendee_name,
    attendeePhone: row.attendee_phone,
    attendeeEmail: row.attendee_email,
    createdBy: row.created_by,
    calendarLabel: row.google_event_id ? "Google Calendar" : "MyChatCRM",
  };
}
