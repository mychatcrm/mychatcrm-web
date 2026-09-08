import "server-only";

import { transcribeAudioFromBuffer } from "@/lib/ai/media-processor";
import { resolveOpenAiApiKey } from "@/lib/ai/openai-api-key";
import { getMediaBufferFromR2 } from "@/lib/integrations/r2-storage";
import { integrationLog } from "@/lib/integrations/logger";

/** Segmento já normalizado, no formato que o banco guarda. */
export type NormalizedSegment = {
  idx: number;
  speakerLabel: string | null;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number | null;
};

export type NormalizedChapter = {
  title: string;
  summary: string;
  startMs: number;
  endMs: number;
};

export type NormalizedTranscript = {
  provider: string;
  languageCode: string | null;
  durationMs: number | null;
  segments: NormalizedSegment[];
  speakerLabels: string[];
  chapters: NormalizedChapter[];
  /** `false` quando a transcrição veio sem separação de falantes (fallback). */
  hasDiarization: boolean;
};

/**
 * Como o provedor devolve o trabalho.
 *
 * `async` é o caminho bom: o provedor processa fora e chama nosso webhook, o
 * que elimina qualquer função longa na Vercel. `sync` existe só para o Whisper,
 * que não tem webhook — nele o worker faz a transcrição inline, e por isso o
 * fallback só serve para áudios curtos.
 */
export type TranscriptionSubmission =
  | { mode: "async"; providerJobId: string }
  | { mode: "sync"; transcript: NormalizedTranscript };

export type TranscriptionSubmitParams = {
  /** URL presignada de leitura — o áudio nunca é enviado pelo nosso servidor. */
  audioUrl: string;
  storageKey: string;
  mimeType: string;
  languageCode: string;
  webhookUrl: string;
  webhookSecret: string;
};

export interface TranscriptionProvider {
  readonly name: string;
  readonly supportsDiarization: boolean;
  submit(params: TranscriptionSubmitParams): Promise<TranscriptionSubmission>;
  fetchResult(providerJobId: string): Promise<NormalizedTranscript>;
}

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

/** Acima disto o bloco vira parágrafo próprio — evita linha gigante na tela. */
const MAX_SEGMENT_CHARS = 500;
/** Falas do mesmo falante separadas por menos que isto viram uma só. */
const MERGE_GAP_MS = 1_200;

export type RawUtterance = {
  speaker?: string | null;
  start?: number | null;
  end?: number | null;
  text?: string | null;
  confidence?: number | null;
};

/**
 * Disfluência repetida ("é... é... é") atrapalha a leitura e não agrega nada à
 * análise. Só a partir de TRÊS repetições: em português, duas costumam ser
 * ênfase legítima ("não não").
 *
 * Classes Unicode e lookarounds, não `\w` e `\b`: os dois últimos são ASCII em
 * JavaScript, e numa transcrição em português quase toda disfluência tem acento
 * — `\b(\w{1,3})` simplesmente não via "é é é".
 */
const REPEATED_FILLER = /(?<![\p{L}\p{N}])(\p{L}{1,3})(?:\s+\1){2,}(?![\p{L}\p{N}])/giu;

function cleanUtteranceText(value: string): string {
  return value.replace(/\s+/g, " ").replace(REPEATED_FILLER, "$1").trim();
}

/**
 * Junta falas contíguas do mesmo falante e recorta blocos longos.
 *
 * O bruto do provedor vem em unidades muito curtas; renderizar uma linha por
 * unidade produz uma transcrição ilegível e pesada. A normalização é derivada e
 * recalculável — o texto original de cada fala continua íntegro dentro do
 * bloco.
 */
export function normalizeTranscriptSegments(utterances: RawUtterance[]): NormalizedSegment[] {
  const segments: NormalizedSegment[] = [];

  for (const utterance of utterances) {
    const text = cleanUtteranceText(String(utterance?.text ?? ""));
    if (!text) continue;

    const startMs = Math.max(0, Math.round(Number(utterance?.start ?? 0)));
    const endMsRaw = Math.round(Number(utterance?.end ?? startMs));
    const endMs = Math.max(startMs, Number.isFinite(endMsRaw) ? endMsRaw : startMs);
    const speakerLabel = utterance?.speaker ? String(utterance.speaker).slice(0, 40) : null;
    const rawConfidence = Number(utterance?.confidence);
    const confidence = Number.isFinite(rawConfidence)
      ? Math.min(1, Math.max(0, rawConfidence))
      : null;

    const previous = segments[segments.length - 1];
    const canMerge =
      previous !== undefined &&
      previous.speakerLabel === speakerLabel &&
      startMs - previous.endMs <= MERGE_GAP_MS &&
      previous.text.length + text.length + 1 <= MAX_SEGMENT_CHARS;

    if (canMerge && previous) {
      previous.text = `${previous.text} ${text}`;
      previous.endMs = endMs;
      previous.confidence =
        previous.confidence === null || confidence === null
          ? null
          : (previous.confidence + confidence) / 2;
      continue;
    }

    // Fala única acima do teto: quebra em pedaços por limite de caracteres,
    // repartindo o tempo proporcionalmente para o clique continuar caindo perto
    // do trecho certo.
    if (text.length > MAX_SEGMENT_CHARS) {
      const parts = text.match(new RegExp(`.{1,${MAX_SEGMENT_CHARS}}(\\s|$)`, "g")) ?? [text];
      const spanMs = Math.max(1, endMs - startMs);
      let consumed = 0;
      for (const part of parts) {
        const chunk = part.trim();
        if (!chunk) continue;
        const from = startMs + Math.round((consumed / text.length) * spanMs);
        consumed += part.length;
        const to = startMs + Math.round((consumed / text.length) * spanMs);
        segments.push({
          idx: segments.length,
          speakerLabel,
          startMs: from,
          endMs: Math.max(from, Math.min(to, endMs)),
          text: chunk,
          confidence,
        });
      }
      continue;
    }

    segments.push({ idx: segments.length, speakerLabel, startMs, endMs, text, confidence });
  }

  // `idx` tem que ser dense e crescente: é a chave única no banco e a ordem de
  // leitura na tela.
  return segments.map((segment, index) => ({ ...segment, idx: index }));
}

export function collectSpeakerLabels(segments: NormalizedSegment[]): string[] {
  const labels = new Set<string>();
  for (const segment of segments) {
    if (segment.speakerLabel) labels.add(segment.speakerLabel);
  }
  return Array.from(labels).sort();
}

// ---------------------------------------------------------------------------
// AssemblyAI
// ---------------------------------------------------------------------------

const ASSEMBLYAI_BASE = "https://api.assemblyai.com/v2";

type AssemblyAiTranscript = {
  id?: string;
  status?: string;
  error?: string | null;
  language_code?: string | null;
  audio_duration?: number | null;
  text?: string | null;
  utterances?: RawUtterance[] | null;
  chapters?: Array<{
    headline?: string | null;
    gist?: string | null;
    summary?: string | null;
    start?: number | null;
    end?: number | null;
  }> | null;
};

function assemblyAiKey(): string {
  const key = process.env.ASSEMBLYAI_API_KEY?.trim();
  if (!key) throw new Error("transcription_provider_unconfigured");
  return key;
}

export const assemblyAiProvider: TranscriptionProvider = {
  name: "assemblyai",
  supportsDiarization: true,

  async submit(params) {
    const response = await fetch(`${ASSEMBLYAI_BASE}/transcript`, {
      method: "POST",
      headers: { Authorization: assemblyAiKey(), "Content-Type": "application/json" },
      body: JSON.stringify({
        audio_url: params.audioUrl,
        language_code: params.languageCode,
        // Lista ORDENADA de fallback, não execução paralela: tenta o carro-chefe
        // e cai para o modelo estável se ele não estiver disponível na conta.
        // Omitir o campo deixaria a API usar um default mais antigo.
        speech_models: ["universal-3-5-pro", "universal-2"],
        speaker_labels: true,
        // `auto_chapters` foi DEPRECIADO pelo provedor. Os capítulos passaram a
        // sair da própria análise da IA (`payload.chapters`), o que ainda economiza
        // uma chamada — eram duas fontes para a mesma linha do tempo.
        punctuate: true,
        format_text: true,
        webhook_url: params.webhookUrl,
        // O provedor devolve este cabeçalho no callback. É o que distingue um
        // fim de processamento real de alguém chutando o endpoint.
        webhook_auth_header_name: "x-transcription-secret",
        webhook_auth_header_value: params.webhookSecret,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      integrationLog("assemblyai", "error", "submit failed", {
        status: response.status,
        detail: detail.slice(0, 200),
      });
      throw new Error(`transcription_submit_http_${response.status}`);
    }

    const json = (await response.json()) as AssemblyAiTranscript;
    if (!json.id) throw new Error("transcription_submit_without_id");
    return { mode: "async", providerJobId: json.id };
  },

  async fetchResult(providerJobId) {
    const response = await fetch(`${ASSEMBLYAI_BASE}/transcript/${encodeURIComponent(providerJobId)}`, {
      headers: { Authorization: assemblyAiKey() },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`transcription_fetch_http_${response.status}`);

    const json = (await response.json()) as AssemblyAiTranscript;

    if (json.status === "error") {
      integrationLog("assemblyai", "error", "transcription failed", {
        detail: String(json.error ?? "").slice(0, 200),
      });
      throw new Error("transcription_provider_error");
    }
    if (json.status !== "completed") throw new Error("transcription_not_ready");

    const utterances = Array.isArray(json.utterances) ? json.utterances : [];
    // Sem `utterances` mas com texto: o provedor não conseguiu separar falantes.
    // Degrada para um único bloco em vez de perder a reunião.
    const segments = utterances.length
      ? normalizeTranscriptSegments(utterances)
      : normalizeTranscriptSegments(
          json.text ? [{ speaker: null, start: 0, end: 0, text: json.text }] : [],
        );

    if (segments.length === 0) throw new Error("transcription_empty");

    return {
      provider: "assemblyai",
      languageCode: json.language_code ?? null,
      durationMs:
        typeof json.audio_duration === "number" ? Math.round(json.audio_duration * 1000) : null,
      segments,
      speakerLabels: collectSpeakerLabels(segments),
      chapters: (json.chapters ?? []).flatMap((chapter) => {
        const title = String(chapter?.headline ?? chapter?.gist ?? "").trim();
        if (!title) return [];
        return [
          {
            title: title.slice(0, 200),
            summary: String(chapter?.summary ?? "").trim().slice(0, 1000),
            startMs: Math.max(0, Math.round(Number(chapter?.start ?? 0))),
            endMs: Math.max(0, Math.round(Number(chapter?.end ?? 0))),
          },
        ];
      }),
      hasDiarization: utterances.length > 0,
    };
  },
};

// ---------------------------------------------------------------------------
// Whisper (fallback) — sem diarização, sem webhook, limitado a ~25 MB
// ---------------------------------------------------------------------------

/** Limite duro da API de transcrição da OpenAI. */
const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

export const whisperFallbackProvider: TranscriptionProvider = {
  name: "openai_whisper",
  supportsDiarization: false,

  async submit(params) {
    const buffer = await getMediaBufferFromR2(params.storageKey);
    if (buffer.byteLength > WHISPER_MAX_BYTES) {
      // Fatiar aqui produziria uma transcrição pior e um worker longo. O
      // caminho certo é o provedor primário voltar.
      throw new Error("transcription_fallback_file_too_large");
    }

    const text = await transcribeAudioFromBuffer(buffer, params.mimeType);
    if (!text) throw new Error("transcription_empty");

    const segments = normalizeTranscriptSegments([
      { speaker: null, start: 0, end: 0, text },
    ]);

    return {
      mode: "sync",
      transcript: {
        provider: "openai_whisper",
        languageCode: params.languageCode,
        durationMs: null,
        segments,
        speakerLabels: [],
        chapters: [],
        // A interface avisa: "sem identificação de falantes". Degradação
        // visível, nunca silenciosa.
        hasDiarization: false,
      },
    };
  },

  async fetchResult() {
    throw new Error("transcription_fallback_has_no_async_result");
  },
};

// ---------------------------------------------------------------------------
// OpenAI — gpt-4o-transcribe-diarize
// ---------------------------------------------------------------------------

/**
 * Teto de duração por requisição do modelo (1400 s ≈ 23 min).
 *
 * É este, e não os 25 MB, o limite que manda: a 32 kbps o arquivo só chega em
 * 25 MB por volta de 1h40, muito depois de a duração já ter estourado.
 */
export const OPENAI_DIARIZE_MAX_SECONDS = 1400;

type OpenAiDiarizedSegment = {
  speaker?: string | null;
  start?: number | null;
  end?: number | null;
  text?: string | null;
};

/**
 * Transcrição com diarização pela OpenAI.
 *
 * Síncrono: não há webhook. Roda dentro do worker, o que só é aceitável porque
 * o próprio modelo recusa áudio acima de ~23 min — nenhuma chamada fica pendurada
 * por muito tempo. Reunião mais longa que isso cai para o provedor assíncrono,
 * que aceita horas num pedido só.
 */
export const openAiDiarizeProvider: TranscriptionProvider = {
  name: "openai_diarize",
  supportsDiarization: true,

  async submit(params) {
    const apiKey = await resolveOpenAiApiKey();
    if (!apiKey) throw new Error("transcription_provider_unconfigured");

    const buffer = await getMediaBufferFromR2(params.storageKey);
    if (buffer.byteLength > 25 * 1024 * 1024) {
      throw new Error("transcription_openai_file_too_large");
    }

    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(buffer)], { type: params.mimeType }),
      `audio.${params.storageKey.split(".").pop() ?? "webm"}`,
    );
    form.append("model", "gpt-4o-transcribe-diarize");
    form.append("response_format", "diarized_json");
    // Obrigatório neste modelo para áudio acima de 30 s: sem isso a API recusa
    // o pedido com "chunking_strategy is required".
    form.append("chunking_strategy", "auto");
    if (params.languageCode) form.append("language", params.languageCode);

    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      integrationLog("openai", "warn", "diarize fetch failed", {
        detail: error instanceof Error ? error.message.slice(0, 120) : undefined,
      });
      throw new Error("transcription_openai_network");
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      integrationLog("openai", "error", "diarize request failed", {
        status: response.status,
        detail: detail.slice(0, 200),
      });
      // Áudio longo demais tem código próprio para o pipeline poder trocar de
      // provedor em vez de repetir a mesma chamada que nunca vai passar.
      if (detail.includes("1400") || detail.toLowerCase().includes("duration")) {
        throw new Error("transcription_openai_audio_too_long");
      }
      throw new Error(`transcription_openai_http_${response.status}`);
    }

    const json = (await response.json().catch(() => null)) as {
      text?: string;
      duration?: number;
      segments?: OpenAiDiarizedSegment[];
    } | null;
    if (!json) throw new Error("transcription_openai_invalid_response");

    const raw = Array.isArray(json.segments) ? json.segments : [];
    const segments = raw.length
      ? // `start`/`end` vêm em SEGUNDOS nesta API; o resto do módulo trabalha
        // em milissegundos.
        normalizeTranscriptSegments(
          raw.map((segment) => ({
            speaker: segment.speaker ?? null,
            start: Math.round(Number(segment.start ?? 0) * 1000),
            end: Math.round(Number(segment.end ?? 0) * 1000),
            text: segment.text ?? "",
          })),
        )
      : normalizeTranscriptSegments(json.text ? [{ start: 0, end: 0, text: json.text }] : []);

    if (segments.length === 0) throw new Error("transcription_empty");

    return {
      mode: "sync",
      transcript: {
        provider: "openai_diarize",
        languageCode: params.languageCode,
        durationMs: typeof json.duration === "number" ? Math.round(json.duration * 1000) : null,
        segments,
        speakerLabels: collectSpeakerLabels(segments),
        // Capítulos vêm da análise da IA, não do provedor de transcrição.
        chapters: [],
        hasDiarization: raw.length > 0,
      },
    };
  },

  async fetchResult() {
    throw new Error("transcription_openai_has_no_async_result");
  },
};

export function resolveTranscriptionProvider(name?: string | null): TranscriptionProvider {
  const requested = (name ?? process.env.TRANSCRIPTION_PROVIDER ?? "assemblyai").trim().toLowerCase();
  if (requested === "openai" || requested === "openai_diarize") return openAiDiarizeProvider;
  if (requested === "openai_whisper" || requested === "whisper") return whisperFallbackProvider;
  return assemblyAiProvider;
}

/**
 * Provedor adequado à duração.
 *
 * A OpenAI recusa acima de ~23 min, e fatiar traria o problema de costurar
 * falantes entre pedaços — "Falante A" do pedaço 1 não é o mesmo do pedaço 2.
 * Reunião longa vai direto para o provedor assíncrono, que engole horas num
 * pedido só.
 */
export function resolveProviderForDuration(durationMs: number | null): TranscriptionProvider {
  const configured = resolveTranscriptionProvider();
  if (configured.name !== "openai_diarize") return configured;

  const tooLong = durationMs !== null && durationMs > OPENAI_DIARIZE_MAX_SECONDS * 1000;
  if (!tooLong) return configured;

  // Sem chave do provedor assíncrono, é melhor tentar e falhar com um código
  // claro do que fingir que a reunião não pode ser processada.
  return process.env.ASSEMBLYAI_API_KEY?.trim() ? assemblyAiProvider : configured;
}

export function transcriptionWebhookSecret(): string {
  const secret = process.env.TRANSCRIPTION_WEBHOOK_SECRET?.trim();
  if (!secret || secret.length < 16) throw new Error("transcription_webhook_secret_missing");
  return secret;
}
