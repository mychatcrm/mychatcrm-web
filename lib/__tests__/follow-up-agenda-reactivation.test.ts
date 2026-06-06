import { describe, expect, it, vi } from "vitest";

// Mocks de módulos pesados/integração apenas para tornar o import de
// follow-up-jobs.ts seguro e rápido no ambiente de teste. As funções de
// detecção de intenção (detectRescheduleIntent/detectAgendaCancelIntent)
// permanecem REAIS, pois é o que o helper realmente usa.
vi.mock("@/lib/ai/generate-agent-response", () => ({
  generateAgentResponse: vi.fn(),
}));
vi.mock("@/lib/integrations/evolution-api", () => ({
  evolutionSendText: vi.fn(),
  remoteJidToEvoNumber: vi.fn(),
}));
vi.mock("@/lib/server/google-calendar-db", () => ({
  insertAgendaEvent: vi.fn(),
  updateAgendaEvent: vi.fn(),
  cancelAgendaEvent: vi.fn(),
  getAgendaEventById: vi.fn(),
  getGoogleCalendarToken: vi.fn(),
}));
vi.mock("@/lib/server/google-calendar", () => ({
  createGoogleCalendarEvent: vi.fn(),
  cancelGoogleCalendarEvent: vi.fn(),
}));
vi.mock("@/lib/server/agenda-realtime", () => ({
  broadcastAgendaChange: vi.fn(),
}));

import { conventionalFollowUpBypassesAgendaSuppression } from "@/lib/server/follow-up-jobs";

/**
 * Matriz de decisão do bypass da supressão por agenda ativa.
 * Regra: só libera (true) quando agenda ON + handoff OFF + última inbound do
 * cliente indica remarcar/cancelar (risco de abandono). Caso contrário, false
 * (comportamento atual preservado).
 */
describe("conventionalFollowUpBypassesAgendaSuppression", () => {
  it("agenda OFF -> bypass false (independente do texto)", () => {
    expect(
      conventionalFollowUpBypassesAgendaSuppression({
        agendaAutomationEnabled: false,
        ctaHandoffAtivo: false,
        latestInboundText: "quero remarcar",
      }),
    ).toBe(false);
  });

  it("handoff ON -> bypass false (mesmo com agenda ON e pedido de remarcar)", () => {
    expect(
      conventionalFollowUpBypassesAgendaSuppression({
        agendaAutomationEnabled: true,
        ctaHandoffAtivo: true,
        latestInboundText: "quero remarcar",
      }),
    ).toBe(false);
  });

  it("agenda ON + handoff OFF + remarcar -> true", () => {
    expect(
      conventionalFollowUpBypassesAgendaSuppression({
        agendaAutomationEnabled: true,
        ctaHandoffAtivo: false,
        latestInboundText: "Quero remarcar meu horário",
      }),
    ).toBe(true);
  });

  it("agenda ON + handoff OFF + trocar horário -> true", () => {
    expect(
      conventionalFollowUpBypassesAgendaSuppression({
        agendaAutomationEnabled: true,
        ctaHandoffAtivo: false,
        latestInboundText: "preciso trocar o horário, não consigo nesse",
      }),
    ).toBe(true);
  });

  it("agenda ON + handoff OFF + cancelar -> true", () => {
    expect(
      conventionalFollowUpBypassesAgendaSuppression({
        agendaAutomationEnabled: true,
        ctaHandoffAtivo: false,
        latestInboundText: "quero cancelar, não vou conseguir ir",
      }),
    ).toBe(true);
  });

  it("agenda ON + handoff OFF + dúvida simples -> false", () => {
    expect(
      conventionalFollowUpBypassesAgendaSuppression({
        agendaAutomationEnabled: true,
        ctaHandoffAtivo: false,
        latestInboundText: "onde fica? qual o endereço? tem estacionamento?",
      }),
    ).toBe(false);
  });

  it("agenda ON + handoff OFF + confirmação simples (sim) -> false", () => {
    expect(
      conventionalFollowUpBypassesAgendaSuppression({
        agendaAutomationEnabled: true,
        ctaHandoffAtivo: false,
        latestInboundText: "sim",
      }),
    ).toBe(false);
  });

  it("última inbound null -> false", () => {
    expect(
      conventionalFollowUpBypassesAgendaSuppression({
        agendaAutomationEnabled: true,
        ctaHandoffAtivo: false,
        latestInboundText: null,
      }),
    ).toBe(false);
  });

  it("última inbound vazia/espaços -> false", () => {
    expect(
      conventionalFollowUpBypassesAgendaSuppression({
        agendaAutomationEnabled: true,
        ctaHandoffAtivo: false,
        latestInboundText: "   ",
      }),
    ).toBe(false);
  });
});
