import { describe, expect, it } from "vitest";
import {
  evaluateFollowUpNeed,
  isWithinBusinessHours,
  nextBusinessHourStart,
  buildFollowUpAiInstruction,
  type FollowUpEvalContext,
  type FollowUpEvalSettings,
} from "@/lib/server/follow-up-engine";

const BASE_SETTINGS: FollowUpEvalSettings = {
  ativo: true,
  tentativasContato: 3,
  intervaloVerificacaoMinutos: 60,
  modo: "moderado",
  cooldownMinutos: 30,
  slaHorasResposta: null,
  horaInicio: 8,
  horaFim: 18,
  diasAtivos: [1, 2, 3, 4, 5],
  retomadaApenasSeHumanoAbandonou: false,
};

function makeCtx(overrides: Partial<FollowUpEvalContext> = {}): FollowUpEvalContext {
  const now = new Date("2026-05-22T12:00:00.000Z"); // Friday UTC noon
  const jobCreatedAt = new Date(now.getTime() - 2 * 60 * 60_000); // 2h ago
  return {
    now,
    settings: { ...BASE_SETTINGS },
    job: { id: "job-1", attempts: 0, maxAttempts: 3, createdAt: jobCreatedAt },
    lead: {
      id: "lead-1",
      name: "Renato",
      status: "contato",
      lastMessageAt: null,
      lastFollowUpAt: null,
      followUpCount: 0,
      followUpCooldownUntil: null,
    },
    conversationState: {
      humanPaused: false,
      pausedReason: null,
      handoffSuggested: false,
      conversationMode: null,
      archivedAt: null,
    },
    lastCustomerMessageAt: null,
    lastAgentMessageAt: null,
    lastHumanOutboundAt: null,
    ...overrides,
  };
}

describe("evaluateFollowUpNeed", () => {
  it("approves a stale lead during business hours", () => {
    const d = evaluateFollowUpNeed(makeCtx());
    expect(d.shouldSend).toBe(true);
    expect(d.followUpType).toBe("silence");
  });

  it("blocks when follow_up is disabled", () => {
    const d = evaluateFollowUpNeed(
      makeCtx({ settings: { ...BASE_SETTINGS, ativo: false } }),
    );
    expect(d.shouldSend).toBe(false);
    expect(d.skipReason).toBe("follow_up_disabled");
  });

  it("blocks when max attempts reached", () => {
    const d = evaluateFollowUpNeed(
      makeCtx({ job: { id: "j", attempts: 3, maxAttempts: 3, createdAt: new Date() } }),
    );
    expect(d.shouldSend).toBe(false);
    expect(d.skipReason).toBe("max_attempts_reached");
  });

  it("blocks when lead status is lost", () => {
    const d = evaluateFollowUpNeed(
      makeCtx({
        lead: {
          id: "l",
          name: null,
          status: "perdido",
          lastMessageAt: null,
          lastFollowUpAt: null,
          followUpCount: 0,
          followUpCooldownUntil: null,
        },
      }),
    );
    expect(d.shouldSend).toBe(false);
    expect(d.skipReason).toContain("lead_status");
    expect(d.humanBlocked).toBe(false);
  });

  it("blocks when human_paused=true", () => {
    const d = evaluateFollowUpNeed(
      makeCtx({
        conversationState: {
          humanPaused: true,
          pausedReason: "manual",
          handoffSuggested: false,
          conversationMode: null,
          archivedAt: null,
        },
      }),
    );
    expect(d.shouldSend).toBe(false);
    expect(d.humanBlocked).toBe(true);
    expect(d.skipReason).toBe("human_paused");
  });

  it("blocks when conversation_mode is human", () => {
    const d = evaluateFollowUpNeed(
      makeCtx({
        conversationState: {
          humanPaused: false,
          pausedReason: null,
          handoffSuggested: false,
          conversationMode: "human",
          archivedAt: null,
        },
      }),
    );
    expect(d.shouldSend).toBe(false);
    expect(d.humanBlocked).toBe(true);
  });

  it("cancels when customer replied after job was created", () => {
    const now = new Date("2026-05-22T12:00:00.000Z");
    const jobCreated = new Date(now.getTime() - 60 * 60_000);
    const customerReplied = new Date(now.getTime() - 10 * 60_000);
    const d = evaluateFollowUpNeed(
      makeCtx({
        now,
        job: { id: "j", attempts: 0, maxAttempts: 3, createdAt: jobCreated },
        lastCustomerMessageAt: customerReplied,
      }),
    );
    expect(d.shouldSend).toBe(false);
    expect(d.skipReason).toBe("customer_replied");
  });

  it("blocks during cooldown (spam risk)", () => {
    const now = new Date("2026-05-22T12:00:00.000Z");
    const recentFollowUp = new Date(now.getTime() - 10 * 60_000); // 10 min ago
    const d = evaluateFollowUpNeed(
      makeCtx({
        now,
        lead: {
          id: "l",
          name: null,
          status: null,
          lastMessageAt: null,
          lastFollowUpAt: recentFollowUp.toISOString()
            ? recentFollowUp
            : null,
          followUpCount: 1,
          followUpCooldownUntil: null,
        },
      }),
    );
    expect(d.shouldSend).toBe(false);
    expect(d.cooldownActive).toBe(true);
    expect(d.spamRisk).toBe(true);
  });

  it("blocks outside business hours and sets nextRetryAt", () => {
    const now = new Date("2026-05-22T22:00:00.000Z"); // 10 PM UTC, outside 8-18
    const d = evaluateFollowUpNeed(makeCtx({ now }));
    expect(d.shouldSend).toBe(false);
    expect(d.businessHoursBlocked).toBe(true);
    expect(d.nextRetryAt).not.toBeNull();
  });

  it("blocks on weekend when diasAtivos is Mon-Fri", () => {
    const now = new Date("2026-05-23T10:00:00.000Z"); // Saturday UTC
    const d = evaluateFollowUpNeed(makeCtx({ now }));
    expect(d.shouldSend).toBe(false);
    expect(d.businessHoursBlocked).toBe(true);
  });

  it("flags sla_breach type when SLA is configured and exceeded", () => {
    const now = new Date("2026-05-22T12:00:00.000Z");
    const jobCreated = new Date(now.getTime() - 26 * 60 * 60_000); // 26h ago
    const d = evaluateFollowUpNeed(
      makeCtx({
        now,
        settings: { ...BASE_SETTINGS, slaHorasResposta: 24 },
        job: { id: "j", attempts: 0, maxAttempts: 3, createdAt: jobCreated },
        lastCustomerMessageAt: null,
      }),
    );
    expect(d.shouldSend).toBe(true);
    expect(d.followUpType).toBe("sla_breach");
    expect(d.urgency).toBe("critical");
    expect(d.priority).toBe(1);
  });

  it("blocks when retomadaApenasSeHumanoAbandonou=true and no human outbound", () => {
    const d = evaluateFollowUpNeed(
      makeCtx({
        settings: { ...BASE_SETTINGS, retomadaApenasSeHumanoAbandonou: true },
        lastHumanOutboundAt: null,
      }),
    );
    expect(d.shouldSend).toBe(false);
    expect(d.skipReason).toBe("retomada_apenas_humano_sem_historico");
  });

  it("blocks when agent responded after human (retomadaApenasSeHumanoAbandonou=true)", () => {
    const now = new Date("2026-05-22T12:00:00.000Z");
    const humanAt = new Date(now.getTime() - 3 * 60 * 60_000);
    const agentAt = new Date(now.getTime() - 1 * 60 * 60_000);
    const d = evaluateFollowUpNeed(
      makeCtx({
        now,
        settings: { ...BASE_SETTINGS, retomadaApenasSeHumanoAbandonou: true },
        lastHumanOutboundAt: humanAt,
        lastAgentMessageAt: agentAt,
      }),
    );
    expect(d.shouldSend).toBe(false);
    expect(d.skipReason).toBe("agent_responded_after_human");
  });

  it("sets lead_cooling type on attempt >= 1", () => {
    const d = evaluateFollowUpNeed(
      makeCtx({
        job: {
          id: "j",
          attempts: 2,
          maxAttempts: 5,
          createdAt: new Date("2026-05-22T10:00:00.000Z"),
        },
      }),
    );
    expect(d.shouldSend).toBe(true);
    expect(d.followUpType).toBe("lead_cooling");
  });

  it("agressivo mode upgrades urgency", () => {
    const d = evaluateFollowUpNeed(
      makeCtx({ settings: { ...BASE_SETTINGS, modo: "agressivo" } }),
    );
    expect(d.shouldSend).toBe(true);
    const d2 = evaluateFollowUpNeed(
      makeCtx({ settings: { ...BASE_SETTINGS, modo: "moderado" } }),
    );
    expect(["critical", "high", "medium", "low"].indexOf(d.urgency)).toBeLessThanOrEqual(
      ["critical", "high", "medium", "low"].indexOf(d2.urgency),
    );
  });
});

describe("isWithinBusinessHours", () => {
  it("returns true inside 08-18 on a weekday", () => {
    const now = new Date("2026-05-22T10:00:00.000Z"); // Friday 10h UTC
    expect(
      isWithinBusinessHours(now, { horaInicio: 8, horaFim: 18, diasAtivos: [1, 2, 3, 4, 5] }),
    ).toBe(true);
  });

  it("returns false at 18:00 (exclusive end)", () => {
    const now = new Date("2026-05-22T18:00:00.000Z");
    expect(
      isWithinBusinessHours(now, { horaInicio: 8, horaFim: 18, diasAtivos: [1, 2, 3, 4, 5] }),
    ).toBe(false);
  });

  it("returns false on Saturday when diasAtivos is Mon-Fri", () => {
    const now = new Date("2026-05-23T10:00:00.000Z"); // Saturday
    expect(
      isWithinBusinessHours(now, { horaInicio: 8, horaFim: 18, diasAtivos: [1, 2, 3, 4, 5] }),
    ).toBe(false);
  });

  it("returns true on any day when diasAtivos is empty", () => {
    const now = new Date("2026-05-23T10:00:00.000Z"); // Saturday
    expect(
      isWithinBusinessHours(now, { horaInicio: 8, horaFim: 18, diasAtivos: [] }),
    ).toBe(true);
  });
});

describe("nextBusinessHourStart", () => {
  it("returns start of next business day when currently outside hours", () => {
    const now = new Date("2026-05-22T22:00:00.000Z"); // Friday 22h UTC
    const next = nextBusinessHourStart(now, {
      horaInicio: 8,
      horaFim: 18,
      diasAtivos: [1, 2, 3, 4, 5],
    });
    expect(next.getUTCDay()).toBe(1); // Monday
    expect(next.getUTCHours()).toBe(8);
  });

  it("returns same day start when it's before business hours today", () => {
    const now = new Date("2026-05-22T05:00:00.000Z"); // Friday 5h UTC
    const next = nextBusinessHourStart(now, {
      horaInicio: 8,
      horaFim: 18,
      diasAtivos: [1, 2, 3, 4, 5],
    });
    expect(next.getUTCDay()).toBe(5); // Friday
    expect(next.getUTCHours()).toBe(8);
  });
});

describe("buildFollowUpAiInstruction", () => {
  it("includes type context and mode strategy", () => {
    const instr = buildFollowUpAiInstruction({
      decision: {
        shouldSend: true,
        reason: "customer_silence",
        skipReason: null,
        followUpType: "silence",
        priority: 4,
        urgency: "medium",
        nextRetryAt: null,
        cooldownActive: false,
        humanBlocked: false,
        spamRisk: false,
        businessHoursBlocked: false,
      },
      leadName: "Renato",
      settings: { modo: "moderado", slaHorasResposta: null },
      attemptNumber: 0,
    });
    expect(instr).toContain("Renato");
    expect(instr).toContain("natural");
    expect(instr).toContain("primeira tentativa");
  });

  it("varies attempt note on second try", () => {
    const instr = buildFollowUpAiInstruction({
      decision: {
        shouldSend: true,
        reason: "sla_breach",
        skipReason: null,
        followUpType: "sla_breach",
        priority: 1,
        urgency: "critical",
        nextRetryAt: null,
        cooldownActive: false,
        humanBlocked: false,
        spamRisk: false,
        businessHoursBlocked: false,
      },
      leadName: null,
      settings: { modo: "agressivo", slaHorasResposta: 24 },
      attemptNumber: 1,
    });
    expect(instr).toContain("Segunda tentativa");
    expect(instr).toContain("prazo de resposta");
  });
});
