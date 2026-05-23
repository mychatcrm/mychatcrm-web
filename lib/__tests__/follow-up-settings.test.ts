import { describe, expect, it } from "vitest";
import { followUpInteligenteFromMetadata, DEFAULT_FOLLOW_UP_INTELIGENTE } from "@/lib/server/follow-up-settings";

describe("followUpInteligenteFromMetadata", () => {
  it("returns defaults when metadata is empty", () => {
    const result = followUpInteligenteFromMetadata(null);
    expect(result.ativo).toBe(false);
    expect(result.tentativasContato).toBe(3);
    expect(result.intervaloVerificacaoMinutos).toBe(60);
    expect(result.modo).toBe("moderado");
    expect(result.cooldownMinutos).toBe(60);
    expect(result.slaHorasResposta).toBeNull();
    expect(result.horaInicio).toBe(8);
    expect(result.horaFim).toBe(18);
    expect(result.diasAtivos).toEqual([1, 2, 3, 4, 5]);
    expect(result.retomadaApenasSeHumanoAbandonou).toBe(false);
  });

  it("parses active follow-up settings from agent metadata", () => {
    const result = followUpInteligenteFromMetadata({
      followUpInteligente: {
        ativo: true,
        tentativasContato: 5,
        intervaloVerificacaoMinutos: 30,
        modo: "agressivo",
        cooldownMinutos: 45,
        slaHorasResposta: 12,
        horaInicio: 9,
        horaFim: 17,
        diasAtivos: [1, 2, 3, 4, 5, 6],
        retomadaApenasSeHumanoAbandonou: true,
      },
    });
    expect(result).toEqual({
      ativo: true,
      tentativasContato: 5,
      intervaloVerificacaoMinutos: 30,
      modo: "agressivo",
      cooldownMinutos: 45,
      slaHorasResposta: 12,
      horaInicio: 9,
      horaFim: 17,
      diasAtivos: [1, 2, 3, 4, 5, 6],
      retomadaApenasSeHumanoAbandonou: true,
    });
  });

  it("rejects invalid modo and falls back to moderado", () => {
    const result = followUpInteligenteFromMetadata({
      followUpInteligente: { ativo: true, tentativasContato: 3, intervaloVerificacaoMinutos: 60, modo: "invalid" },
    });
    expect(result.modo).toBe("moderado");
  });

  it("handles legacy metadata without new fields gracefully", () => {
    const result = followUpInteligenteFromMetadata({
      followUpInteligente: { ativo: true, tentativasContato: 2, intervaloVerificacaoMinutos: 120 },
    });
    expect(result.ativo).toBe(true);
    expect(result.modo).toBe("moderado");
    expect(result.horaInicio).toBe(8);
    expect(result.diasAtivos).toEqual([1, 2, 3, 4, 5]);
  });

  it("exports DEFAULT_FOLLOW_UP_INTELIGENTE with all new fields", () => {
    expect(DEFAULT_FOLLOW_UP_INTELIGENTE).toMatchObject({
      ativo: false,
      modo: "moderado",
      cooldownMinutos: 60,
      horaInicio: 8,
      horaFim: 18,
      diasAtivos: [1, 2, 3, 4, 5],
      retomadaApenasSeHumanoAbandonou: false,
    });
  });
});
