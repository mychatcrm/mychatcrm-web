import { describe, expect, it } from "vitest";
import { lastInboundTextFromUnit } from "@/lib/conversas/normalize-conversation-burst";
import type { InboundTextMessage } from "@/lib/conversas/inbound-message-dedupe";
import {
  addDaysInTimezone,
  parseAppointmentDateTime,
  parseRelativeDaysOffset,
  resolveAgendaScheduleFieldsFromInbound,
} from "@/lib/server/agenda-datetime-parse";
import {
  clientConfirmedAgendaMutation,
  isStandaloneAgendaConfirmation,
} from "@/lib/server/agent-cta-scheduler";

describe("agenda fine-tuning", () => {
  const tz = "America/Sao_Paulo";
  const now = new Date("2026-06-02T15:00:00.000Z");

  it("lastInboundTextFromUnit uses only the latest client line", () => {
    const unit: InboundTextMessage[] = [
      { id: "1", content: "quero remarcar para daqui 15 dias", occurredAt: now.toISOString() },
      { id: "2", content: "sim", occurredAt: now.toISOString() },
    ];
    expect(lastInboundTextFromUnit(unit)).toBe("sim");
  });

  describe("confirmation backend", () => {
    it("blocks mutation request even if model would pass confirmacao=true", () => {
      expect(clientConfirmedAgendaMutation("quero remarcar para quinta")).toBe(false);
      expect(clientConfirmedAgendaMutation("quero cancelar meu agendamento")).toBe(false);
    });

    it("allows standalone sim/ok/confirmo", () => {
      expect(isStandaloneAgendaConfirmation("sim")).toBe(true);
      expect(isStandaloneAgendaConfirmation("ok!")).toBe(true);
      expect(isStandaloneAgendaConfirmation("confirmo")).toBe(true);
      expect(clientConfirmedAgendaMutation("sim")).toBe(true);
    });

    it("rejects sim bundled with a new scheduling request", () => {
      expect(clientConfirmedAgendaMutation("sim, remarcar para dia 20 às 14h")).toBe(false);
    });

    it("allows short confirm after assistant asked", () => {
      expect(
        clientConfirmedAgendaMutation(
          "sim, pode confirmar",
          "Posso confirmar a remarcação para 20/06 às 14h?",
        ),
      ).toBe(true);
    });
  });

  describe("relative and absolute reschedule dates", () => {
    it("daqui 3 dias = hoje + 3", () => {
      expect(parseRelativeDaysOffset("daqui 3 dias")).toBe(3);
      expect(addDaysInTimezone(tz, 3, now)).toBe("05/06/2026");
    });

    it("daqui 15 dias = hoje + 15", () => {
      expect(parseRelativeDaysOffset("daqui 15 dias")).toBe(15);
      expect(addDaysInTimezone(tz, 15, now)).toBe("17/06/2026");
    });

    it("próxima sexta is always a future Friday", () => {
      const dt = parseAppointmentDateTime({
        userMessage: "próxima sexta às 10:00",
        timezone: tz,
        now,
      });
      expect(dt).not.toBeNull();
      const dow = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(dt!);
      expect(dow).toBe("Fri");
      expect(dt!.getTime()).toBeGreaterThan(now.getTime());
    });

    it("dia 20 picks next future day 20 in month", () => {
      const fields = resolveAgendaScheduleFieldsFromInbound({
        date: "01/01/2099",
        time: "09:00",
        lastMessage: "remarcar para dia 20 às 11:00",
        timezone: tz,
        now,
      });
      expect(fields.date).toBe("20/06/2026");
      expect(fields.time).toBe("11:00");
    });

    it("second reschedule with daqui 15 dias overrides model date", () => {
      const fields = resolveAgendaScheduleFieldsFromInbound({
        date: "09/06/2026",
        time: "14:00",
        lastMessage: "pode ser daqui 15 dias às 16:30",
        timezone: tz,
        now,
      });
      expect(fields.date).toBe("17/06/2026");
      expect(fields.time).toBe("16:30");
    });
  });
});
