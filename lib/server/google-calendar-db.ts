import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type GoogleCalendarTokenRow = {
  tenant_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  email: string | null;
  updated_at?: string;
};

export type AgendaEventRow = {
  id: string;
  tenant_id: string;
  google_event_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  color: string | null;
  start_at: string;
  end_at: string;
  attendee_name: string | null;
  attendee_phone: string | null;
  attendee_email: string | null;
  status: "confirmed" | "cancelled" | "pending";
  created_by: "system" | "user" | "agent";
  created_at: string;
  updated_at: string;
};

export async function getGoogleCalendarToken(tenantId: string): Promise<GoogleCalendarTokenRow | null> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("google_calendar_tokens")
    .select("tenant_id, access_token, refresh_token, expires_at, email, updated_at")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw error;
  return (data as GoogleCalendarTokenRow | null) ?? null;
}

export async function upsertGoogleCalendarToken(row: GoogleCalendarTokenRow) {
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("google_calendar_tokens").upsert(
    {
      tenant_id: row.tenant_id,
      access_token: row.access_token,
      refresh_token: row.refresh_token,
      expires_at: row.expires_at,
      email: row.email,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error) throw error;
}

export async function deleteGoogleCalendarToken(tenantId: string) {
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("google_calendar_tokens").delete().eq("tenant_id", tenantId);
  if (error) throw error;
}

export async function listAgendaEvents(tenantId: string, fromIso?: string, toIso?: string): Promise<AgendaEventRow[]> {
  const sb = createSupabaseServiceClient();
  let q = sb
    .from("agenda_events")
    .select("*")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .order("start_at", { ascending: true });
  if (fromIso) q = q.gte("start_at", fromIso);
  if (toIso) q = q.lte("start_at", toIso);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AgendaEventRow[];
}

export async function insertAgendaEvent(
  row: Omit<AgendaEventRow, "id" | "created_at" | "updated_at"> & { id?: string },
): Promise<AgendaEventRow> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("agenda_events")
    .insert({
      ...row,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as AgendaEventRow;
}

export async function getAgendaEventById(tenantId: string, id: string): Promise<AgendaEventRow | null> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("agenda_events")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as AgendaEventRow | null) ?? null;
}

export async function updateAgendaEvent(
  tenantId: string,
  id: string,
  patch: Partial<
    Pick<
      AgendaEventRow,
      | "google_event_id"
      | "title"
      | "description"
      | "location"
      | "color"
      | "start_at"
      | "end_at"
      | "attendee_name"
      | "attendee_phone"
      | "attendee_email"
      | "status"
    >
  >,
) {
  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from("agenda_events")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", id);
  if (error) throw error;
}

export async function upsertAgendaEventFromGoogle(
  tenantId: string,
  event: {
    google_event_id: string;
    title: string;
    description: string | null;
    start_at: string;
    end_at: string;
    status: "confirmed" | "cancelled" | "pending";
  },
) {
  const sb = createSupabaseServiceClient();
  const { data: existing } = await sb
    .from("agenda_events")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("google_event_id", event.google_event_id)
    .maybeSingle();
  if (existing?.id) {
    await updateAgendaEvent(tenantId, existing.id as string, event);
    return existing.id as string;
  }
  const inserted = await insertAgendaEvent({
    tenant_id: tenantId,
    google_event_id: event.google_event_id,
    title: event.title,
    description: event.description,
    location: null,
    color: "#f24400",
    start_at: event.start_at,
    end_at: event.end_at,
    attendee_name: null,
    attendee_phone: null,
    attendee_email: null,
    status: event.status,
    created_by: "system",
  });
  return inserted.id;
}

export async function cancelAgendaEvent(tenantId: string, id: string) {
  await updateAgendaEvent(tenantId, id, { status: "cancelled" });
}

/** Remove eventos importados do Google (google_event_id preenchido). Mantém os criados só no MyChatCRM. */
export async function deleteGoogleSyncedAgendaEvents(tenantId: string): Promise<number> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("agenda_events")
    .delete()
    .eq("tenant_id", tenantId)
    .not("google_event_id", "is", null)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}
