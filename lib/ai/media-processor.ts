/**
 * media-processor.ts
 * Baixa mídia do WhatsApp e converte para texto via OpenAI.
 *  - Áudio → Whisper (whisper-1) → transcrição em texto
 *  - Imagem → GPT-4o vision → descrição em texto
 *
 * Fluxo de download (com fallback em cascata):
 *  1. Fetch directo na URL CDN da Meta que chega no webhook (content.url)
 *  2. Fallback: endpoint Evolution API /chat/getBase64FromMediaMessage (rawNode completo)
 *  Buffer obtido é salvo no Cloudflare R2 para archiving, depois enviado à IA.
 */
import type { EvolutionAudioContent, EvolutionImageContent } from "@/lib/integrations/evolution-webhook-parse";
import { uploadMediaToR2 } from "@/lib/integrations/r2-storage";
import { resolveOpenAiApiKey } from "@/lib/ai/openai-api-key";

const EVOLUTION_BASE = process.env.EVOLUTION_API_BASE_URL?.replace(/\/$/, "") ?? "";
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY ?? "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Campos do `key` da mensagem WhatsApp — necessários para o payload correcto da Evolution API v2. */
type MsgKey = { remoteJid?: string; fromMe?: boolean; messageId?: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mimeToExt(mimetype: string): string {
  // "audio/ogg; codecs=opus" → "ogg"
  const base = mimetype.split(";")[0]?.trim() ?? mimetype;
  return base.split("/")[1]?.trim() ?? "bin";
}

// ---------------------------------------------------------------------------
// Strategy 1: fetch directo na URL CDN da Meta
// ---------------------------------------------------------------------------

async function fetchFromCDN(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      console.warn("[media-processor] CDN non-ok", res.status, url.slice(0, 80));
      return null;
    }
    const arr = await res.arrayBuffer();
    const buf = Buffer.from(arr);
    console.log("[media-processor] CDN ok", buf.byteLength, "bytes");
    return buf;
  } catch (e) {
    console.warn("[media-processor] CDN fetch error", e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Strategy 2: Evolution API /chat/getBase64FromMediaMessage (fallback)
// ---------------------------------------------------------------------------

async function fetchFromEvolution(
  content: EvolutionAudioContent | EvolutionImageContent,
  instanceName: string,
  msgKey: MsgKey,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!EVOLUTION_BASE || !EVOLUTION_KEY) return null;

  const endpoint = `${EVOLUTION_BASE}/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`;
  const messageField = content.type === "audio" ? "audioMessage" : "imageMessage";

  const body = {
    message: {
      key: {
        remoteJid: msgKey.remoteJid ?? "",
        fromMe: msgKey.fromMe ?? false,
        id: msgKey.messageId ?? "",
      },
      message: { [messageField]: content.rawNode },
    },
  };

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVOLUTION_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    console.warn("[media-processor] evolution fetch error", e);
    return null;
  }

  if (!res.ok) {
    console.warn("[media-processor] evolution non-ok", res.status);
    return null;
  }

  let json: unknown;
  try { json = await res.json(); } catch { return null; }
  if (!json || typeof json !== "object") return null;

  const j = json as Record<string, unknown>;
  let raw = typeof j.base64 === "string" ? j.base64 : null;
  if (!raw) return null;

  let mimeType = content.mimetype;
  if (raw.startsWith("data:")) {
    const commaIdx = raw.indexOf(",");
    if (commaIdx !== -1) {
      const header = raw.slice(5, commaIdx);
      const mime = header.split(";")[0];
      if (mime) mimeType = mime;
      raw = raw.slice(commaIdx + 1);
    }
  }

  const buffer = Buffer.from(raw, "base64");
  console.log("[media-processor] evolution ok", buffer.byteLength, "bytes");
  return { buffer, mimeType };
}

// ---------------------------------------------------------------------------
// Core: download com cascata CDN → Evolution + archiving R2
// ---------------------------------------------------------------------------

async function downloadMediaBuffer(
  content: EvolutionAudioContent | EvolutionImageContent,
  instanceName: string,
  msgKey: MsgKey = {},
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  let buffer: Buffer | null = null;
  let mimeType = content.mimetype;

  // 1. Tentativa directa na URL CDN da Meta
  buffer = await fetchFromCDN(content.url);

  // 2. Fallback: Evolution API (rawNode completo para Baileys descriptografar)
  if (!buffer) {
    const evo = await fetchFromEvolution(content, instanceName, msgKey);
    if (evo) {
      buffer = evo.buffer;
      mimeType = evo.mimeType;
    }
  }

  if (!buffer) return null;

  // 3. Archiving no R2 (non-blocking — falha não interrompe o processamento)
  const ext = mimeToExt(mimeType);
  const filename = `whatsapp/${instanceName}/${msgKey.messageId ?? Date.now()}.${ext}`;
  uploadMediaToR2(buffer, filename, mimeType).catch(() => {
    // silencioso — R2 é opcional
  });

  return { buffer, mimeType };
}

// ---------------------------------------------------------------------------
// Audio → text via Whisper
// ---------------------------------------------------------------------------

/**
 * Transcreve um áudio do WhatsApp usando OpenAI Whisper.
 * Retorna o texto transcrito, ou null em caso de falha.
 */
export async function transcribeAudio(
  content: EvolutionAudioContent,
  instanceName: string,
  msgKey: MsgKey = {},
): Promise<string | null> {
  const apiKey = await resolveOpenAiApiKey();
  if (!apiKey) return null;

  const media = await downloadMediaBuffer(content, instanceName, msgKey);
  if (!media) return null;

  const blob = new Blob([new Uint8Array(media.buffer)], { type: media.mimeType });
  const ext = mimeToExt(media.mimeType);

  const form = new FormData();
  form.append("file", blob, `audio.${ext}`);
  form.append("model", "whisper-1");
  form.append("language", "pt");

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
    const errBody = await res.text().catch(() => "");
    console.warn("[media-processor] whisper non-ok", res.status, errBody.slice(0, 200));
    return null;
  }

  let json: unknown;
  try { json = await res.json(); } catch { return null; }

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
  msgKey: MsgKey = {},
): Promise<string | null> {
  const apiKey = await resolveOpenAiApiKey();
  if (!apiKey) return null;

  const media = await downloadMediaBuffer(content, instanceName, msgKey);
  if (!media) return null;

  const dataUrl = `data:${media.mimeType};base64,${media.buffer.toString("base64")}`;

  const body = {
    model: "gpt-4o",
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Descreva o conteúdo desta imagem em português de forma concisa e objetiva." },
          { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
        ],
      },
    ],
  };

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    console.warn("[media-processor] vision fetch error", e);
    return null;
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.warn("[media-processor] vision non-ok", res.status, errBody.slice(0, 200));
    return null;
  }

  let json: unknown;
  try { json = await res.json(); } catch { return null; }

  try {
    const j = json as { choices: { message: { content: string } }[] };
    return j.choices[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}
