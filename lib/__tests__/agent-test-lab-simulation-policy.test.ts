import { describe, expect, it } from "vitest";
import { labSimulationVerdict, labSimulatedEffects } from "@/lib/agent-test-lab/simulation-policy";

const allowed = { allowed: true, reason: "ok" };
const decision = (over: Partial<{ reply: string; agendaBlocked: boolean }> = {}) =>
  ({ reply: "Claro, posso ajudar.", authorization: allowed, agendaBlocked: false, ...over });

describe("simulation verdicts", () => {
  it("approves a plain reply and says what it does not prove", () => {
    const read = labSimulationVerdict("reply", decision());
    expect(read.verdict).toBe("passed");
    expect(read.description).toMatch(/entrega real/i);
  });

  it("never approves an effect, because a simulation changes nothing", () => {
    // This is the whole point: "agendado" in the text is not an appointment.
    for (const expectation of ["agenda_created", "agenda_cancelled", "follow_up", "reminder", "media_understood"] as const) {
      const read = labSimulationVerdict(expectation, decision({ reply: "Agendado para amanhã às 14h!" }));
      expect(read.verdict).toBe("inconclusive");
      expect(read.code).toBe("simulation_decides_but_does_not_execute");
    }
  });

  it("treats a blocked authorization as the expected silence", () => {
    expect(labSimulationVerdict("silence", { reply: "", authorization: { allowed: false }, agendaBlocked: false }).verdict)
      .toBe("expected_block");
    expect(labSimulationVerdict("silence", decision()).verdict).toBe("failed");
  });

  it("fails when the agent decided nothing at all", () => {
    expect(labSimulationVerdict("reply", decision({ reply: "   " })).verdict).toBe("failed");
    expect(labSimulationVerdict("agenda_created", decision({ reply: "" })).verdict).toBe("failed");
  });
});

describe("simulated effects are recorded as intent", () => {
  const base = {
    agenda: null, agendaBlocked: false, handoff: { triggered: false, reason: null },
    followUp: { enabled: false, wouldCreate: false, intervalMinutes: null },
    leadOutcome: null, externalApiLookups: [], media: { filenames: [] },
  };

  it("records nothing when the agent intended nothing", () => {
    expect(labSimulatedEffects(base)).toEqual([]);
  });

  it("names every intent separately so a report can distinguish them", () => {
    const effects = labSimulatedEffects({
      ...base, agenda: { start: "2026-09-10T14:00:00Z" }, agendaBlocked: true,
      handoff: { triggered: true, reason: "pediu humano" },
      followUp: { enabled: true, wouldCreate: true, intervalMinutes: 60 },
      leadOutcome: "qualified", externalApiLookups: [{}], media: { filenames: ["tabela.pdf"] },
    });
    expect(effects.map(effect => effect.effect_type).sort()).toEqual([
      "agenda_blocked", "agenda_intent", "external_api_intent", "follow_up_intent",
      "handoff_intent", "lead_outcome_intent", "media_intent",
    ]);
    // An intended agenda that the guard blocked must carry both facts, not one.
    expect(effects.find(effect => effect.effect_type === "agenda_intent")?.details.blocked).toBe(true);
  });
});
