import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOLLOW_UP_INTELIGENTE,
  followUpInteligenteFromMetadata,
} from "@/lib/server/follow-up-settings";

describe("followUpInteligenteFromMetadata", () => {
  it("returns safe defaults when metadata is empty", () => {
    expect(followUpInteligenteFromMetadata(null)).toEqual(DEFAULT_FOLLOW_UP_INTELIGENTE);
  });

  it("parses all configurable fields", () => {
    const result = followUpInteligenteFromMetadata({
      followUpInteligente: {
        ativo: true,
        tentativasContato: 5,
        intervaloVerificacaoMinutos: 30,
        modo: "agressivo",
        cooldownAtivo: true,
        cooldownMinutos: 120,
        usarHorarioComercial: false,
        horaInicio: 9,
        horaFim: 17,
        diasAtivos: [1, 2, 3],
        respeitarHumanoAtivo: false,
        retomadaApenasSeHumanoAbandonou: true,
        bloquearSeLeadRespondeu: false,
        bloquearTarefaFutura: false,
        bloquearStatusPerdido: false,
        permitirSlaVencido: true,
        slaHorasResposta: 8,
        desativarAposEncerrar: false,
        usarDadosFormularioMeta: false,
        usarHistoricoCrm: false,
        usarHistoricoWhatsapp: false,
      },
    });
    expect(result.ativo).toBe(true);
    expect(result.cooldownMinutos).toBe(120);
    expect(result.usarHorarioComercial).toBe(false);
    expect(result.respeitarHumanoAtivo).toBe(false);
    expect(result.slaHorasResposta).toBe(8);
    expect(result.usarHistoricoWhatsapp).toBe(false);
  });

  it("clears SLA when permitirSlaVencido is false", () => {
    const result = followUpInteligenteFromMetadata({
      followUpInteligente: { ativo: true, permitirSlaVencido: false, slaHorasResposta: 12 },
    });
    expect(result.slaHorasResposta).toBeNull();
  });

  it("merges legacy metadata with new defaults", () => {
    const result = followUpInteligenteFromMetadata({
      followUpInteligente: { ativo: true, tentativasContato: 2, intervaloVerificacaoMinutos: 90 },
    });
    expect(result.respeitarHumanoAtivo).toBe(true);
    expect(result.cooldownMinutos).toBe(24 * 60);
    expect(result.permitirSlaVencido).toBe(true);
    expect(result.slaHorasResposta).toBe(4);
  });

  it("uses root timezone when followUpInteligente is absent", () => {
    const result = followUpInteligenteFromMetadata({
      timezone: "America/Sao_Paulo",
    });
    expect(result.timezone).toBe("America/Sao_Paulo");
    expect(result.ativo).toBe(false);
  });

  it("uses metadata.timezone at root when set", () => {
    const result = followUpInteligenteFromMetadata({
      timezone: "America/Sao_Paulo",
      followUpInteligente: { ativo: true },
    });
    expect(result.timezone).toBe("America/Sao_Paulo");
  });

  it("prefers root timezone over nested followUpInteligente.timezone", () => {
    const result = followUpInteligenteFromMetadata({
      timezone: "Europe/Lisbon",
      followUpInteligente: { ativo: true, timezone: "UTC" },
    });
    expect(result.timezone).toBe("Europe/Lisbon");
  });

  it("falls back to nested timezone for legacy agents", () => {
    const result = followUpInteligenteFromMetadata({
      followUpInteligente: { ativo: true, timezone: "America/New_York" },
    });
    expect(result.timezone).toBe("America/New_York");
  });
});
