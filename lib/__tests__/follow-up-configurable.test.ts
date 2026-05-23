import { describe, expect, it } from "vitest";
import { DEFAULT_FOLLOW_UP_INTELIGENTE } from "@/lib/server/follow-up-settings";
import {
  buildFollowUpAiInstruction,
  evaluateFollowUpNeed,
  isWithinBusinessHours,
  type FollowUpEvalContext,
} from "@/lib/server/follow-up-engine";
import type { AgentFollowUpInteligente } from "@/lib/types";

function makeCtx(
  settings: AgentFollowUpInteligente,
  overrides: Partial<FollowUpEvalContext> = {},
): FollowUpEvalContext {
  const now = new Date("2026-05-22T12:00:00.000Z");
  return {
    now,
    settings,
    job: {
      id: "j1",
      attempts: 0,
      maxAttempts: settings.tentativasContato,
      createdAt: new Date(now.getTime() - 3 * 60 * 60_000),
    },
    lead: {
      id: "l1",
      name: "Ana",
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

describe("follow-up master switch", () => {
  it("disabled: never sends", () => {
    const s = { ...DEFAULT_FOLLOW_UP_INTELIGENTE, ativo: false };
    const d = evaluateFollowUpNeed(makeCtx(s));
    expect(d.shouldSend).toBe(false);
    expect(d.skipReason).toBe("follow_up_disabled");
  });
});

describe("configurable safety rules", () => {
  const base = { ...DEFAULT_FOLLOW_UP_INTELIGENTE, ativo: true };

  it("bloquearStatusPerdido off allows lost lead", () => {
    const d = evaluateFollowUpNeed(
      makeCtx(
        { ...base, bloquearStatusPerdido: false },
        { lead: { id: "l", name: null, status: "perdido", lastMessageAt: null, lastFollowUpAt: null, followUpCount: 0, followUpCooldownUntil: null } },
      ),
    );
    expect(d.shouldSend).toBe(true);
  });

  it("bloquearSeLeadRespondeu off ignores customer reply", () => {
    const now = new Date("2026-05-22T12:00:00.000Z");
    const d = evaluateFollowUpNeed(
      makeCtx(
        { ...base, bloquearSeLeadRespondeu: false },
        {
          job: { id: "j", attempts: 0, maxAttempts: 3, createdAt: new Date(now.getTime() - 60 * 60_000) },
          lastCustomerMessageAt: new Date(now.getTime() - 10 * 60_000),
        },
      ),
    );
    expect(d.shouldSend).toBe(true);
  });

  it("respeitarHumanoAtivo off allows human_paused", () => {
    const d = evaluateFollowUpNeed(
      makeCtx(
        { ...base, respeitarHumanoAtivo: false },
        {
          conversationState: {
            humanPaused: true,
            pausedReason: "manual",
            handoffSuggested: false,
            conversationMode: null,
            archivedAt: null,
          },
        },
      ),
    );
    expect(d.shouldSend).toBe(true);
    expect(d.humanBlocked).toBe(false);
  });

  it("respeitarHumanoAtivo on blocks human_paused", () => {
    const d = evaluateFollowUpNeed(
      makeCtx(base, {
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
  });

  it("bloquearTarefaFutura blocks when future task exists", () => {
    const d = evaluateFollowUpNeed(makeCtx(base, { hasFutureTask: true }));
    expect(d.shouldSend).toBe(false);
    expect(d.skipReason).toBe("future_task_scheduled");
  });

  it("cooldownAtivo off skips cooldown check", () => {
    const now = new Date("2026-05-22T12:00:00.000Z");
    const d = evaluateFollowUpNeed(
      makeCtx(
        { ...base, cooldownAtivo: false },
        {
          lead: {
            id: "l",
            name: null,
            status: null,
            lastMessageAt: null,
            lastFollowUpAt: new Date(now.getTime() - 5 * 60_000),
            followUpCount: 1,
            followUpCooldownUntil: null,
          },
        },
      ),
    );
    expect(d.shouldSend).toBe(true);
    expect(d.cooldownActive).toBe(false);
  });

  it("usarHorarioComercial off allows weekend send", () => {
    const saturday = new Date("2026-05-23T10:00:00.000Z");
    const d = evaluateFollowUpNeed(
      makeCtx({ ...base, usarHorarioComercial: false }, { now: saturday }),
    );
    expect(d.shouldSend).toBe(true);
    expect(d.businessHoursBlocked).toBe(false);
  });

  it("permitirSlaVencido off prevents sla_breach type", () => {
    const now = new Date("2026-05-22T12:00:00.000Z");
    const d = evaluateFollowUpNeed(
      makeCtx(
        { ...base, permitirSlaVencido: false, slaHorasResposta: 4 },
        {
          job: { id: "j", attempts: 0, maxAttempts: 3, createdAt: new Date(now.getTime() - 10 * 60 * 60_000) },
        },
      ),
    );
    expect(d.followUpType).not.toBe("sla_breach");
  });
});

describe("buildFollowUpAiInstruction context sources", () => {
  it("mentions Meta only when enabled", () => {
    const decision = {
      shouldSend: true,
      reason: "x",
      skipReason: null,
      followUpType: "silence" as const,
      priority: 4 as const,
      urgency: "medium" as const,
      nextRetryAt: null,
      cooldownActive: false,
      humanBlocked: false,
      spamRisk: false,
      businessHoursBlocked: false,
    };
    const on = buildFollowUpAiInstruction({
      decision,
      leadName: null,
      settings: { ...DEFAULT_FOLLOW_UP_INTELIGENTE, usarDadosFormularioMeta: true, modo: "moderado" },
      attemptNumber: 0,
    });
    const off = buildFollowUpAiInstruction({
      decision,
      leadName: null,
      settings: { ...DEFAULT_FOLLOW_UP_INTELIGENTE, usarDadosFormularioMeta: false, modo: "moderado" },
      attemptNumber: 0,
    });
    expect(on).toContain("Meta Lead Ads");
    expect(off).toContain("Não mencione campos de formulário Meta");
  });

  it("omits WhatsApp hint when history disabled", () => {
    const decision = {
      shouldSend: true,
      reason: "x",
      skipReason: null,
      followUpType: "silence" as const,
      priority: 4 as const,
      urgency: "medium" as const,
      nextRetryAt: null,
      cooldownActive: false,
      humanBlocked: false,
      spamRisk: false,
      businessHoursBlocked: false,
    };
    const off = buildFollowUpAiInstruction({
      decision,
      leadName: null,
      settings: { ...DEFAULT_FOLLOW_UP_INTELIGENTE, usarHistoricoWhatsapp: false, modo: "moderado" },
      attemptNumber: 0,
    });
    expect(off).toContain("Não há histórico de WhatsApp");
  });
});

describe("schedule guard (unit)", () => {
  it("DEFAULT has follow-up off", () => {
    expect(DEFAULT_FOLLOW_UP_INTELIGENTE.ativo).toBe(false);
  });

  it("business hours helper respects diasAtivos", () => {
    const sat = new Date("2026-05-23T10:00:00.000Z");
    expect(
      isWithinBusinessHours(sat, { horaInicio: 8, horaFim: 18, diasAtivos: [1, 2, 3, 4, 5] }),
    ).toBe(false);
  });
});
