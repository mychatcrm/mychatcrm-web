import { describe, expect, it } from "vitest";
import {
  addDaysInTimezone,
  parseRelativeDaysOffset,
  parseAppointmentDateTime,
} from "@/lib/server/agenda-datetime-parse";

describe("agenda relative dates", () => {
  const tz = "America/Sao_Paulo";
  const now = new Date("2026-06-02T15:00:00.000Z");

  it("parses em N dias offset", () => {
    expect(parseRelativeDaysOffset("quero remarcar para daqui a 3 dias")).toBe(3);
    expect(parseRelativeDaysOffset("daqui 3 dias")).toBe(3);
    expect(addDaysInTimezone(tz, 3, now)).toBe("05/06/2026");
  });

  it("parses em alguns dias as 3 days forward", () => {
    expect(parseRelativeDaysOffset("pode ser em alguns dias")).toBe(3);
    expect(addDaysInTimezone(tz, 3, now)).toBe("05/06/2026");
  });

  it("parseAppointmentDateTime resolves future date from relative phrase", () => {
    const dt = parseAppointmentDateTime({
      userMessage: "remarcar para daqui a 3 dias às 14:30",
      timezone: tz,
      now,
    });
    expect(dt).not.toBeNull();
    const isoDay = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(dt!);
    expect(isoDay).toBe("2026-06-05");
  });
});
