/**
 * Agrupamento de trechos para a busca.
 *
 * Indexar segmento a segmento produziria resultados sem contexto ("sim, pode
 * ser"), inúteis numa busca entre reuniões. Agrupar preserva a vizinhança da
 * conversa e mantém a âncora de tempo do primeiro segmento do bloco.
 */
import { describe, expect, it } from "vitest";
import { buildSearchChunks } from "@/lib/server/meeting-search";
import type { NormalizedSegment } from "@/lib/server/meeting-transcription";

function segment(idx: number, text: string, startMs: number): NormalizedSegment {
  return { idx, speakerLabel: "A", startMs, endMs: startMs + 3000, text, confidence: null };
}

describe("buildSearchChunks", () => {
  it("agrupa segmentos curtos num único trecho", () => {
    const chunks = buildSearchChunks([
      segment(0, "Bom dia pessoal", 0),
      segment(1, "Vamos falar do orçamento", 4000),
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toContain("Bom dia");
    expect(chunks[0]!.content).toContain("orçamento");
  });

  it("mantém o início do bloco como âncora de tempo", () => {
    const chunks = buildSearchChunks([segment(0, "primeiro", 5000), segment(1, "segundo", 9000)]);
    expect(chunks[0]!.startMs).toBe(5000);
    expect(chunks[0]!.endMs).toBe(12_000);
  });

  it("quebra em vários trechos quando passa do tamanho alvo", () => {
    const longo = Array.from({ length: 20 }, (_, index) =>
      segment(index, "palavra ".repeat(30).trim(), index * 4000),
    );
    const chunks = buildSearchChunks(longo);
    expect(chunks.length).toBeGreaterThan(1);
    // idx tem de ser denso: é chave única no banco.
    expect(chunks.map((chunk) => chunk.idx)).toEqual(chunks.map((_, index) => index));
  });

  it("respeita o teto de tamanho da coluna", () => {
    const enorme = [segment(0, "x".repeat(20_000), 0)];
    const chunks = buildSearchChunks(enorme);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(6000);
    }
  });

  it("devolve lista vazia para transcrição vazia", () => {
    expect(buildSearchChunks([])).toEqual([]);
  });

  it("não cria trecho vazio quando os segmentos são só espaço", () => {
    expect(buildSearchChunks([segment(0, "   ", 0)])).toEqual([]);
  });
});
