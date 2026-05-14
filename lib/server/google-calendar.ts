import "server-only";

import {
  deleteGoogleCalendarToken,
  getGoogleCalendarToken,
  type GoogleCalendarTokenRow,
  upsertGoogleCalendarToken,
} from "@/lib/server/google-calendar-db";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export type GoogleCalendarConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function getGoogleCalendarConfig(): GoogleCalendarConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function isGoogleCalendarConfigured(): boolean {
  return getGoogleCalendarConfig() !== null;
}

export function buildGoogleOAuthUrl(state: string): string | null {
  const cfg = getGoogleCalendarConfig();
  if (!cfg) return null;
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
};

async function exchangeToken(body: URLSearchParams): Promise<TokenResponse> {
  const cfg = getGoogleCalendarConfig();
  if (!cfg) throw new Error("Google Calendar não configurado.");
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = (await res.json()) as TokenResponse;
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `Token exchange failed (${res.status})`);
  }
  return data;
}

export async function exchangeGoogleAuthCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  email: string | null;
}> {
  const cfg = getGoogleCalendarConfig();
  if (!cfg) throw new Error("Google Calendar não configurado.");
  const data = await exchangeToken(
    new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
    }),
  );
  if (!data.access_token || !data.refresh_token) {
    throw new Error("Resposta OAuth sem tokens válidos.");
  }
  const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();
  let email: string | null = null;
  try {
    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (userRes.ok) {
      const user = (await userRes.json()) as { email?: string };
      email = user.email?.trim() || null;
    }
  } catch {
    /* optional */
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
    email,
  };
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: string }> {
  const cfg = getGoogleCalendarConfig();
  if (!cfg) throw new Error("Google Calendar não configurado.");
  const data = await exchangeToken(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "refresh_token",
    }),
  );
  if (!data.access_token) throw new Error("Falha ao renovar token Google.");
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(),
  };
}

export async function getValidGoogleAccessToken(tenantId: string): Promise<string | null> {
  const row = await getGoogleCalendarToken(tenantId);
  if (!row) return null;
  const expiresMs = new Date(row.expires_at).getTime();
  if (expiresMs - Date.now() > 5 * 60 * 1000) return row.access_token;
  const refreshed = await refreshAccessToken(row.refresh_token);
  const next: GoogleCalendarTokenRow = {
    ...row,
    access_token: refreshed.accessToken,
    expires_at: refreshed.expiresAt,
  };
  await upsertGoogleCalendarToken(next);
  return refreshed.accessToken;
}

export async function disconnectGoogleCalendar(tenantId: string) {
  await deleteGoogleCalendarToken(tenantId);
}

export type GoogleCalendarEventInput = {
  title: string;
  description?: string | null;
  startAt: string;
  endAt: string;
  attendeeEmail?: string | null;
};

export type GoogleCalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  status: "confirmed" | "cancelled" | "pending";
  htmlLink?: string;
};

function mapGoogleEvent(item: Record<string, unknown>): GoogleCalendarEvent | null {
  const id = typeof item.id === "string" ? item.id : null;
  const summary = typeof item.summary === "string" ? item.summary : "Sem título";
  const description = typeof item.description === "string" ? item.description : null;
  const statusRaw = typeof item.status === "string" ? item.status : "confirmed";
  const status: GoogleCalendarEvent["status"] =
    statusRaw === "cancelled" ? "cancelled" : statusRaw === "tentative" ? "pending" : "confirmed";
  const startObj = item.start as { dateTime?: string; date?: string } | undefined;
  const endObj = item.end as { dateTime?: string; date?: string } | undefined;
  const startAt = startObj?.dateTime || (startObj?.date ? `${startObj.date}T00:00:00.000Z` : null);
  const endAt = endObj?.dateTime || (endObj?.date ? `${endObj.date}T23:59:59.000Z` : null);
  if (!id || !startAt || !endAt) return null;
  return {
    id,
    title: summary,
    description,
    startAt: new Date(startAt).toISOString(),
    endAt: new Date(endAt).toISOString(),
    status,
    htmlLink: typeof item.htmlLink === "string" ? item.htmlLink : undefined,
  };
}

export async function listGoogleCalendarEvents(
  tenantId: string,
  timeMin: string,
  timeMax: string,
): Promise<GoogleCalendarEvent[]> {
  const accessToken = await getValidGoogleAccessToken(tenantId);
  if (!accessToken) return [];
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const res = await fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Calendar list failed (${res.status}): ${err.slice(0, 200)}`);
  }
  const data = (await res.json()) as { items?: Record<string, unknown>[] };
  return (data.items ?? []).map(mapGoogleEvent).filter((e): e is GoogleCalendarEvent => e !== null);
}

export async function createGoogleCalendarEvent(
  tenantId: string,
  input: GoogleCalendarEventInput,
): Promise<GoogleCalendarEvent> {
  const accessToken = await getValidGoogleAccessToken(tenantId);
  if (!accessToken) throw new Error("Google Agenda não conectada.");
  const body: Record<string, unknown> = {
    summary: input.title,
    description: input.description ?? undefined,
    start: { dateTime: input.startAt, timeZone: "America/Sao_Paulo" },
    end: { dateTime: input.endAt, timeZone: "America/Sao_Paulo" },
  };
  if (input.attendeeEmail) {
    body.attendees = [{ email: input.attendeeEmail }];
  }
  const res = await fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Calendar create failed (${res.status}): ${err.slice(0, 200)}`);
  }
  const item = (await res.json()) as Record<string, unknown>;
  const mapped = mapGoogleEvent(item);
  if (!mapped) throw new Error("Resposta inválida ao criar evento no Google.");
  return mapped;
}

export async function cancelGoogleCalendarEvent(tenantId: string, googleEventId: string) {
  const accessToken = await getValidGoogleAccessToken(tenantId);
  if (!accessToken) throw new Error("Google Agenda não conectada.");
  const res = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/primary/events/${encodeURIComponent(googleEventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const err = await res.text();
    throw new Error(`Google Calendar delete failed (${res.status}): ${err.slice(0, 200)}`);
  }
}

export async function syncGoogleCalendarToDatabase(tenantId: string) {
  const now = new Date();
  const timeMin = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString();
  const events = await listGoogleCalendarEvents(tenantId, timeMin, timeMax);
  const { upsertAgendaEventFromGoogle } = await import("@/lib/server/google-calendar-db");
  for (const ev of events) {
    await upsertAgendaEventFromGoogle(tenantId, {
      google_event_id: ev.id,
      title: ev.title,
      description: ev.description,
      start_at: ev.startAt,
      end_at: ev.endAt,
      status: ev.status,
    });
  }
  return { synced: events.length, lastSyncISO: new Date().toISOString() };
}
