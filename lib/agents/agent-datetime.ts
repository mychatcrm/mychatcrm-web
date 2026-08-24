import type { Agent, AgentFollowUpInteligente } from "@/lib/types";

/**
 * Neutral computational fallback for code paths that do not perform a
 * time-dependent action. Agenda and business-hour follow-ups must call
 * `resolveExplicitAgentTimezone`/`isValidIanaTimezone` and fail closed when
 * the operator did not configure a timezone.
 */
const NEUTRAL_TIMEZONE = "UTC";

export function normalizeIanaTimezone(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const timezone = raw.trim();
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(0);
    return timezone;
  } catch {
    return null;
  }
}

export function isValidIanaTimezone(raw: unknown): raw is string {
  return normalizeIanaTimezone(raw) !== null;
}

/**
 * Backwards-compatible resolver for non-operational date context. It never
 * guesses a country: absent or invalid configuration resolves to UTC.
 */
export function parseTimezone(raw: unknown): string {
  return normalizeIanaTimezone(raw) ?? NEUTRAL_TIMEZONE;
}

export function resolveExplicitAgentTimezone(
  agent: Partial<Agent> & { followUpInteligente?: AgentFollowUpInteligente | null },
): string | null {
  const rootTimezone =
    typeof agent.timezone === "string" && agent.timezone.trim()
      ? agent.timezone
      : null;
  if (rootTimezone) return normalizeIanaTimezone(rootTimezone);
  return normalizeIanaTimezone(agent.followUpInteligente?.timezone);
}

export function resolveAgentTimezone(
  agent: Partial<Agent> & { followUpInteligente?: AgentFollowUpInteligente | null },
): string {
  return resolveExplicitAgentTimezone(agent) ?? NEUTRAL_TIMEZONE;
}

function formatDateTimeParts(timezone: string, now = new Date()) {
  const tz = parseTimezone(timezone);
  const formatter = new Intl.DateTimeFormat("en-US-u-nu-latn", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value?.trim() ?? "";

  return {
    tz,
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

/** Locale-neutral timestamp for technical runtime context. */
export function formatCurrentDateTimeLine(timezone: string, now = new Date()): string {
  const { tz, year, month, day, hour, minute } = formatDateTimeParts(timezone, now);
  return `Current date and time: ${year}-${month}-${day} ${hour}:${minute} (${tz})`;
}

/** Technical system context. It does not impose a customer-facing language. */
export function formatSystemDateTimeContextBlock(timezone: string, now = new Date()): string {
  const { tz, year, month, day, hour, minute } = formatDateTimeParts(timezone, now);
  return `[SYSTEM CONTEXT: Current date and time: ${year}-${month}-${day} ${hour}:${minute} (${tz}). Use this timestamp only as the temporal reference for date calculations.]`;
}
