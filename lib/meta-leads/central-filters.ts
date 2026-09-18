/**
 * Contrato único do super filtro da Central de Leads.
 *
 * O mesmo módulo roda no cliente (monta a query string, guarda filtros salvos,
 * reconstrói a partir da URL) e no servidor (lê a query string e vira SQL). Sem
 * isto os dois lados divergem no primeiro filtro novo — foi o que aconteceu com
 * o painel antigo, que filtrava só em memória sobre os últimos 1000 leads.
 */

export type MetaLeadArchivedFilter = "active" | "archived" | "all";
export type MetaLeadSortOrder = "recent" | "oldest";

/** Baldes do pipeline, iguais aos de `lib/meta-lead-event-status.ts`. */
export const META_LEAD_BUCKETS = ["novo", "ok", "sem_regra", "erro"] as const;
export type MetaLeadBucketFilter = (typeof META_LEAD_BUCKETS)[number];

export const META_LEAD_CRM_STATUSES = ["pending", "synced", "failed", "blocked"] as const;
export const META_LEAD_WA_STATUSES = ["pending", "sent", "failed", "blocked", "skipped"] as const;

/** Resultado comercial do lead (fase 3) — derivado do CRM, não do webhook. */
export const META_LEAD_OUTCOMES = [
  "sem_contato",
  "respondeu",
  "agendou",
  "ganho",
  "perdido",
] as const;
export type MetaLeadOutcomeFilter = (typeof META_LEAD_OUTCOMES)[number];

export type MetaLeadCentralFilters = {
  /** Dia local do tenant, `YYYY-MM-DD`, inclusivo. */
  from: string | null;
  to: string | null;
  /** IANA; define o que "dia" significa no filtro de data. */
  timezone: string;
  pageIds: string[];
  formIds: string[];
  campaignIds: string[];
  adsetIds: string[];
  adIds: string[];
  agentIds: string[];
  teamIds: string[];
  ownerEmployeeIds: string[];
  crmStatuses: string[];
  waStatuses: string[];
  buckets: MetaLeadBucketFilter[];
  outcomes: MetaLeadOutcomeFilter[];
  search: string;
  archived: MetaLeadArchivedFilter;
  sort: MetaLeadSortOrder;
};

export const DEFAULT_CENTRAL_TIMEZONE = "America/Sao_Paulo";

export const EMPTY_CENTRAL_FILTERS: MetaLeadCentralFilters = {
  from: null,
  to: null,
  timezone: DEFAULT_CENTRAL_TIMEZONE,
  pageIds: [],
  formIds: [],
  campaignIds: [],
  adsetIds: [],
  adIds: [],
  agentIds: [],
  teamIds: [],
  ownerEmployeeIds: [],
  crmStatuses: [],
  waStatuses: [],
  buckets: [],
  outcomes: [],
  search: "",
  archived: "active",
  sort: "recent",
};

const LIST_KEYS = [
  "pageIds",
  "formIds",
  "campaignIds",
  "adsetIds",
  "adIds",
  "agentIds",
  "teamIds",
  "ownerEmployeeIds",
  "crmStatuses",
  "waStatuses",
  "buckets",
  "outcomes",
] as const;

/** Nome curto na query string — URL de filtro precisa caber num WhatsApp. */
const PARAM_NAME: Record<(typeof LIST_KEYS)[number], string> = {
  pageIds: "pg",
  formIds: "fm",
  campaignIds: "cp",
  adsetIds: "as",
  adIds: "ad",
  agentIds: "ag",
  teamIds: "tm",
  ownerEmployeeIds: "ow",
  crmStatuses: "crm",
  waStatuses: "wa",
  buckets: "bk",
  outcomes: "rs",
};

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LIST_ITEMS = 50;
const MAX_ID_LENGTH = 128;
const MAX_SEARCH_LENGTH = 120;

function sanitizeIdList(raw: string | null | undefined, allowed?: readonly string[]): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (!value || value.length > MAX_ID_LENGTH) continue;
    if (allowed && !allowed.includes(value)) continue;
    seen.add(value);
    if (seen.size >= MAX_LIST_ITEMS) break;
  }
  return Array.from(seen);
}

function sanitizeDay(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value || !DAY_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

export function isValidTimezone(raw: unknown): raw is string {
  if (typeof raw !== "string" || !raw.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw.trim() });
    return true;
  } catch {
    return false;
  }
}

/** Lê os filtros da query string sem confiar em nada do que chega. */
export function parseCentralFilters(params: URLSearchParams): MetaLeadCentralFilters {
  const archivedRaw = params.get("arch");
  const archived: MetaLeadArchivedFilter =
    archivedRaw === "archived" || archivedRaw === "all" ? archivedRaw : "active";
  const timezoneRaw = params.get("tz");
  const search = (params.get("q") ?? "").trim().slice(0, MAX_SEARCH_LENGTH);

  const filters: MetaLeadCentralFilters = {
    ...EMPTY_CENTRAL_FILTERS,
    from: sanitizeDay(params.get("from")),
    to: sanitizeDay(params.get("to")),
    timezone: isValidTimezone(timezoneRaw) ? timezoneRaw.trim() : DEFAULT_CENTRAL_TIMEZONE,
    crmStatuses: sanitizeIdList(params.get(PARAM_NAME.crmStatuses), META_LEAD_CRM_STATUSES),
    waStatuses: sanitizeIdList(params.get(PARAM_NAME.waStatuses), META_LEAD_WA_STATUSES),
    buckets: sanitizeIdList(params.get(PARAM_NAME.buckets), META_LEAD_BUCKETS) as MetaLeadBucketFilter[],
    outcomes: sanitizeIdList(params.get(PARAM_NAME.outcomes), META_LEAD_OUTCOMES) as MetaLeadOutcomeFilter[],
    search,
    archived,
    sort: params.get("sort") === "oldest" ? "oldest" : "recent",
  };

  for (const key of LIST_KEYS) {
    if (key === "crmStatuses" || key === "waStatuses" || key === "buckets" || key === "outcomes") continue;
    filters[key] = sanitizeIdList(params.get(PARAM_NAME[key]));
  }

  // Período invertido é erro de digitação, não intenção — troca em vez de não devolver nada.
  if (filters.from && filters.to && filters.from > filters.to) {
    const swap = filters.from;
    filters.from = filters.to;
    filters.to = swap;
  }

  return filters;
}

/** Serializa para a URL (só o que não é padrão, para o link ficar curto). */
export function serializeCentralFilters(filters: MetaLeadCentralFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.timezone && filters.timezone !== DEFAULT_CENTRAL_TIMEZONE) params.set("tz", filters.timezone);
  for (const key of LIST_KEYS) {
    const values = filters[key];
    if (values.length > 0) params.set(PARAM_NAME[key], values.join(","));
  }
  if (filters.search.trim()) params.set("q", filters.search.trim());
  if (filters.archived !== "active") params.set("arch", filters.archived);
  if (filters.sort !== "recent") params.set("sort", filters.sort);
  return params;
}

/** Quantos recortes o utilizador ligou — alimenta o contador do botão "Filtros". */
export function countActiveCentralFilters(filters: MetaLeadCentralFilters): number {
  let count = 0;
  if (filters.from || filters.to) count += 1;
  for (const key of LIST_KEYS) {
    if (filters[key].length > 0) count += 1;
  }
  if (filters.search.trim()) count += 1;
  if (filters.archived !== "active") count += 1;
  return count;
}

export function hasAnyCentralFilter(filters: MetaLeadCentralFilters): boolean {
  return countActiveCentralFilters(filters) > 0;
}

// ── Datas: dia local do tenant → instante absoluto ────────────────────────────

function timezoneOffsetMs(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "NaN");
  const hour = value("hour");
  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    hour === 24 ? 0 : hour,
    value("minute"),
    value("second"),
  );
  return asUtc - instant.getTime();
}

/**
 * Converte um horário de parede no fuso do tenant para o instante absoluto.
 * Duas passagens resolvem o salto de horário de verão: a primeira estimativa
 * pode cair do lado errado da transição.
 */
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timezone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstGuess = new Date(naive - timezoneOffsetMs(new Date(naive), timezone));
  const secondOffset = timezoneOffsetMs(firstGuess, timezone);
  return new Date(naive - secondOffset);
}

/** `YYYY-MM-DD` no fuso do tenant → início do dia em ISO absoluto. */
export function zonedDayStartISO(day: string, timezone: string): string | null {
  if (!DAY_PATTERN.test(day)) return null;
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return null;
  return zonedWallTimeToUtc(year, month, date, 0, 0, 0, timezone).toISOString();
}

/** `YYYY-MM-DD` no fuso do tenant → instante logo após o fim do dia (exclusivo). */
export function zonedDayEndExclusiveISO(day: string, timezone: string): string | null {
  if (!DAY_PATTERN.test(day)) return null;
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return null;
  const nextDay = new Date(Date.UTC(year, month - 1, date + 1));
  return zonedWallTimeToUtc(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() + 1,
    nextDay.getUTCDate(),
    0,
    0,
    0,
    timezone,
  ).toISOString();
}

/** Dia local do tenant (`YYYY-MM-DD`) para um instante. */
export function zonedDayOf(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  return parts;
}

export type CentralDatePresetId = "hoje" | "ontem" | "7d" | "30d" | "mes" | "mes_anterior";

/** Presets do seletor de período, resolvidos no fuso do tenant. */
export function resolveDatePreset(
  preset: CentralDatePresetId,
  timezone: string,
  now = new Date(),
): { from: string; to: string } {
  const today = zonedDayOf(now, timezone);
  const [year, month, day] = today.split("-").map(Number);
  const shift = (days: number): string => {
    const shifted = new Date(Date.UTC(year, month - 1, day + days));
    return shifted.toISOString().slice(0, 10);
  };
  switch (preset) {
    case "hoje":
      return { from: today, to: today };
    case "ontem":
      return { from: shift(-1), to: shift(-1) };
    case "7d":
      return { from: shift(-6), to: today };
    case "30d":
      return { from: shift(-29), to: today };
    case "mes":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "mes_anterior": {
      const firstOfThisMonth = new Date(Date.UTC(year, month - 1, 1));
      const lastOfPrev = new Date(firstOfThisMonth.getTime() - 24 * 60 * 60 * 1000);
      const prevMonth = lastOfPrev.toISOString().slice(0, 7);
      return { from: `${prevMonth}-01`, to: lastOfPrev.toISOString().slice(0, 10) };
    }
  }
}
