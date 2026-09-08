/**
 * Barreira anti-alucinação da análise.
 *
 * O `json_schema strict` da OpenAI garante a FORMA da resposta, não a
 * VERACIDADE. Esta suíte cobre a segunda barreira: item sem âncora no áudio não
 * pode virar tarefa na agenda de ninguém.
 */
import { describe, expect, it } from "vitest";
import {
  formatTimestamp,
  formatTranscriptForPrompt,
  sanitizeMeetingAnalysis,
} from "@/lib/server/meeting-analysis";
import { MEETING_ANALYSIS_RESPONSE_FORMAT } from "@/lib/ai/prompts/meeting-analysis";
import type { NormalizedSegment } from "@/lib/server/meeting-transcription";

function segment(patch: Partial<NormalizedSegment> = {}): NormalizedSegment {
  return { idx: 0, speakerLabel: "A", startMs: 0, endMs: 1000, text: "fala", confidence: 0.9, ...patch };
}

describe("formatTimestamp", () => {
  it("usa mm:ss abaixo de uma hora e hh:mm:ss acima", () => {
    expect(formatTimestamp(0)).toBe("00:00");
    expect(formatTimestamp(222_000)).toBe("03:42");
    expect(formatTimestamp(3_723_000)).toBe("01:02:03");
  });

  it("não quebra com valor negativo", () => {
    expect(formatTimestamp(-5000)).toBe("00:00");
  });
});

describe("formatTranscriptForPrompt", () => {
  it("inclui o milissegundo bruto — é o que permite exigir atMs de cada item", () => {
    const text = formatTranscriptForPrompt([segment({ startMs: 222_000, text: "orçamento" })]);
    expect(text).toContain("222000ms");
    expect(text).toContain("03:42");
  });

  it("usa o nome confirmado do falante quando existe", () => {
    const text = formatTranscriptForPrompt([segment()], { A: "Renato" });
    expect(text).toContain("Renato:");
    expect(text).not.toContain("Falante A:");
  });

  it("cai para o rótulo quando o falante não foi nomeado", () => {
    expect(formatTranscriptForPrompt([segment()])).toContain("Falante A:");
  });

  it("marca fala sem diarização sem inventar falante", () => {
    expect(formatTranscriptForPrompt([segment({ speakerLabel: null })])).toContain("Fala:");
  });
});

describe("sanitizeMeetingAnalysis", () => {
  const base = {
    summaryShort: "Resumo curto.",
    summaryLong: "Resumo longo.",
    actionItems: [],
    decisions: [],
    highlights: [],
    nextSteps: [],
    openQuestions: [],
    topics: [],
    speakerNameGuesses: [],
    templateFields: {},
    sentimentOverall: "neutro",
  };

  it("descarta tarefa sem âncora no áudio", () => {
    const result = sanitizeMeetingAnalysis(
      { ...base, actionItems: [{ text: "Criar anúncios", atMs: null, priority: "alta" }] },
      { durationMs: 600_000 },
    );
    expect(result.actionItems).toHaveLength(0);
    expect(result.droppedItems).toBe(1);
  });

  it("descarta item cuja âncora passa da duração do áudio", () => {
    // O modelo não pode ter ouvido algo que não existe: âncora além do fim é
    // prova de invenção.
    const result = sanitizeMeetingAnalysis(
      { ...base, decisions: [{ text: "Aprovar orçamento", atMs: 900_000 }] },
      { durationMs: 600_000 },
    );
    expect(result.decisions).toHaveLength(0);
    expect(result.droppedItems).toBe(1);
  });

  it("tolera folga de arredondamento do provedor", () => {
    const result = sanitizeMeetingAnalysis(
      { ...base, decisions: [{ text: "Aprovar", atMs: 602_000 }] },
      { durationMs: 600_000 },
    );
    expect(result.decisions).toHaveLength(1);
  });

  it("aceita âncora quando a duração é desconhecida", () => {
    const result = sanitizeMeetingAnalysis(
      { ...base, decisions: [{ text: "Aprovar", atMs: 900_000 }] },
      { durationMs: null },
    );
    expect(result.decisions).toHaveLength(1);
  });

  it("mantém tarefa válida com todos os campos", () => {
    const result = sanitizeMeetingAnalysis(
      {
        ...base,
        actionItems: [
          {
            text: "Enviar proposta",
            assigneeName: "João",
            dueDate: "2026-09-10",
            dueDateInferred: true,
            priority: "alta",
            atMs: 120_000,
          },
        ],
      },
      { durationMs: 600_000 },
    );
    expect(result.actionItems[0]).toMatchObject({
      text: "Enviar proposta",
      assigneeRaw: "João",
      dueDate: "2026-09-10",
      dueDateInferred: true,
      priority: "alta",
      atMs: 120_000,
    });
  });

  it("anula prazo em formato inválido em vez de gravar lixo", () => {
    const result = sanitizeMeetingAnalysis(
      {
        ...base,
        actionItems: [{ text: "Tarefa", dueDate: "semana que vem", priority: "alta", atMs: 1000 }],
      },
      { durationMs: 600_000 },
    );
    expect(result.actionItems[0]?.dueDate).toBeNull();
  });

  it("cai para prioridade média quando vem valor fora do enum", () => {
    const result = sanitizeMeetingAnalysis(
      { ...base, actionItems: [{ text: "Tarefa", priority: "urgentíssima", atMs: 1000 }] },
      { durationMs: 600_000 },
    );
    expect(result.actionItems[0]?.priority).toBe("media");
  });

  it("não preenche responsável quando o modelo devolveu null", () => {
    // Preencher por dedução aqui viraria tarefa atribuída à pessoa errada.
    const result = sanitizeMeetingAnalysis(
      { ...base, actionItems: [{ text: "Tarefa", assigneeName: null, priority: "media", atMs: 1000 }] },
      { durationMs: 600_000 },
    );
    expect(result.actionItems[0]?.assigneeRaw).toBeNull();
  });

  it("descarta sugestão de nome sem rótulo ou sem nome", () => {
    const result = sanitizeMeetingAnalysis(
      {
        ...base,
        speakerNameGuesses: [
          { label: "A", guessedName: "Renato", evidenceAtMs: 5000, confidence: 0.8 },
          { label: "", guessedName: "Fantasma", evidenceAtMs: 1000, confidence: 0.9 },
          { label: "B", guessedName: "", evidenceAtMs: 1000, confidence: 0.9 },
        ],
      },
      { durationMs: 600_000 },
    );
    expect((result.payload.speakerNameGuesses as unknown[]).length).toBe(1);
  });

  it("normaliza sentimento fora do enum para null", () => {
    const result = sanitizeMeetingAnalysis(
      { ...base, sentimentOverall: "eufórico" },
      { durationMs: 600_000 },
    );
    expect(result.payload.sentimentOverall).toBeNull();
  });

  it("sobrevive a resposta truncada ou vazia", () => {
    expect(() => sanitizeMeetingAnalysis(null, { durationMs: 600_000 })).not.toThrow();
    expect(() => sanitizeMeetingAnalysis("texto solto", { durationMs: 600_000 })).not.toThrow();
    const result = sanitizeMeetingAnalysis({ summaryShort: "só isso" }, { durationMs: 600_000 });
    expect(result.summaryShort).toBe("só isso");
    expect(result.actionItems).toEqual([]);
  });
});

describe("schema da resposta", () => {
  it("declara todas as propriedades como obrigatórias — exigência do modo strict", () => {
    const schema = MEETING_ANALYSIS_RESPONSE_FORMAT.schema;
    const declared = Object.keys(schema.properties);
    // Em strict a OpenAI recusa o schema se `required` não listar tudo.
    expect([...schema.required].sort()).toEqual(declared.sort());
    expect(schema.additionalProperties).toBe(false);
  });

  it("exige atMs em todo item extraível", () => {
    const props = MEETING_ANALYSIS_RESPONSE_FORMAT.schema.properties as Record<
      string,
      { items?: { required?: readonly string[] } }
    >;
    for (const key of ["highlights", "decisions", "actionItems", "nextSteps", "openQuestions"]) {
      expect(props[key]?.items?.required).toContain("atMs");
    }
  });
});
