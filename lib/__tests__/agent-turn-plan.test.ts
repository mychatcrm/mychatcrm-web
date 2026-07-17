import { describe, expect, it } from "vitest";
import {
  AGENT_TURN_RESPONSE_FORMAT,
  normalizeAgentTurnResult,
  parseAgentTurnPlan,
} from "@/lib/ai/agent-turn-plan";

describe("structured agent turn plan", () => {
  it("declares every agenda action in a strict closed schema", () => {
    expect(AGENT_TURN_RESPONSE_FORMAT.schema.additionalProperties).toBe(false);
    expect(AGENT_TURN_RESPONSE_FORMAT.schema.properties.agenda.additionalProperties).toBe(false);
    expect(AGENT_TURN_RESPONSE_FORMAT.schema.properties.agenda.properties.action.enum).toEqual([
      "none",
      "list",
      "propose_create",
      "propose_reschedule",
      "propose_cancel",
      "create",
      "reschedule",
      "cancel",
    ]);
  });

  it("parses a complete direct scheduling command without exposing the control plan in reply", () => {
    expect(parseAgentTurnPlan({
      reply: "Vou verificar e registrar esse horário.",
      agenda: {
        action: "create",
        date: "20/07/2026",
        time: "14:00",
        location: null,
        eventId: null,
      },
    })).toEqual({
      reply: "Vou verificar e registrar esse horário.",
      agenda: {
        action: "create",
        date: "20/07/2026",
        time: "14:00",
        location: null,
        eventId: null,
      },
    });
  });

  it("normaliza ISO do modelo para o contrato brasileiro antes da agenda", () => {
    const plan = parseAgentTurnPlan({
      reply: "Posso confirmar?",
      agenda: {
        action: "propose_create",
        date: "2026-07-17",
        time: "2:00",
        location: null,
        eventId: null,
      },
    });
    expect(plan?.agenda).toMatchObject({ date: "17/07/2026", time: "02:00" });
  });

  it("remove data e hora malformadas do plano não confiável", () => {
    const plan = parseAgentTurnPlan({
      reply: "Posso confirmar?",
      agenda: {
        action: "propose_create",
        date: "amanhã talvez",
        time: "25:99",
        location: null,
        eventId: null,
      },
    });
    expect(plan?.agenda).toMatchObject({ date: null, time: null });
  });

  it("fails closed when the provider returns a malformed structured reply", () => {
    const normalized = normalizeAgentTurnResult({
      ok: true,
      text: "{}",
      structuredData: { reply: "Texto sem plano" },
      provider: "openai",
      model: "gpt-4o-mini",
      latencyMs: 10,
    });
    expect(normalized).toMatchObject({ ok: false, code: "INVALID_STRUCTURED_REPLY" });
  });
});
