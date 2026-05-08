/**
 * media-processor.ts
 * Baixa mídia da Evolution API e converte para texto via OpenAI.
 *  - Áudio → Whisper (whisper-1) → transcrição em texto
 *  - Imagem → GPT-4o vision → descrição em texto
 */
import type { EvolutionAudioContent, EvolutionImageContent } from "@/lib/integrations/evolution-webhook-parse";
import { resolveOpenAiApiKey } from "@/lib/ai/openai-api-key";

const EVOLUTION_BASE = process.env.EVOLUTION_API_BASE_URL?.replace(/\/$/, "") ?? "";
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY ?? "";

// ---------------------------------------------------------------------------
// Download media from Evolution API
// ---------------------------------------------------------------------------

/**
 * Chama `POST /chat/getBase64FromMediaMessage/{instanceName}`.
 * Retorna a string base64 pura (sem prefixo `data:...;base64,`), ou null em caso de falha.
 */
async function downloadMediaBase64(
  content: EvolutionAudioContent | EvolutionImageContent,
  instanceName: string,
): Promise<{ base64: string; mimeType: string } | null> {
  if (!EVOLUTION_BASE || !EVOLUTION_KEY) return null;

  const url = `${EVOLUTION_BASE}/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`;

  // Build the message payload the Evolution API expects
  const messageField = content.type === "audio" ? "audioMessage" : "imageMessage";
  const body = {
    message: {
      [messageField]: {
        url: content.url,
        mediaKey: content.mediaKey,
        mimetype: content.mimetype,
      },
    },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: EVOLUTION_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    console.warn("[media-processor] download fetch error", e);
    return null;
  }

  if (!res.ok) {
    console.warn("[media-processor] download non-ok", res.status);
    return null;
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return null;
  }

  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;

  // Response can be { base64: "data:mime;base64,..." } or { base64: "rawBase64..." }
  let raw = typeof j.base64 === "string" ? j.base64 : null;
  if (!raw) return null;

  let mimeType = content.mimetype;
  if (raw.startsWith("data:")) {
    // Strip the data URL prefix: "data:audio/ogg;base64,XXXXX" → "XXXXX"
    const commaIdx = raw.indexOf(",");
    if (commaIdx !== -1) {
      const header = raw.slice(5, commaIdx); // "audio/ogg;base64"
      const mime = header.split(";")[0];
      if (mime) mimeType = mime;
      raw = raw.slice(commaIdx + 1);
    }
  }

  return { base64: raw, mimeType };
}

// ---------------------------------------------------------------------------
// Audio → text via Whisper
// ---------------------------------------------------------------------------

/**
 * Transcreve um áudio do WhatsApp usando OpenAI Whisper.
 * Retorna o texto transcrito, ou null em caso de falha (key ausente, download falhou, etc.).
 */
export async function transcribeAudio(
  content: EvolutionAudioContent,
  instanceName: string,
): Promise<string | null> {
  const apiKey = await resolveOpenAiApiKey();
  if (!apiKey) return null;

  const media = await downloadMediaBase64(content, instanceName);
  if (!media) return null;

  // Convert base64 → Buffer → Blob
  const buffer = Buffer.from(media.base64, "base64");
  const blob = new Blob([buffer], { type: media.mimeType });

  // Whisper requires multipart/form-data
  const form = new FormData();
  // Filename extension matters for Whisper — derive from mimetype
  const ext = media.mimeType.split("/")[1]?.replace("ogg", "ogg").replace("mpeg", "mp3") ?? "ogg";
  form.append("file", blob, `audio.${ext}`);
  form.append("model", "whisper-1");
  form.append("language", "pt"); // hint: Portuguese — improves accuracy

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    console.warn("[media-processor] whisper fetch error", e);
    return null;
  }

  if (!res.ok) {
    console.warn("[media-processor] whisper non-ok", res.status);
    return null;
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return null;
  }

  const text =
    json && typeof json === "object" && typeof (json as Record<string, unknown>).text === "string"
      ? ((json as Record<string, unknown>).text as string).trim()
      : null;

  return text || null;
}

// ---------------------------------------------------------------------------
// Image → text via GPT-4o vision
// ---------------------------------------------------------------------------

/**
 * Descreve uma imagem do WhatsApp usando GPT-4o (vision).
 * Retorna uma descrição em texto, ou null em caso de falha.
 */
export async function describeImage(
  content: EvolutionImageContent,
  instanceName: string,
): Promise<string | null> {
  const apiKey = await resolveOpenAiApiKey();
  if (!apiKey) return null;

  const media = await downloadMediaBase64(content, instanceName);
  if (!media) return null;

  const dataUrl = `data:${media.mimeType};base64,${media.base64}`;

  const body = {
    model: "gpt-4o",
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Descreva o conteúdo desta imagem em português de forma concisa e objetiva.",
          },
          {
            type: "image_url",
            image_url: { url: dataUrl, detail: "low" },
          },
        ],
      },
    ],
  };

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    console.warn("[media-processor] vision fetch error", e);
    return null;
  }

  if (!res.ok) {
    console.warn("[media-processor] vision non-ok", res.status);
    return null;
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return null;
  }

  try {
    const j = json as { choices: { message: { content: string } }[] };
    return j.choices[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}
