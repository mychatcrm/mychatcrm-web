/**
 * Normalização da transcrição e adaptador do provedor.
 *
 * O que está em jogo aqui é a legibilidade da tela principal do módulo (a
 * transcrição) e a âncora de tempo que sustenta toda a regra anti-alucinação da
 * análise: sem `startMs` correto, clicar no texto leva ao trecho errado do
 * áudio e cada item extraído perde a prova.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assemblyAiProvider,
  collectSpeakerLabels,
  normalizeTranscriptSegments,
  resolveTranscriptionProvider,
  whisperFallbackProvider,
  type RawUtterance,
} from "@/lib/server/meeting-transcription";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("normalizeTranscriptSegments", () => {
  it("junta falas contíguas do mesmo falante", () => {
    const segments = normalizeTranscriptSegments([
      { speaker: "A", start: 0, end: 900, text: "Bom dia" },
      { speaker: "A", start: 1200, end: 2000, text: "pessoal" },
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe("Bom dia pessoal");
    expect(segments[0]?.endMs).toBe(2000);
  });

  it("não junta quando o falante muda", () => {
    const segments = normalizeTranscriptSegments([
      { speaker: "A", start: 0, end: 900, text: "Bom dia" },
      { speaker: "B", start: 1000, end: 2000, text: "Bom dia" },
    ]);
    expect(segments).toHaveLength(2);
  });

  it("não junta quando há pausa longa entre as falas", () => {
    const segments = normalizeTranscriptSegments([
      { speaker: "A", start: 0, end: 900, text: "Vou pensar" },
      { speaker: "A", start: 9000, end: 10000, text: "Decidi que sim" },
    ]);
    expect(segments).toHaveLength(2);
  });

  it("remove disfluência repetida", () => {
    const segments = normalizeTranscriptSegments([
      { speaker: "A", start: 0, end: 500, text: "é é é então a gente vai" },
    ]);
    expect(segments[0]?.text).toBe("é então a gente vai");
  });

  it("quebra fala muito longa repartindo o tempo proporcionalmente", () => {
    const longText = "palavra ".repeat(200).trim();
    const segments = normalizeTranscriptSegments([
      { speaker: "A", start: 0, end: 60_000, text: longText },
    ]);
    expect(segments.length).toBeGreaterThan(1);
    // O tempo tem que avançar junto com o texto, senão clicar no meio da fala
    // leva o áudio para o começo dela.
    expect(segments[1]!.startMs).toBeGreaterThan(segments[0]!.startMs);
    expect(segments.at(-1)!.endMs).toBeLessThanOrEqual(60_000);
  });

  it("mantém idx denso e crescente — é a chave única no banco", () => {
    const segments = normalizeTranscriptSegments([
      { speaker: "A", start: 0, end: 100, text: "um" },
      { speaker: "A", start: 5000, end: 5100, text: "dois" },
      { speaker: "B", start: 6000, end: 6100, text: "três" },
    ]);
    expect(segments.map((s) => s.idx)).toEqual([0, 1, 2]);
  });

  it("descarta falas vazias sem furar a sequência", () => {
    const segments = normalizeTranscriptSegments([
      { speaker: "A", start: 0, end: 100, text: "um" },
      { speaker: "A", start: 5000, end: 5100, text: "   " },
      { speaker: "B", start: 6000, end: 6100, text: "dois" },
    ]);
    expect(segments).toHaveLength(2);
    expect(segments.map((s) => s.idx)).toEqual([0, 1]);
  });

  it("nunca deixa endMs antes de startMs", () => {
    const segments = normalizeTranscriptSegments([
      { speaker: "A", start: 5000, end: 1000, text: "invertido" },
    ]);
    expect(segments[0]!.endMs).toBeGreaterThanOrEqual(segments[0]!.startMs);
  });

  it("tolera campos ausentes ou inválidos do provedor", () => {
    const hostile = [
      { text: "sem tempo" },
      { speaker: null, start: null, end: null, text: "nulos" },
      { start: Number.NaN, end: Number.NaN, text: "nan" },
    ] as RawUtterance[];
    expect(() => normalizeTranscriptSegments(hostile)).not.toThrow();
    expect(normalizeTranscriptSegments(hostile).length).toBeGreaterThan(0);
  });
});

describe("collectSpeakerLabels", () => {
  it("devolve rótulos únicos e ordenados", () => {
    const segments = normalizeTranscriptSegments([
      { speaker: "B", start: 0, end: 100, text: "um" },
      { speaker: "A", start: 5000, end: 5100, text: "dois" },
      { speaker: "B", start: 10000, end: 10100, text: "três" },
    ]);
    expect(collectSpeakerLabels(segments)).toEqual(["A", "B"]);
  });

  it("devolve lista vazia quando não houve diarização", () => {
    const segments = normalizeTranscriptSegments([{ start: 0, end: 100, text: "sem falante" }]);
    expect(collectSpeakerLabels(segments)).toEqual([]);
  });
});

describe("escolha de provedor", () => {
  it("usa AssemblyAI por padrão", () => {
    vi.stubEnv("TRANSCRIPTION_PROVIDER", "");
    expect(resolveTranscriptionProvider().name).toBe("assemblyai");
  });

  it('"openai" aponta para o modelo com diarização, não para o Whisper', () => {
    // O Whisper continua alcançável, mas por nome explícito: ele não separa
    // falantes, e virar o padrão de "openai" por engano degradaria o produto
    // em silêncio.
    vi.stubEnv("TRANSCRIPTION_PROVIDER", "openai");
    expect(resolveTranscriptionProvider().name).toBe("openai_diarize");
    vi.stubEnv("TRANSCRIPTION_PROVIDER", "whisper");
    expect(resolveTranscriptionProvider().name).toBe("openai_whisper");
  });

  it("declara honestamente quem separa falantes", () => {
    expect(assemblyAiProvider.supportsDiarization).toBe(true);
    expect(whisperFallbackProvider.supportsDiarization).toBe(false);
  });
});

describe("adaptador AssemblyAI", () => {
  function mockFetchOnce(payload: unknown, ok = true, status = 200) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok,
        status,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      })) as unknown as typeof fetch,
    );
  }

  it("exige a chave configurada antes de chamar a rede", async () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", "");
    await expect(assemblyAiProvider.fetchResult("t-1")).rejects.toThrow(
      "transcription_provider_unconfigured",
    );
  });

  it("normaliza utterances e capítulos", async () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", "key");
    mockFetchOnce({
      status: "completed",
      language_code: "pt",
      audio_duration: 120,
      utterances: [
        { speaker: "A", start: 0, end: 2000, text: "Bom dia", confidence: 0.9 },
        { speaker: "B", start: 3000, end: 5000, text: "Bom dia", confidence: 0.8 },
      ],
      chapters: [{ headline: "Abertura", summary: "Cumprimentos", start: 0, end: 5000 }],
    });

    const result = await assemblyAiProvider.fetchResult("t-1");
    expect(result.provider).toBe("assemblyai");
    expect(result.durationMs).toBe(120_000);
    expect(result.segments).toHaveLength(2);
    expect(result.speakerLabels).toEqual(["A", "B"]);
    expect(result.chapters[0]?.title).toBe("Abertura");
    expect(result.hasDiarization).toBe(true);
  });

  it("degrada para bloco único quando o provedor não separou falantes", async () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", "key");
    mockFetchOnce({ status: "completed", text: "Conversa inteira sem separação.", utterances: [] });

    const result = await assemblyAiProvider.fetchResult("t-1");
    // Perder a diarização é ruim; perder a reunião seria pior.
    expect(result.segments).toHaveLength(1);
    expect(result.hasDiarization).toBe(false);
  });

  it("recusa resultado ainda em processamento", async () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", "key");
    mockFetchOnce({ status: "processing" });
    await expect(assemblyAiProvider.fetchResult("t-1")).rejects.toThrow("transcription_not_ready");
  });

  it("propaga erro do provedor sem vazar a mensagem crua", async () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", "key");
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetchOnce({ status: "error", error: "audio file is not accessible at https://secret-url" });
    await expect(assemblyAiProvider.fetchResult("t-1")).rejects.toThrow(
      "transcription_provider_error",
    );
  });

  it("recusa transcrição vazia em vez de gravar reunião sem conteúdo", async () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", "key");
    mockFetchOnce({ status: "completed", utterances: [], text: "" });
    await expect(assemblyAiProvider.fetchResult("t-1")).rejects.toThrow("transcription_empty");
  });
});

// ── Escolha por duração ─────────────────────────────────────────────────────

describe("provedor por duração", () => {
  it("usa a OpenAI para reunião curta quando configurada", async () => {
    vi.stubEnv("TRANSCRIPTION_PROVIDER", "openai");
    vi.stubEnv("ASSEMBLYAI_API_KEY", "key");
    const { resolveProviderForDuration } = await import("@/lib/server/meeting-transcription");
    // 20 min: cabe no teto de 1400 s do modelo.
    expect(resolveProviderForDuration(20 * 60_000).name).toBe("openai_diarize");
  });

  it("troca para o provedor assíncrono acima do teto de 23 min", async () => {
    vi.stubEnv("TRANSCRIPTION_PROVIDER", "openai");
    vi.stubEnv("ASSEMBLYAI_API_KEY", "key");
    const { resolveProviderForDuration } = await import("@/lib/server/meeting-transcription");
    // Fatiar traria o problema de costurar falantes entre pedaços.
    expect(resolveProviderForDuration(60 * 60_000).name).toBe("assemblyai");
  });

  it("mantém a OpenAI quando não há chave do provedor assíncrono", async () => {
    vi.stubEnv("TRANSCRIPTION_PROVIDER", "openai");
    vi.stubEnv("ASSEMBLYAI_API_KEY", "");
    const { resolveProviderForDuration } = await import("@/lib/server/meeting-transcription");
    // Falhar com código claro é melhor que fingir que não dá para processar.
    expect(resolveProviderForDuration(60 * 60_000).name).toBe("openai_diarize");
  });

  it("não desvia quando o provedor configurado já aceita horas", async () => {
    vi.stubEnv("TRANSCRIPTION_PROVIDER", "assemblyai");
    const { resolveProviderForDuration } = await import("@/lib/server/meeting-transcription");
    expect(resolveProviderForDuration(60 * 60_000).name).toBe("assemblyai");
  });

  it("duração desconhecida não força a troca", async () => {
    vi.stubEnv("TRANSCRIPTION_PROVIDER", "openai");
    vi.stubEnv("ASSEMBLYAI_API_KEY", "key");
    const { resolveProviderForDuration } = await import("@/lib/server/meeting-transcription");
    expect(resolveProviderForDuration(null).name).toBe("openai_diarize");
  });

  it("o adaptador da OpenAI declara que separa falantes", async () => {
    const { openAiDiarizeProvider } = await import("@/lib/server/meeting-transcription");
    expect(openAiDiarizeProvider.supportsDiarization).toBe(true);
    // Síncrono: não tem resultado assíncrono para buscar.
    await expect(openAiDiarizeProvider.fetchResult("x")).rejects.toThrow();
  });
});
