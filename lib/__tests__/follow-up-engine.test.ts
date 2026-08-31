import { describe, expect, it } from "vitest";
import { DEFAULT_FOLLOW_UP_INTELIGENTE } from "@/lib/server/follow-up-settings";
import {
  evaluateFollowUpNeed,
  isWithinBusinessHours,
  nextBusinessHourStart,
  buildFollowUpAiInstruction,
  type FollowUpEvalContext,
} from "@/lib/server/follow-up-engine";

const BASE_SETTINGS = {
  ...DEFAULT_FOLLOW_UP_INTELIGENTE,
  ativo: true,
  timezone: "UTC",
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
    hasFutureTask: false,
    ...overrides,
  };
}

describe("evaluateFollowUpNeed", () => {
  const blockedBase = (skipReason: string, humanBlocked = false) => ({
    shouldSend: false,
    reason: "no_trigger",
    skipReason,
    followUpType: "silence",
    priority: 4,
    urgency: "medium",
    nextRetryAt: null,
    cooldownActive: false,
    humanBlocked,
    spamRisk: false,
    businessHoursBlocked: false,
  });

  it("approves a stale lead during business hours", () => {
    const d = evaluateFollowUpNeed(makeCtx());
    expect(d.shouldSend).toBe(true);
    expect(d.followUpType).toBe("silence");
  });

  it("blocks when follow_up is disabled", () => {
    const d = evaluateFollowUpNeed(
      makeCtx({ settings: { ...BASE_SETTINGS, ativo: false } }),
    );
    expect(d).toEqual(blockedBase("follow_up_disabled"));
  });

  it("blocks when max attempts reached", () => {
    const d = evaluateFollowUpNeed(
      makeCtx({ job: { id: "j", attempts: 3, maxAttempts: 3, createdAt: new Date() } }),
    );
    expect(d).toEqual(blockedBase("max_attempts_reached"));
  });

  it.each(["perdido", "inativo", "cancelado", "arquivado"])("blocks terminal lead status %s", (status) => {
    const d = evaluateFollowUpNeed(
      makeCtx({
        lead: {
          id: "l",
          name: null,
          status,
          lastMessageAt: null,
          lastFollowUpAt: null,
          followUpCount: 0,
          followUpCooldownUntil: null,
        },
      }),
    );
    expect(d).toEqual(blockedBase(`lead_status_${status}`));
  });

  it("handles an absent lead without throwing or manufacturing a terminal status", () => {
    const d = evaluateFollowUpNeed(makeCtx({ lead: null }));
    expect(d.shouldSend).toBe(true);
    expect(d.skipReason).toBeNull();
  });

  it("handles an absent conversation state without bypassing the other guards", () => {
    const d = evaluateFollowUpNeed(makeCtx({
      conversationState: null,
      settings: { ...BASE_SETTINGS, ativo: false },
    }));
    expect(d).toEqual(blockedBase("follow_up_disabled"));
  });

  it("does not infer a human state from an absent conversation row", () => {
    const d = evaluateFollowUpNeed(makeCtx({ conversationState: null }));
    expect(d.shouldSend).toBe(true);
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
    expect(d).toEqual(blockedBase("human_paused", true));
  });

  it.each(["human", "waiting_human"])("blocks when conversation_mode is %s", (conversationMode) => {
    const d = evaluateFollowUpNeed(
      makeCtx({
        conversationState: {
          humanPaused: false,
          pausedReason: null,
          handoffSuggested: false,
          conversationMode,
          archivedAt: null,
        },
      }),
    );
    expect(d).toEqual(blockedBase("conversation_mode_human", true));
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
    expect(d.nextRetryAt?.toISOString()).toBe("2026-05-23T11:50:00.000Z");
  });

  it("uses the later explicit cooldown boundary when both cooldown sources exist", () => {
    const now = new Date("2026-05-22T12:00:00.000Z");
    const d = evaluateFollowUpNeed(
      makeCtx({
        now,
        settings: { ...BASE_SETTINGS, cooldownAtivo: true, cooldownMinutos: 60 },
        lead: {
          id: "l",
          name: null,
          status: null,
          lastMessageAt: null,
          lastFollowUpAt: new Date("2026-05-22T11:30:00.000Z"),
          followUpCount: 1,
          followUpCooldownUntil: new Date("2026-05-22T14:00:00.000Z"),
        },
      }),
    );
    expect(d.cooldownActive).toBe(true);
    expect(d.nextRetryAt?.toISOString()).toBe("2026-05-22T14:00:00.000Z");
  });

  it("blocks outside business hours when usarHorarioComercial is on", () => {
    const now = new Date("2026-05-22T22:00:00.000Z");
    const d = evaluateFollowUpNeed(makeCtx({ now, settings: { ...BASE_SETTINGS, usarHorarioComercial: true } }));
    expect(d.shouldSend).toBe(false);
    expect(d.businessHoursBlocked).toBe(true);
    expect(d.nextRetryAt).not.toBeNull();
  });

  it("blocks on weekend when diasAtivos is Mon-Fri", () => {
    const now = new Date("2026-05-23T10:00:00.000Z");
    const d = evaluateFollowUpNeed(makeCtx({ now }));
    expect(d.shouldSend).toBe(false);
    expect(d.businessHoursBlocked).toBe(true);
  });

  it("flags sla_breach type when SLA is configured and exceeded", () => {
    const now = new Date("2026-05-22T12:00:00.000Z");
    const jobCreated = new Date(now.getTime() - 26 * 60 * 60_000);
    const d = evaluateFollowUpNeed(
      makeCtx({
        now,
        settings: { ...BASE_SETTINGS, permitirSlaVencido: true, slaHorasResposta: 24 },
        job: { id: "j", attempts: 0, maxAttempts: 3, createdAt: jobCreated },
        lastCustomerMessageAt: null,
      }),
    );
    expect(d.shouldSend).toBe(true);
    expect(d.followUpType).toBe("sla_breach");
    expect(d.urgency).toBe("critical");
    expect(d.priority).toBe(1);
  });

  it("allows (falls through) when retomadaApenasSeHumanoAbandonou=true and no human outbound", () => {
    // No human history → gate does not enter → normal follow-up proceeds.
    const d = evaluateFollowUpNeed(
      makeCtx({
        settings: { ...BASE_SETTINGS, retomadaApenasSeHumanoAbandonou: true },
        lastHumanOutboundAt: null,
      }),
    );
    expect(d.shouldSend).toBe(true);
    expect(d.skipReason).toBeNull();
  });

  it("allows (falls through) when agent responded after human (retomadaApenasSeHumanoAbandonou=true)", () => {
    // Agent is most recent outbound → timeout restriction does not apply → normal follow-up proceeds.
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
    expect(d.shouldSend).toBe(true);
    expect(d.skipReason).toBeNull();
  });

  it("forces scheduled outreach to remain mutation-free", () => {
    const instruction = buildFollowUpAiInstruction({
      decision: evaluateFollowUpNeed(makeCtx()),
      leadName: null,
      settings: BASE_SETTINGS,
      attemptNumber: 0,
    });
    expect(instruction).toContain("Set agenda.action and leadOutcome.action to none");
    expect(instruction).toContain("Do not request handoff");
    expect(instruction).toContain("[[ENVIAR_MEDIA:...]]");
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
      isWithinBusinessHours(now, { horaInicio: 8, horaFim: 18, diasAtivos: [1, 2, 3, 4, 5], timezone: "UTC" }),
    ).toBe(true);
  });

  it("returns false at 18:00 (exclusive end)", () => {
    const now = new Date("2026-05-22T18:00:00.000Z");
    expect(
      isWithinBusinessHours(now, { horaInicio: 8, horaFim: 18, diasAtivos: [1, 2, 3, 4, 5], timezone: "UTC" }),
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
      isWithinBusinessHours(now, { horaInicio: 8, horaFim: 18, diasAtivos: [], timezone: "UTC" }),
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
      timezone: "UTC",
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
      timezone: "UTC",
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
      settings: DEFAULT_FOLLOW_UP_INTELIGENTE,
      attemptNumber: 0,
    });
    expect(instr).not.toContain("Renato");
    expect(instr).toContain("balanced follow-up level");
    expect(instr).toContain("follow-up attempt 1");
    expect(instr).toContain("five configured prompts remain authoritative");
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
    expect(instr).toContain("follow-up attempt 2");
    expect(instr).toContain("response-time threshold");
  });
});

describe("follow-up universal — sem vocabulário de nicho", () => {
  const FOLLOW_UP_TYPES = ["silence", "sla_breach", "human_abandoned", "lead_cooling"] as const;
  const MODES = ["agressivo", "moderado", "suave"] as const;

  function build(
    followUpType: (typeof FOLLOW_UP_TYPES)[number],
    modo: (typeof MODES)[number],
  ) {
    return buildFollowUpAiInstruction({
      decision: {
        shouldSend: true,
        reason: "customer_silence",
        skipReason: null,
        followUpType,
        priority: 4,
        urgency: "medium",
        nextRetryAt: null,
        cooldownActive: false,
        humanBlocked: false,
        spamRisk: false,
        businessHoursBlocked: false,
      },
      leadName: "Alex",
      settings: { ...DEFAULT_FOLLOW_UP_INTELIGENTE, modo },
      attemptNumber: 0,
    });
  }

  it("nenhuma combinação de tipo e modo presume venda", () => {
    // A engine atende recrutamento, clínica, suporte, educação, cobrança. Presumir
    // "concorrentes"/"oportunidade"/"decisão de compra" quebrava todos esses nichos.
    const VOCABULARIO_DE_NICHO =
      /concorrent|oportunidade|venda|vender|compra|comprar|neg[óo]cio fechad|proposta comercial/i;

    for (const followUpType of FOLLOW_UP_TYPES) {
      for (const modo of MODES) {
        const instr = build(followUpType, modo);
        expect(instr, `${followUpType}/${modo} vazou vocabulário de nicho`).not.toMatch(
          VOCABULARIO_DE_NICHO,
        );
      }
    }
  });

  it("mantém a mecânica de retomada em todos os tipos", () => {
    for (const followUpType of FOLLOW_UP_TYPES) {
      const instr = build(followUpType, "moderado");
      expect(instr).not.toContain("Alex");
      expect(instr).toContain("Internal urgency signal: medium");
      expect(instr).toContain("follow-up attempt 1");
    }
  });

  it("não força nem oculta uma identidade humana/IA", () => {
    const instr = build("silence", "moderado");
    expect(instr).not.toMatch(/finja|fingir|sistema autom[aá]tico|sou humano/i);
    expect(instr).toContain("configured prompts require it");
    expect(instr).toContain("Internal urgency signal: medium");
  });
});
