import { describe, expect, it } from "vitest";
import {
  computeMeetingQuotaState,
  getMeetingPlanLimits,
  includedSecondsPerMonth,
  resolveAudioRetentionUntil,
} from "@/lib/meetings/plan-limits";
import {
  audioExtensionFor,
  isAcceptedAudioMimeType,
  normalizeAudioMimeType,
  pickSupportedRecorderMimeType,
} from "@/lib/meetings/audio-formats";

describe("cotas por plano", () => {
  it("cobre todos os planos, inclusive os slugs antigos", () => {
    for (const plan of ["solo", "equipa", "escala", "enterprise", "profissional", "master"]) {
      const limits = getMeetingPlanLimits(plan);
      expect(limits.includedHoursPerMonth).toBeGreaterThan(0);
      expect(limits.audioRetentionDays).toBeGreaterThan(0);
    }
  });

  it("mantem o custo maximo do Solo abaixo de 15% da mensalidade", () => {
    // US$0,27/hora de audio processado, dolar a R$5,40, plano Solo a R$97.
    const custoMaximoBRL = getMeetingPlanLimits("solo").includedHoursPerMonth * 0.27 * 5.4;
    expect(custoMaximoBRL / 97).toBeLessThan(0.15);
  });

  it("cotas e retencao crescem com o plano", () => {
    const solo = getMeetingPlanLimits("solo");
    const equipa = getMeetingPlanLimits("equipa");
    const escala = getMeetingPlanLimits("escala");
    expect(solo.includedHoursPerMonth).toBeLessThan(equipa.includedHoursPerMonth);
    expect(equipa.includedHoursPerMonth).toBeLessThan(escala.includedHoursPerMonth);
    expect(solo.audioRetentionDays).toBeLessThan(equipa.audioRetentionDays);
  });

  it("converte horas incluidas em segundos", () => {
    expect(includedSecondsPerMonth("solo")).toBe(getMeetingPlanLimits("solo").includedHoursPerMonth * 3600);
  });
});

describe("retencao do audio", () => {
  it("conta os dias do plano a partir da data informada", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const until = resolveAudioRetentionUntil("solo", from);
    const dias = Math.round((until.getTime() - from.getTime()) / 86_400_000);
    expect(dias).toBe(getMeetingPlanLimits("solo").audioRetentionDays);
  });

  it("nao altera a data recebida", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    resolveAudioRetentionUntil("escala", from);
    expect(from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("estado da cota", () => {
  it("avisa em 80% e bloqueia em 100%", () => {
    const total = includedSecondsPerMonth("solo");
    expect(computeMeetingQuotaState({ plan: "solo", usedSeconds: total * 0.5 }).shouldWarn).toBe(false);
    expect(computeMeetingQuotaState({ plan: "solo", usedSeconds: total * 0.8 }).shouldWarn).toBe(true);
    expect(computeMeetingQuotaState({ plan: "solo", usedSeconds: total }).exhausted).toBe(true);
  });

  it("soma o bloco extra contratado", () => {
    const total = includedSecondsPerMonth("solo");
    const state = computeMeetingQuotaState({
      plan: "solo",
      usedSeconds: total,
      bonusSeconds: 20 * 3600,
    });
    expect(state.exhausted).toBe(false);
    expect(state.remainingSeconds).toBe(20 * 3600);
  });

  it("nao devolve saldo negativo quando o consumo passa do teto", () => {
    const state = computeMeetingQuotaState({ plan: "solo", usedSeconds: 999_999 });
    expect(state.remainingSeconds).toBe(0);
    expect(state.exhausted).toBe(true);
  });

  it("ignora valores negativos vindos do banco", () => {
    const state = computeMeetingQuotaState({ plan: "solo", usedSeconds: -50, bonusSeconds: -10 });
    expect(state.usedSeconds).toBe(0);
    expect(state.bonusSeconds).toBe(0);
  });
});

describe("formatos de audio", () => {
  it("normaliza o mime type com codec", () => {
    expect(normalizeAudioMimeType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(normalizeAudioMimeType("  AUDIO/MP4  ")).toBe("audio/mp4");
  });

  it("aceita o que o Safari grava e o que os gravadores de celular produzem", () => {
    for (const mime of ["audio/mp4", "audio/webm", "audio/mpeg", "audio/x-m4a", "audio/amr", "video/mp4"]) {
      expect(isAcceptedAudioMimeType(mime)).toBe(true);
    }
  });

  it("recusa o que nao e audio", () => {
    for (const mime of ["application/pdf", "image/png", "text/plain", ""]) {
      expect(isAcceptedAudioMimeType(mime)).toBe(false);
      expect(audioExtensionFor(mime)).toBeNull();
    }
  });

  it("deriva a extensao do mime type, nunca do nome do arquivo", () => {
    expect(audioExtensionFor("audio/mp4")).toBe("m4a");
    expect(audioExtensionFor("audio/webm;codecs=opus")).toBe("webm");
    expect(audioExtensionFor("audio/mpeg")).toBe("mp3");
  });

  it("prefere opus, mas cai para audio/mp4 no Safari", () => {
    expect(pickSupportedRecorderMimeType((t) => t.includes("opus"))).toBe("audio/webm;codecs=opus");
    // Safari so suporta audio/mp4 — sem esse degrau, gravar no iPhone nao acontece.
    expect(pickSupportedRecorderMimeType((t) => t === "audio/mp4")).toBe("audio/mp4");
    expect(pickSupportedRecorderMimeType(() => false)).toBeNull();
  });
});
