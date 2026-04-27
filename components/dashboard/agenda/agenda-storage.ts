export type AgendaEventRecord = {
  id: string;
  title: string;
  startISO: string;
  endISO?: string;
  kind: string;
  meetLink?: string;
  notifyWa: boolean;
};

export type GoogleAgendaLinkState = {
  connected: boolean;
  lastSyncISO?: string;
  /** Texto exibido apos simular OAuth (producao vem da API). */
  accountLabel?: string;
};

export const AGENDA_EVENTS_UPDATED_EVENT = "mychatcrm-agenda-events-updated";

/** Chave `localStorage` dos eventos da agenda comercial (mesmo contrato em `AgendaHub`). */
export const AGENDA_EVENTS_LS_KEY = "mychatcrm.agenda.events.v1";

/** Chave `localStorage` da ligacao Google Agenda (partilhada por Agenda e Integracoes). */
export const GOOGLE_AGENDA_LS_KEY = "mychatcrm.agenda.google.v1";

export const GOOGLE_AGENDA_UPDATED_EVENT = "mychatcrm-google-agenda-updated";

const EVENTS_KEY = AGENDA_EVENTS_LS_KEY;
const GOOGLE_KEY = GOOGLE_AGENDA_LS_KEY;

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadAgendaEvents(): AgendaEventRecord[] {
  if (typeof window === "undefined") return [];
  const v = safeParse<unknown>(window.localStorage.getItem(EVENTS_KEY), []);
  return Array.isArray(v) ? (v as AgendaEventRecord[]) : [];
}

export function persistAgendaEvents(events: AgendaEventRecord[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
    window.dispatchEvent(new Event(AGENDA_EVENTS_UPDATED_EVENT));
  } catch {
    /* ignore */
  }
}

function normalizeGoogleAgendaState(data: unknown): GoogleAgendaLinkState {
  if (!data || typeof data !== "object") return { connected: false };
  const o = data as Record<string, unknown>;
  if (o.connected !== true) return { connected: false };
  const lastSyncISO =
    typeof o.lastSyncISO === "string" && !Number.isNaN(Date.parse(o.lastSyncISO)) ? o.lastSyncISO : undefined;
  const rawLabel = typeof o.accountLabel === "string" ? o.accountLabel.trim().slice(0, 120) : "";
  return {
    connected: true,
    lastSyncISO,
    accountLabel: rawLabel || undefined,
  };
}

export function loadGoogleAgendaState(): GoogleAgendaLinkState {
  if (typeof window === "undefined") return { connected: false };
  const raw = window.localStorage.getItem(GOOGLE_KEY);
  if (!raw) return { connected: false };
  try {
    return normalizeGoogleAgendaState(JSON.parse(raw) as unknown);
  } catch {
    return { connected: false };
  }
}

export function persistGoogleAgendaState(state: GoogleAgendaLinkState) {
  if (typeof window === "undefined") return;
  try {
    const clean = normalizeGoogleAgendaState(state);
    window.localStorage.setItem(GOOGLE_KEY, JSON.stringify(clean));
    window.dispatchEvent(new Event(GOOGLE_AGENDA_UPDATED_EVENT));
  } catch {
    /* ignore */
  }
}

export function seedDemoAgendaEvents(): AgendaEventRecord[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (day: number, h: number, min: number) =>
    `${y}-${pad(m + 1)}-${pad(day)}T${pad(h)}:${pad(min)}:00`;
  return [
    {
      id: "seed-1",
      title: "Demo Odonto Prime",
      startISO: iso(Math.min(d + 1, 28), 13, 30),
      kind: "demo",
      meetLink: "",
      notifyWa: true,
    },
    {
      id: "seed-2",
      title: "Follow-up Bella Estetica",
      startISO: iso(Math.min(d + 1, 28), 15, 0),
      kind: "follow-up",
      notifyWa: true,
    },
    {
      id: "seed-3",
      title: "Reuniao comercial",
      startISO: iso(Math.min(d + 2, 28), 9, 0),
      kind: "reuniao",
      meetLink: "",
      notifyWa: false,
    },
  ];
}
