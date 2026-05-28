import type { Agent, AgentFollowUpInteligente } from "@/lib/types";

const VALID_IANA_RE = /^[A-Za-z]+(?:\/[A-Za-z_]+){0,2}$/;

export function parseTimezone(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "UTC";
  const tz = raw.trim();
  if (!VALID_IANA_RE.test(tz)) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

export function resolveAgentTimezone(
  agent: Partial<Agent> & { followUpInteligente?: AgentFollowUpInteligente | null },
): string {
  if (typeof agent.timezone === "string" && agent.timezone.trim()) {
    return parseTimezone(agent.timezone);
  }
  return parseTimezone(agent.followUpInteligente?.timezone);
}

function capitalizeFirst(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Linha injetada no system prompt com data/hora no fuso do agente. */
export function formatCurrentDateTimeLine(timezone: string, now = new Date()): string {
  const tz = parseTimezone(timezone);
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value?.trim() ?? "";

  const weekday = capitalizeFirst(get("weekday"));
  const day = get("day");
  const month = get("month");
  const year = get("year");
  const hour = get("hour");
  const minute = get("minute");

  return `Data e hora atual: ${weekday}, ${day} de ${month} de ${year}, ${hour}:${minute} (${tz})`;
}
