import { isValidIanaTimezone } from "@/lib/agents/agent-datetime";

/** Civil dates only: not availability, a preferred slot or business policy. */
export function buildAgendaCalendarFacts(timezone: string, now = new Date()): string | null {
  if (!isValidIanaTimezone(timezone) || !Number.isFinite(now.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => Number(parts.find(p => p.type === type)?.value);
  const civil = new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
  const days = Array.from({ length: 15 }, (_, offset) => {
    const day = new Date(civil);
    day.setUTCDate(day.getUTCDate() + offset);
    return { date: day.toISOString().slice(0, 10), weekday: day.getUTCDay(), offsetDays: offset };
  });
  return `CALENDAR FACTS (not availability or a maximum booking horizon): ${JSON.stringify({ timezone, weekdayConvention: "0=Sunday..6=Saturday", days })}`;
}
