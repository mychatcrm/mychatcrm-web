import { describe, expect, it } from "vitest";
import { followUpInteligenteFromMetadata } from "@/lib/server/follow-up-settings";

describe("followUpInteligenteFromMetadata", () => {
  it("returns defaults when metadata is empty", () => {
    expect(followUpInteligenteFromMetadata(null)).toEqual({
      ativo: false,
      tentativasContato: 3,
      intervaloVerificacaoMinutos: 60,
    });
  });

  it("parses active follow-up settings from agent metadata", () => {
    expect(
      followUpInteligenteFromMetadata({
        followUpInteligente: { ativo: true, tentativasContato: 5, intervaloVerificacaoMinutos: 30 },
      }),
    ).toEqual({
      ativo: true,
      tentativasContato: 5,
      intervaloVerificacaoMinutos: 30,
    });
  });
});
