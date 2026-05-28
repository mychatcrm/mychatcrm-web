import { describe, expect, it } from "vitest";
import { localWallClockToUtc, parseAppointmentDateTime } from "@/lib/server/agenda-datetime-parse";

describe("agenda-datetime-parse", () => {
  const tz = "America/Sao_Paulo";
  const now = new Date("2026-05-28T15:00:00.000Z");

  it("parses amanhã às 14h in agent timezone", () => {
    const dt = parseAppointmentDateTime({
      userMessage: "Confirmado, amanhã às 14h",
      timezone: tz,
      now,
    });
    expect(dt).not.toBeNull();
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(dt!);
    const get = (type: string) => parts.find((p) => p.type === type)?.value;
    expect(get("day")).toBe("29");
    expect(get("hour")).toBe("14");
    expect(get("minute")).toBe("00");
  });

  it("parses duas da tarde from assistant message", () => {
    const dt = parseAppointmentDateTime({
      userMessage: "sim",
      assistantMessage: "Perfeito, visita marcada para amanhã, duas da tarde no stand",
      timezone: tz,
      now,
    });
    expect(dt).not.toBeNull();
    const hour = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }).format(dt!);
    expect(hour).toBe("14");
  });

  it("parses depois de amanhã 10:30", () => {
    const dt = parseAppointmentDateTime({
      userMessage: "pode ser depois de amanhã 10:30",
      timezone: tz,
      now,
    });
    expect(dt).not.toBeNull();
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(dt!);
    const get = (type: string) => parts.find((p) => p.type === type)?.value;
    expect(get("day")).toBe("30");
    expect(get("hour")).toBe("10");
    expect(get("minute")).toBe("30");
  });

  it("returns null when no date/time found", () => {
    expect(
      parseAppointmentDateTime({
        userMessage: "quero saber mais",
        timezone: tz,
        now,
      }),
    ).toBeNull();
  });

  it("localWallClockToUtc respects timezone offset", () => {
    const utc = localWallClockToUtc(
      { year: 2026, month: 5, day: 28, hour: 14, minute: 0 },
      tz,
    );
    const hour = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }).format(utc);
    expect(hour).toBe("14");
  });
});
