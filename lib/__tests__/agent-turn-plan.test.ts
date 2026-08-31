import { describe, expect, it } from "vitest";
import {
  AGENT_TURN_RESPONSE_FORMAT,
  normalizeAgentAgendaDate,
  normalizeAgentAgendaTime,
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
      handoff: { requested: false, reason: null },
      media: { filenames: [] },
    })).toEqual({
      reply: "Vou verificar e registrar esse horário.",
      agenda: {
        action: "create",
        date: "20/07/2026",
        time: "14:00",
        location: null,
        eventId: null,
      },
      handoff: { requested: false, reason: null },
      media: { filenames: [] },
      // Ausente na resposta do modelo: vira "none" em vez de invalidar o turno.
      leadOutcome: { action: "none", reason: null },
      externalApiLookups: [],
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

describe("untrusted agenda civil values", () => {
  it.each([
    ["01/01/2026", "01/01/2026"],
    ["29/02/2028", "29/02/2028"],
    ["2026-12-31", "31/12/2026"],
    [" 2026-07-17 ", "17/07/2026"],
  ])("accepts an exact valid date %s", (input, expected) => {
    expect(normalizeAgentAgendaDate(input)).toBe(expected);
  });

  it.each([
    "00/01/2026", "32/01/2026", "01/00/2026", "01/13/2026",
    "29/02/2027", "31/04/2026", "2026-02-30",
    "x20/07/2026", "20/07/2026x", "2026-07-17T14:00:00Z",
    "", null, 20260717,
  ])("rejects malformed or impossible date %j", (input) => {
    expect(normalizeAgentAgendaDate(input)).toBeNull();
  });

  it.each([
    ["0:00", "00:00"],
    ["00:00", "00:00"],
    ["9:05", "09:05"],
    ["23:59", "23:59"],
    [" 14:30 ", "14:30"],
  ])("accepts and normalizes exact time %s", (input, expected) => {
    expect(normalizeAgentAgendaTime(input)).toBe(expected);
  });

  it.each([
    "-1:00", "24:00", "12:60", "12:-1", "1:2", "001:00",
    "x14:00", "14:00x", "14h", "", null, 1400,
  ])("rejects malformed or impossible time %j", (input) => {
    expect(normalizeAgentAgendaTime(input)).toBeNull();
  });
});
