import { describe, expect, it } from "vitest";
import { DEFAULT_FOLLOW_UP_INTELIGENTE } from "@/lib/server/follow-up-settings";
import {
  buildFollowUpAiInstruction,
  evaluateFollowUpNeed,
  isWithinBusinessHours,
  nextBusinessHourStart,
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

  it("DEFAULT timezone is UTC", () => {
    expect(DEFAULT_FOLLOW_UP_INTELIGENTE.timezone).toBe("UTC");
  });
});

describe("timezone-aware business hours", () => {
  // 2026-05-22 = Friday. BRT = UTC-3 (no DST in Brazil since 2019). EDT = UTC-4 (May = summer DST in NY).

  it("UTC: Saturday 10:00 UTC inside hours but blocked by diasAtivos (Mon-Fri)", () => {
    const sat = new Date("2026-05-23T10:00:00.000Z"); // Saturday UTC
    expect(
      isWithinBusinessHours(sat, { horaInicio: 8, horaFim: 18, diasAtivos: [1, 2, 3, 4, 5], timezone: "UTC" }),
    ).toBe(false);
  });

  it("America/Sao_Paulo: 11:00 UTC = 08:00 BRT Friday → inside 08–20", () => {
    // BRT = UTC-3; 11:00Z - 3h = 08:00 local on Friday (day 5)
    const date = new Date("2026-05-22T11:00:00.000Z");
    expect(
      isWithinBusinessHours(date, { horaInicio: 8, horaFim: 20, diasAtivos: [1, 2, 3, 4, 5], timezone: "America/Sao_Paulo" }),
    ).toBe(true);
  });

  it("America/Sao_Paulo: 01:00 UTC Saturday = 22:00 BRT Friday → hour 22 outside 08–20", () => {
    // 2026-05-23T01:00Z in BRT = 2026-05-22 22:00 (Friday) — past horaFim 20
    const date = new Date("2026-05-23T01:00:00.000Z");
    expect(
      isWithinBusinessHours(date, { horaInicio: 8, horaFim: 20, diasAtivos: [1, 2, 3, 4, 5], timezone: "America/Sao_Paulo" }),
    ).toBe(false);
  });

  it("America/Sao_Paulo: 12:00 UTC Saturday = 09:00 BRT Saturday → day blocked (Mon-Fri)", () => {
    // 2026-05-23T12:00Z in BRT = 2026-05-23 09:00 (Saturday)
    const date = new Date("2026-05-23T12:00:00.000Z");
    expect(
      isWithinBusinessHours(date, { horaInicio: 8, horaFim: 20, diasAtivos: [1, 2, 3, 4, 5], timezone: "America/Sao_Paulo" }),
    ).toBe(false);
  });

  it("America/New_York: 12:00 UTC = 08:00 EDT Friday → inside 08–18", () => {
    // May 2026 = EDT = UTC-4; 12:00Z - 4h = 08:00 local on Friday
    const date = new Date("2026-05-22T12:00:00.000Z");
    expect(
      isWithinBusinessHours(date, { horaInicio: 8, horaFim: 18, diasAtivos: [1, 2, 3, 4, 5], timezone: "America/New_York" }),
    ).toBe(true);
  });

  it("America/New_York: 11:00 UTC = 07:00 EDT Friday → before 08:00 (blocked)", () => {
    // May 2026 = EDT = UTC-4; 11:00Z - 4h = 07:00 local
    const date = new Date("2026-05-22T11:00:00.000Z");
    expect(
      isWithinBusinessHours(date, { horaInicio: 8, horaFim: 18, diasAtivos: [1, 2, 3, 4, 5], timezone: "America/New_York" }),
    ).toBe(false);
  });

  it("invalid timezone falls back to UTC behavior", () => {
    // Friday 10:00 UTC → should be inside 08-18 Mon-Fri in UTC fallback
    const date = new Date("2026-05-22T10:00:00.000Z");
    expect(
      isWithinBusinessHours(date, { horaInicio: 8, horaFim: 18, diasAtivos: [1, 2, 3, 4, 5], timezone: "Invalid/Zone" }),
    ).toBe(true);
  });
});

// ─── Bypass de horário comercial quando cron roda após o slot agendado ────────
//
// Cenário do bug: cron roda às 04:00 UTC (fora da janela 08-22).
// O job foi agendado para 08:00 UTC (dentro da janela).
// O cron pega o job (scheduled_at <= now) e rebloqueia por horário → loop infinito.
//
// Correção: usar scheduled_at como referência para isWithinBusinessHours.
// Se scheduled_at está dentro da janela, usar settingsForEval = { ...settings, usarHorarioComercial: false }.
//
// Os testes abaixo simulam exatamente essa lógica aplicada em processFollowUpJob.

describe("business hours bypass — cron roda depois do slot agendado", () => {
  const base = { ...DEFAULT_FOLLOW_UP_INTELIGENTE, ativo: true };

  function effectiveSettings(
    scheduledAt: Date,
    settings: AgentFollowUpInteligente,
  ): AgentFollowUpInteligente {
    return settings.usarHorarioComercial && isWithinBusinessHours(scheduledAt, settings)
      ? { ...settings, usarHorarioComercial: false }
      : settings;
  }

  it("agendado 08:00 UTC sexta + cron 04:00 UTC sábado → bypass, shouldSend=true", () => {
    // Job agendado para sexta 08:00 UTC (dentro da janela 08-22, seg-sex).
    // Cron roda sábado 04:00 UTC (fora da janela). Deve processar.
    const scheduledAt = new Date("2026-05-22T08:00:00.000Z"); // sexta 08:00 UTC
    const eff = effectiveSettings(scheduledAt, base);
    expect(eff.usarHorarioComercial).toBe(false); // bypass ativado

    const ctx = makeCtx(eff, { now: new Date("2026-05-23T04:00:00.000Z") }); // sábado 04:00 UTC
    const d = evaluateFollowUpNeed(ctx);
    expect(d.businessHoursBlocked).toBe(false);
    expect(d.shouldSend).toBe(true);
  });

  it("agendado 03:00 UTC (fora da janela) + cron 04:00 UTC → sem bypass, rebloqueia", () => {
    // Job agendado fora da janela → nenhum bypass → cron rebloqueia corretamente.
    const scheduledAt = new Date("2026-05-22T03:00:00.000Z"); // sexta 03:00 UTC
    const eff = effectiveSettings(scheduledAt, base);
    expect(eff.usarHorarioComercial).toBe(true); // sem bypass

    const ctx = makeCtx(eff, { now: new Date("2026-05-22T04:00:00.000Z") }); // sexta 04:00 UTC
    const d = evaluateFollowUpNeed(ctx);
    expect(d.businessHoursBlocked).toBe(true);
    expect(d.shouldSend).toBe(false);
    expect(d.skipReason).toBe("outside_business_hours");
  });

  it("agendado segunda 08:00 UTC + cron terça 04:00 UTC → bypass, shouldSend=true", () => {
    // Saiu da janela sexta à noite → reagendado para segunda 08:00 UTC.
    // Cron roda terça 04:00 UTC: scheduled_at <= now, deve processar.
    const scheduledAt = new Date("2026-05-25T08:00:00.000Z"); // segunda 08:00 UTC
    const eff = effectiveSettings(scheduledAt, base);
    expect(eff.usarHorarioComercial).toBe(false);

    const ctx = makeCtx(eff, { now: new Date("2026-05-26T04:00:00.000Z") }); // terça 04:00 UTC
    const d = evaluateFollowUpNeed(ctx);
    expect(d.shouldSend).toBe(true);
  });

  it("10 tentativas máximas, já usou 5: continua com 5 restantes após bypass", () => {
    // Verifica que attempts=5 de maxAttempts=10 → ainda envia (5 restantes).
    const scheduledAt = new Date("2026-05-25T08:00:00.000Z"); // segunda 08:00 UTC
    const eff = effectiveSettings(scheduledAt, base);

    const ctx = makeCtx(eff, {
      now: new Date("2026-05-26T04:00:00.000Z"), // terça 04:00 UTC
      job: { id: "j", attempts: 5, maxAttempts: 10, createdAt: new Date("2026-05-20T00:00:00.000Z") },
    });
    const d = evaluateFollowUpNeed(ctx);
    expect(d.shouldSend).toBe(true);
    expect(d.skipReason).toBeNull();
  });

  it("America/Sao_Paulo: agendado 11:00 UTC (= 08:00 BRT) + cron 04:00 UTC → bypass, shouldSend=true", () => {
    // BRT = UTC-3. 11:00 UTC = 08:00 BRT (dentro da janela 08-20 BRT).
    const scheduledAt = new Date("2026-05-22T11:00:00.000Z"); // sexta 08:00 BRT
    const settings: AgentFollowUpInteligente = {
      ...base,
      timezone: "America/Sao_Paulo",
      horaInicio: 8,
      horaFim: 20,
    };
    const eff = effectiveSettings(scheduledAt, settings);
    expect(eff.usarHorarioComercial).toBe(false);

    const ctx = makeCtx(eff, { now: new Date("2026-05-23T04:00:00.000Z") }); // sábado 01:00 BRT
    const d = evaluateFollowUpNeed(ctx);
    expect(d.businessHoursBlocked).toBe(false);
    expect(d.shouldSend).toBe(true);
  });

  it("cooldown ativo no bypass: ainda respeita cooldown mesmo com usarHorarioComercial=false", () => {
    // O bypass desativa apenas horário comercial. Cooldown continua funcionando.
    const now = new Date("2026-05-26T04:00:00.000Z");
    const scheduledAt = new Date("2026-05-25T08:00:00.000Z");
    const eff = effectiveSettings(scheduledAt, base);

    const recentFollowUp = new Date(now.getTime() - 5 * 60_000); // 5 min atrás
    const ctx = makeCtx(eff, {
      now,
      lead: {
        id: "l",
        name: null,
        status: null,
        lastMessageAt: null,
        lastFollowUpAt: recentFollowUp,
        followUpCount: 1,
        followUpCooldownUntil: null,
      },
    });
    const d = evaluateFollowUpNeed(ctx);
    expect(d.shouldSend).toBe(false);
    expect(d.cooldownActive).toBe(true);
  });

  it("humano ativo no bypass: ainda respeita respeitarHumanoAtivo mesmo com bypass", () => {
    const scheduledAt = new Date("2026-05-25T08:00:00.000Z");
    const eff = effectiveSettings(scheduledAt, base);

    const ctx = makeCtx(eff, {
      now: new Date("2026-05-26T04:00:00.000Z"),
      conversationState: {
        humanPaused: true,
        pausedReason: "manual",
        handoffSuggested: false,
        conversationMode: null,
        archivedAt: null,
      },
    });
    const d = evaluateFollowUpNeed(ctx);
    expect(d.shouldSend).toBe(false);
    expect(d.humanBlocked).toBe(true);
  });
});

// ─── Janela de envio com minutos ─────────────────────────────────────────────
//
// horaInicio/horaFim mantêm compatibilidade como inteiros (0-23).
// Novos campos opcionais minutoInicio/minutoFim (0-59, fallback 0) permitem
// configurar e.g. 08:30 às 22:45.

describe("janela de envio com minutos", () => {
  // Janela: 08:30–22:45 UTC, seg-sex
  const settingsMin = {
    horaInicio: 8,
    minutoInicio: 30,
    horaFim: 22,
    minutoFim: 45,
    diasAtivos: [1, 2, 3, 4, 5] as number[],
    timezone: "UTC",
  };

  it("08:29 UTC → antes do início (08:30) → bloqueado", () => {
    const date = new Date("2026-05-22T08:29:00.000Z"); // sexta 08:29
    expect(isWithinBusinessHours(date, settingsMin)).toBe(false);
  });

  it("08:30 UTC → exatamente no início → permitido", () => {
    const date = new Date("2026-05-22T08:30:00.000Z"); // sexta 08:30
    expect(isWithinBusinessHours(date, settingsMin)).toBe(true);
  });

  it("08:31 UTC → depois do início → permitido", () => {
    const date = new Date("2026-05-22T08:31:00.000Z");
    expect(isWithinBusinessHours(date, settingsMin)).toBe(true);
  });

  it("22:44 UTC → antes do fim (22:45) → permitido", () => {
    const date = new Date("2026-05-22T22:44:00.000Z"); // sexta 22:44
    expect(isWithinBusinessHours(date, settingsMin)).toBe(true);
  });

  it("22:45 UTC → exatamente no fim → bloqueado (exclusivo)", () => {
    const date = new Date("2026-05-22T22:45:00.000Z"); // sexta 22:45
    expect(isWithinBusinessHours(date, settingsMin)).toBe(false);
  });

  it("22:46 UTC → depois do fim → bloqueado", () => {
    const date = new Date("2026-05-22T22:46:00.000Z");
    expect(isWithinBusinessHours(date, settingsMin)).toBe(false);
  });

  it("backward compat: sem minutoInicio/minutoFim → fallback 0, comportamento igual ao anterior", () => {
    // { horaInicio: 8, horaFim: 18 } sem minutos → equivale a 08:00–18:00
    const inside = new Date("2026-05-22T10:00:00.000Z"); // 10:00 UTC sexta
    const atEnd = new Date("2026-05-22T18:00:00.000Z"); // 18:00 UTC (exclusivo)
    const cfg = { horaInicio: 8, horaFim: 18, diasAtivos: [1, 2, 3, 4, 5] as number[] };
    expect(isWithinBusinessHours(inside, cfg)).toBe(true);
    expect(isWithinBusinessHours(atEnd, cfg)).toBe(false);
  });

  it("minutoInicio=0, minutoFim=0 explícitos → equivalente ao backward compat", () => {
    const cfg = { horaInicio: 8, minutoInicio: 0, horaFim: 18, minutoFim: 0, diasAtivos: [1, 2, 3, 4, 5] as number[] };
    const atStart = new Date("2026-05-22T08:00:00.000Z");
    const beforeStart = new Date("2026-05-22T07:59:00.000Z");
    expect(isWithinBusinessHours(atStart, cfg)).toBe(true);
    expect(isWithinBusinessHours(beforeStart, cfg)).toBe(false);
  });

  it("nextBusinessHourStart retorna 08:30 quando now=08:25 e início é 08:30", () => {
    const now = new Date("2026-05-22T08:25:00.000Z"); // sexta 08:25
    const next = nextBusinessHourStart(now, settingsMin);
    // Deve retornar exatamente 08:30 (5 passos de 1 minuto)
    expect(next.getUTCHours()).toBe(8);
    expect(next.getUTCMinutes()).toBe(30);
  });

  it("nextBusinessHourStart após fim da janela retorna 08:30 do dia seguinte útil", () => {
    // 22:50 UTC sexta → próxima janela é segunda 08:30 UTC (sábado/domingo fora)
    const now = new Date("2026-05-22T22:50:00.000Z"); // sexta 22:50
    const next = nextBusinessHourStart(now, settingsMin);
    expect(next.getUTCDay()).toBe(1); // segunda
    expect(next.getUTCHours()).toBe(8);
    expect(next.getUTCMinutes()).toBe(30);
  });

  it("America/Sao_Paulo: 11:25 UTC (= 08:25 BRT) com janela 08:30 BRT → bloqueado", () => {
    // BRT = UTC-3; 11:25Z = 08:25 BRT → antes de 08:30 → false
    const date = new Date("2026-05-22T11:25:00.000Z");
    const cfg = {
      horaInicio: 8, minutoInicio: 30,
      horaFim: 22, minutoFim: 0,
      diasAtivos: [1, 2, 3, 4, 5] as number[],
      timezone: "America/Sao_Paulo",
    };
    expect(isWithinBusinessHours(date, cfg)).toBe(false);
  });

  it("America/Sao_Paulo: 11:35 UTC (= 08:35 BRT) com janela 08:30 BRT → permitido", () => {
    // BRT = UTC-3; 11:35Z = 08:35 BRT → depois de 08:30 → true
    const date = new Date("2026-05-22T11:35:00.000Z");
    const cfg = {
      horaInicio: 8, minutoInicio: 30,
      horaFim: 22, minutoFim: 0,
      diasAtivos: [1, 2, 3, 4, 5] as number[],
      timezone: "America/Sao_Paulo",
    };
    expect(isWithinBusinessHours(date, cfg)).toBe(true);
  });
});
