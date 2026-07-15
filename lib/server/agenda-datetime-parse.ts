import "server-only";

import { parseTimezone } from "@/lib/agents/agent-datetime";

type WallClock = { year: number; month: number; day: number; hour: number; minute: number };

/** Índices alinhados a Date.getUTCDay() (0=domingo … 6=sábado). */
const WEEKDAY_INDEX: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  segundafeira: 1,
  terca: 2,
  terça: 2,
  tercafeira: 2,
  terçafeira: 2,
  quarta: 3,
  quartafeira: 3,
  quinta: 4,
  quintafeira: 4,
  sexta: 5,
  sextafeira: 5,
  sabado: 6,
  sábado: 6,
};

function foldAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

const WORD_HOURS: Record<string, number> = {
  meia: 0,
  meio: 12,
  uma: 1,
  duas: 2,
  tres: 3,
  três: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
};

function getZonedParts(date: Date, timeZone: string): WallClock {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

/** Converte relógio local no fuso IANA para instante UTC. */
export function localWallClockToUtc(wall: WallClock, timeZone: string): Date {
  const utcGuess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0, 0);
  let guess = new Date(utcGuess);
  for (let i = 0; i < 3; i++) {
    const zoned = getZonedParts(guess, timeZone);
    const desiredMs = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
    const actualMs = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute);
    const diffMs = desiredMs - actualMs;
    if (diffMs === 0) break;
    guess = new Date(guess.getTime() + diffMs);
  }
  return guess;
}

function addDays(wall: WallClock, days: number): WallClock {
  const d = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days));
  return { ...wall, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function nextWeekday(from: WallClock, targetDow: number): WallClock {
  const fromUtc = new Date(Date.UTC(from.year, from.month - 1, from.day));
  const currentDow = fromUtc.getUTCDay();
  let delta = targetDow - currentDow;
  if (delta <= 0) delta += 7;
  return addDays(from, delta);
}

function startOfNextCalendarWeek(from: WallClock): WallClock {
  const fromUtc = new Date(Date.UTC(from.year, from.month - 1, from.day));
  const currentDow = fromUtc.getUTCDay();
  let daysUntilMonday = (8 - currentDow) % 7;
  if (daysUntilMonday === 0) daysUntilMonday = 7;
  return addDays(from, daysUntilMonday);
}

const MONTH_INDEX: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  março: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

function isWallDateBefore(a: WallClock, b: WallClock): boolean {
  if (a.year !== b.year) return a.year < b.year;
  if (a.month !== b.month) return a.month < b.month;
  return a.day < b.day;
}

function bumpToFutureDayMonth(day: number, month: number, year: number, today: WallClock): WallClock {
  let y = year;
  let m = month;
  let wall: WallClock = { year: y, month: m, day, hour: 0, minute: 0 };
  for (let attempt = 0; attempt < 24; attempt++) {
    if (!isWallDateBefore(wall, today)) return wall;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    wall = { year: y, month: m, day, hour: 0, minute: 0 };
  }
  return wall;
}

function parseWordHour(text: string): { hour: number; minute: number } | null {
  const m = text.match(
    /\b(uma|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|meia|meio)\b(?:\s*(?:e\s+)?meia)?(?:\s+da\s+(manh[ãa]|tarde|noite))?/i,
  );
  if (!m) return null;
  const word = m[1]!.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  let hour = WORD_HOURS[word] ?? WORD_HOURS[m[1]!.toLowerCase()] ?? null;
  if (hour == null) return null;
  const minute = /\bmeia\b/i.test(m[0]!) && !/^meia$/i.test(word) ? 30 : 0;
  const period = m[2]?.toLowerCase();
  if (period === "tarde" || period === "noite") {
    if (hour < 12) hour += 12;
  } else if (period === "manha" || period === "manhã") {
    if (hour === 12) hour = 0;
  }
  if (word === "meio" && !period) hour = 12;
  if (word === "meia" && !period) hour = 0;
  return { hour, minute };
}

function parseTimeFromText(text: string): { hour: number; minute: number } | null {
  const normalized = text.toLowerCase();

  if (/\bmeio[- ]?dia\b/.test(normalized)) return { hour: 12, minute: 0 };
  if (/\bmeia[- ]?noite\b/.test(normalized)) return { hour: 0, minute: 0 };

  const wordHour = parseWordHour(normalized);
  if (wordHour) return wordHour;

  const hColon = normalized.match(/\b(?:às|as|a)?\s*(\d{1,2})[:h](\d{2})\b/);
  if (hColon) return { hour: Number(hColon[1]), minute: Number(hColon[2]) };

  const hOnly = normalized.match(/\b(?:às|as|a)?\s*(\d{1,2})\s*h(?:\s*(\d{2}))?\b/);
  if (hOnly) return { hour: Number(hOnly[1]), minute: hOnly[2] ? Number(hOnly[2]) : 0 };

  const horas = normalized.match(/\b(\d{1,2})\s*horas?\b/);
  if (horas) return { hour: Number(horas[1]), minute: 0 };

  const atHour = normalized.match(/\b(?:às|as|a)\s+(\d{1,2})\b/);
  if (atHour) return { hour: Number(atHour[1]), minute: 0 };

  return null;
}

function parseDateAnchor(text: string, today: WallClock): WallClock | null {
  const normalized = foldAccents(text.toLowerCase());
  // Âncoras carregam apenas a DATA: a hora nunca é herdada do relógio atual.
  // Um fragmento sem horário explícito ("pode ser hoje as") não pode virar
  // "agora" — quem consome decide pedir a hora que falta.
  const base: WallClock = { ...today, hour: 0, minute: 0 };

  if (/\bdepois de amanha\b/.test(normalized)) return addDays(base, 2);
  if (/\bamanha\b/.test(normalized)) return addDays(base, 1);
  if (/\bhoje\b/.test(normalized)) return { ...base };

  const inDays = normalized.match(/\b(?:daqui\s*(?:a)?|em|depois de)\s+(\d+)\s+dias?\b/);
  if (inDays) return addDays(base, Number(inDays[1]));

  if (/\bem alguns dias\b/.test(normalized)) return addDays(base, 3);
  if (/\bsemana\s+que\s+vem\b/.test(normalized)) return startOfNextCalendarWeek(base);

  const fullDate = normalized.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (fullDate) {
    const day = Number(fullDate[1]);
    const month = Number(fullDate[2]);
    const yearRaw = fullDate[3];
    const year = yearRaw
      ? Number(yearRaw.length === 2 ? `20${yearRaw}` : yearRaw)
      : today.year;
    return bumpToFutureDayMonth(day, month, year, today);
  }

  const dayOnly = normalized.match(/\bdia\s+(\d{1,2})\b/);
  if (dayOnly) {
    const day = Number(dayOnly[1]);
    return bumpToFutureDayMonth(day, today.month, today.year, today);
  }

  for (const [monthName, monthNum] of Object.entries(MONTH_INDEX)) {
    const namedDayFirst = new RegExp(`\\b(\\d{1,2})\\s+de\\s+${monthName}\\b`, "i");
    const namedDaySecond = new RegExp(`\\b${monthName}\\s+(\\d{1,2})\\b`, "i");
    const m1 = normalized.match(namedDayFirst);
    const m2 = normalized.match(namedDaySecond);
    const day = m1 ? Number(m1[1]) : m2 ? Number(m2[1]) : null;
    if (day != null) {
      return bumpToFutureDayMonth(day, monthNum, today.year, today);
    }
  }

  for (const [name, dow] of Object.entries(WEEKDAY_INDEX)) {
    const re = new RegExp(`\\b(?:pr[oó]xim[ao]\\s+)?${name}(?:-feira)?\\b`, "i");
    if (re.test(normalized)) return nextWeekday(today, dow);
  }

  return null;
}

function parseDateTimeInText(text: string, today: WallClock, timeZone: string): Date | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const folded = foldAccents(trimmed.toLowerCase());
  const time = parseTimeFromText(folded);
  const anchor = parseDateAnchor(folded, today);

  if (anchor && time) {
    const wall: WallClock = { ...anchor, hour: time.hour, minute: time.minute };
    const dt = localWallClockToUtc(wall, timeZone);
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  if (anchor && !time) {
    // Data sem horário explícito NÃO produz datetime de mutação. Inventar uma
    // hora (o minuto atual ou um default) foi a causa do incidente
    // invalid_or_past_agenda_datetime — o fluxo deve pedir a hora que falta.
    return null;
  }

  if (!anchor && time) {
    let dayWall = { ...today };
    if (/\bamanha\b/.test(folded)) dayWall = addDays(today, 1);
    else if (/\bdepois de amanha\b/.test(folded)) dayWall = addDays(today, 2);
    const wall: WallClock = { ...dayWall, hour: time.hour, minute: time.minute };
    const dt = localWallClockToUtc(wall, timeZone);
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  return null;
}

export function parseRelativeDaysOffset(text: string): number | null {
  const normalized = foldAccents(text.trim().toLowerCase());
  if (!normalized) return null;
  const inDays = normalized.match(/\b(?:daqui\s*(?:a)?|em|depois de)\s+(\d+)\s+dias?\b/);
  if (inDays) return Number(inDays[1]);
  if (/\bem alguns dias\b/.test(normalized)) return 3;
  return null;
}

export function formatWallDate(wall: WallClock): string {
  return `${String(wall.day).padStart(2, "0")}/${String(wall.month).padStart(2, "0")}/${wall.year}`;
}

export function addDaysInTimezone(timezone: string, days: number, now = new Date()): string {
  const timeZone = parseTimezone(timezone);
  const today = getZonedParts(now, timeZone);
  return formatWallDate(addDays(today, days));
}

export function formatScheduleFieldsFromDate(
  dt: Date,
  timezone: string,
): { date: string; time: string } {
  const timeZone = parseTimezone(timezone);
  const zoned = getZonedParts(dt, timeZone);
  return {
    date: formatWallDate(zoned),
    time: `${String(zoned.hour).padStart(2, "0")}:${String(zoned.minute).padStart(2, "0")}`,
  };
}

/** Extrai DD/MM/AAAA e HH:MM de textos do cliente e/ou do assistente. */
export function resolveScheduleDateTimeFromText(params: {
  clientText?: string | null;
  assistantText?: string | null;
  timezone: string;
  now?: Date;
  fallbackDate?: string;
  fallbackTime?: string;
}): { date: string; time: string } | null {
  const client = params.clientText?.trim() ?? "";
  const assistant = params.assistantText?.trim() ?? "";

  const relativeDays = parseRelativeDaysOffset(client);
  if (relativeDays != null) {
    const date = addDaysInTimezone(params.timezone, relativeDays, params.now);
    const parsed = parseAppointmentDateTime({
      userMessage: client,
      assistantMessage: assistant,
      timezone: params.timezone,
      now: params.now,
    });
    if (parsed) {
      const fields = formatScheduleFieldsFromDate(parsed, params.timezone);
      return { date, time: fields.time };
    }
    if (params.fallbackTime) return { date, time: params.fallbackTime };
    return null;
  }

  const fromClient = client
    ? parseAppointmentDateTime({
        userMessage: client,
        assistantMessage: assistant,
        timezone: params.timezone,
        now: params.now,
      })
    : null;
  if (fromClient) return formatScheduleFieldsFromDate(fromClient, params.timezone);

  const fromAssistant = assistant
    ? parseAppointmentDateTime({
        userMessage: assistant,
        timezone: params.timezone,
        now: params.now,
      })
    : null;
  if (fromAssistant) return formatScheduleFieldsFromDate(fromAssistant, params.timezone);

  const directiveDate = assistant.match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
  const directiveTime = assistant.match(/\b(\d{2}:\d{2})\b/);
  if (directiveDate && directiveTime) {
    return { date: directiveDate[1]!, time: directiveTime[1]! };
  }

  if (params.fallbackDate && params.fallbackTime) {
    return { date: params.fallbackDate, time: params.fallbackTime };
  }

  return null;
}

export function parseAppointmentDateTime(params: {
  userMessage: string;
  assistantMessage?: string;
  timezone: string;
  now?: Date;
}): Date | null {
  const timeZone = parseTimezone(params.timezone);
  const now = params.now ?? new Date();
  const today = getZonedParts(now, timeZone);

  const userDt = parseDateTimeInText(params.userMessage, today, timeZone);
  if (userDt) return userDt;

  const assistant = params.assistantMessage?.trim();
  if (assistant) return parseDateTimeInText(assistant, today, timeZone);

  return null;
}
