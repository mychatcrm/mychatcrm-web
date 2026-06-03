import { describe, expect, it } from "vitest";
import { shouldDeferHandoffForPendingAgenda } from "@/lib/server/agenda-handoff-gate";
import {
  clientConfirmedAgendaMutation,
  detectSchedulingConfirmation,
  isInitialAgendaMutationRequest,
} from "@/lib/server/agent-cta-scheduler";
import { buildAgentSystemPrompt } from "@/lib/ai/agent-system-prompt";
import type { Agent } from "@/lib/types";

describe("agenda confirmation flow", () => {
  it("treats cancel request as initial mutation, not confirmation", () => {
    expect(isInitialAgendaMutationRequest("quero cancelar meu agendamento")).toBe(true);
    expect(clientConfirmedAgendaMutation("quero cancelar meu agendamento")).toBe(false);
  });

  it("defers handoff when cancel requested before agenda action completes", () => {
    expect(
      shouldDeferHandoffForPendingAgenda({
        agendaAutomationEnabled: true,
        agendaActionCompleted: false,
        inboundText: "quero cancelar meu agendamento",
      }),
    ).toBe(true);
  });

  it("does not defer handoff when agenda automation is off", () => {
    expect(
      shouldDeferHandoffForPendingAgenda({
        agendaAutomationEnabled: false,
        agendaActionCompleted: false,
        inboundText: "quero cancelar",
      }),
    ).toBe(false);
  });

  it("does not defer after agenda action completed", () => {
    expect(
      shouldDeferHandoffForPendingAgenda({
        agendaAutomationEnabled: true,
        agendaActionCompleted: true,
        inboundText: "quero cancelar",
      }),
    ).toBe(false);
  });

  it("accepts explicit confirmation for directive execution", () => {
    expect(
      clientConfirmedAgendaMutation(
        "sim, pode confirmar",
        "Posso confirmar o cancelamento do seu agendamento?",
      ),
    ).toBe(true);
    expect(
      detectSchedulingConfirmation(
        "sim, pode confirmar",
        "Posso confirmar o cancelamento do seu agendamento?",
      ),
    ).toBe(true);
  });

  it("agenda prompt includes confirmation questions only when automation enabled", () => {
    const withAgenda = buildAgentSystemPrompt({
      agent: { agendaAutomationEnabled: true } as Agent,
      languageInstruction: "",
    });
    expect(withAgenda).toContain("Posso confirmar seu agendamento para");
    expect(withAgenda).toContain("NUNCA diga apenas \"vou confirmar\"");

    const withoutAgenda = buildAgentSystemPrompt({
      agent: { agendaAutomationEnabled: false } as Agent,
      languageInstruction: "",
    });
    expect(withoutAgenda).not.toContain("Posso confirmar seu agendamento para");
    expect(withoutAgenda).toContain("automação de agenda está desativada");
  });
});
