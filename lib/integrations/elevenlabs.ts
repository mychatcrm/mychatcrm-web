/**
 * Cliente ElevenLabs — Text-to-Speech e listagem de vozes.
 * @see https://elevenlabs.io/docs/api-reference
 */

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
const DEFAULT_TIMEOUT_MS = 60_000;

function elevenlabsApiKey(): string {
  return process.env.ELEVENLABS_API_KEY?.trim() ?? "";
}

export function isElevenlabsConfigured(): boolean {
  return Boolean(elevenlabsApiKey());
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ElevenlabsVoice = {
  voice_id: string;
  name: string;
  preview_url: string | null;
  category: string;
};

export type ElevenlabsLanguageCode = "pt" | "en" | "es" | "fr" | "de" | "it";

// ---------------------------------------------------------------------------
// List voices
// ---------------------------------------------------------------------------

/**
 * Busca todas as vozes disponíveis na conta ElevenLabs.
 * Retorna lista simplificada com voice_id, name, preview_url e category.
 * Lança excepção em caso de falha.
 */
export async function listElevenLabsVoices(): Promise<ElevenlabsVoice[]> {
  const apiKey = elevenlabsApiKey();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY não configurada.");

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${ELEVENLABS_BASE}/voices`, {
      method: "GET",
      headers: {
        "xi-api-key": apiKey,
        Accept: "application/json",
      },
      signal: ac.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`ElevenLabs voices ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as { voices?: unknown[] };
    const raw = Array.isArray(data.voices) ? data.voices : [];

    return raw
      .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
      .map((v) => ({
        voice_id: String(v.voice_id ?? ""),
        name: String(v.name ?? ""),
        preview_url: typeof v.preview_url === "string" ? v.preview_url : null,
        category: String(v.category ?? ""),
      }))
      .filter((v) => v.voice_id);
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// Text-to-Speech
// ---------------------------------------------------------------------------

/**
 * Converte texto para áudio MP3 via ElevenLabs.
 * Usa o modelo eleven_multilingual_v2 (suporta Português BR).
 * Retorna Buffer com o áudio MP3 pronto para upload/envio.
 * Lança excepção em caso de falha.
 */
export async function textToSpeechElevenLabs(
  text: string,
  voiceId: string,
  options?: { languageCode?: ElevenlabsLanguageCode },
): Promise<Buffer> {
  const apiKey = elevenlabsApiKey();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY não configurada.");
  if (!voiceId) throw new Error("voiceId em falta para TTS.");

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const enc = encodeURIComponent(voiceId);
    const res = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${enc}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: text.slice(0, 5000),
        model_id: "eleven_multilingual_v2",
        ...(options?.languageCode ? { language_code: options.languageCode } : {}),
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
      signal: ac.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`ElevenLabs TTS ${res.status}: ${body.slice(0, 300)}`);
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } finally {
    clearTimeout(t);
  }
}
