import { describe, expect, it } from "vitest";
import { buildAppointmentNotificationMessage } from "@/lib/server/agenda-owner-notifications";

describe("buildAppointmentNotificationMessage", () => {
  it("builds the scheduled message with client, phone, time and location", () => {
    const message = buildAppointmentNotificationMessage({
      action: "scheduled",
      attendeeName: "Maria Silva",
      attendeePhone: "5511999990000",
      whenPtBr: "terça-feira, 21 de julho de 2026, 14:00",
      location: "Unidade Centro",
    });

    expect(message).toContain("Novo agendamento confirmado pelo agente.");
    expect(message).toContain("Cliente: Maria Silva");
    expect(message).toContain("Telefone: 5511999990000");
    expect(message).toContain("Quando: terça-feira, 21 de julho de 2026, 14:00");
    expect(message).toContain("Local: Unidade Centro");
  });

  it("builds rescheduled and cancelled headlines", () => {
    const rescheduled = buildAppointmentNotificationMessage({
      action: "rescheduled",
      attendeeName: "Maria",
      attendeePhone: "5511999990000",
      whenPtBr: "quarta-feira, 22 de julho de 2026, 10:00",
      location: null,
    });
    const cancelled = buildAppointmentNotificationMessage({
      action: "cancelled",
      attendeeName: "Maria",
      attendeePhone: "5511999990000",
      whenPtBr: "quarta-feira, 22 de julho de 2026, 10:00",
      location: null,
    });

    expect(rescheduled).toContain("Agendamento remarcado pelo agente.");
    expect(cancelled).toContain("Agendamento cancelado pelo agente.");
  });

  it("falls back to the phone when the name is missing and omits empty location", () => {
    const message = buildAppointmentNotificationMessage({
      action: "scheduled",
      attendeeName: null,
      attendeePhone: "5511988887777",
      whenPtBr: "sexta-feira, 24 de julho de 2026, 09:30",
      location: null,
    });

    expect(message).toContain("Cliente: 5511988887777");
    expect(message).not.toContain("Local:");
  });
});
