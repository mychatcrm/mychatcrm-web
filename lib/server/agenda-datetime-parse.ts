import "server-only";

import { parseTimezone } from "@/lib/agents/agent-datetime";

type WallClock = { year: number; month: number; day: number; hour: number; minute: number };

const WEEKDAY_INDEX: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terca: 1,
  terça: 1,
  tercafeira: 1,
  terçafeira: 1,
  quarta: 2,
  quinta: 3,
  sexta: 4,
  sabado: 5,
  sábado: 5,
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

  if (/\bdepois de amanha\b/.test(normalized)) return addDays(today, 2);
  if (/\bamanha\b/.test(normalized)) return addDays(today, 1);
  if (/\bhoje\b/.test(normalized)) return { ...today };

  const inDays = normalized.match(/\b(?:daqui a|em|depois de)\s+(\d+)\s+dias?\b/);
  if (inDays) return addDays(today, Number(inDays[1]));

  if (/\bem alguns dias\b/.test(normalized)) return addDays(today, 3);

  const fullDate = normalized.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (fullDate) {
    const day = Number(fullDate[1]);
    const month = Number(fullDate[2]);
    const yearRaw = fullDate[3];
    const year = yearRaw
      ? Number(yearRaw.length === 2 ? `20${yearRaw}` : yearRaw)
      : today.year;
    return { year, month, day, hour: 9, minute: 0 };
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
    const wall: WallClock = { ...anchor, hour: anchor.hour ?? 9, minute: anchor.minute ?? 0 };
    const dt = localWallClockToUtc(wall, timeZone);
    if (!Number.isNaN(dt.getTime())) return dt;
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
  const inDays = normalized.match(/\b(?:daqui a|em|depois de)\s+(\d+)\s+dias?\b/);
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
