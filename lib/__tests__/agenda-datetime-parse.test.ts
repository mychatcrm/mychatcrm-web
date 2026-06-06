import { describe, expect, it } from "vitest";
import {
  addDaysInTimezone,
  parseAppointmentDateTime,
  resolveScheduleDateTimeFromText,
} from "@/lib/server/agenda-datetime-parse";

const TZ = "America/Sao_Paulo";
const NOW = new Date("2026-06-05T15:00:00.000Z");

describe("agenda-datetime-parse extended", () => {
  it("daqui 3 dias = hoje + 3", () => {
    const result = resolveScheduleDateTimeFromText({
      clientText: "sim, daqui 3 dias às 14:00",
      assistantText: "Posso confirmar para daqui 3 dias às 14:00?",
      timezone: TZ,
      now: NOW,
    });
    expect(result?.date).toBe(addDaysInTimezone(TZ, 3, NOW));
    expect(result?.time).toBe("14:00");
  });

  it("daqui 15 dias = hoje + 15", () => {
    const result = resolveScheduleDateTimeFromText({
      clientText: "confirmo, daqui 15 dias às 10:00",
      timezone: TZ,
      now: NOW,
    });
    expect(result?.date).toBe(addDaysInTimezone(TZ, 15, NOW));
  });

  it("próxima sexta sempre é sexta futura", () => {
    const dt = parseAppointmentDateTime({
      userMessage: "próxima sexta às 15:00",
      timezone: TZ,
      now: NOW,
    });
    expect(dt).not.toBeNull();
    const dow = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      weekday: "short",
    }).format(dt!);
    expect(dow).toBe("Fri");
    expect(dt!.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("dia 20 escolhe próximo dia 20 futuro", () => {
    const result = resolveScheduleDateTimeFromText({
      clientText: "sim",
      assistantText: "Posso confirmar para dia 20 às 09:00?",
      timezone: TZ,
      now: NOW,
    });
    expect(result?.date).toMatch(/^20\/06\/2026$/);
    expect(result?.time).toBe("09:00");
  });

  it("20/06 resolve corretamente", () => {
    const result = resolveScheduleDateTimeFromText({
      clientText: "sim",
      assistantText: "Posso confirmar para 20/06/2026 às 11:00?",
      timezone: TZ,
      now: NOW,
    });
    expect(result?.date).toBe("20/06/2026");
    expect(result?.time).toBe("11:00");
  });

  it("20 de junho resolve corretamente", () => {
    const result = resolveScheduleDateTimeFromText({
      clientText: "sim",
      assistantText: "Posso confirmar para 20 de junho às 16:30?",
      timezone: TZ,
      now: NOW,
    });
    expect(result?.date).toBe("20/06/2026");
    expect(result?.time).toBe("16:30");
  });

  it("amanhã resolve a partir de hoje", () => {
    const result = resolveScheduleDateTimeFromText({
      clientText: "sim",
      assistantText: "Posso confirmar para amanhã às 08:00?",
      timezone: TZ,
      now: NOW,
    });
    expect(result?.date).toBe(addDaysInTimezone(TZ, 1, NOW));
    expect(result?.time).toBe("08:00");
  });
});
