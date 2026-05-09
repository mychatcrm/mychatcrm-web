/**
 * media-processor.ts
 * Baixa mídia do WhatsApp e converte para texto via OpenAI.
 *  - Áudio → Whisper (whisper-1) → transcrição em texto
 *  - Imagem → GPT-4o vision → descrição em texto
 *
 * Fluxo de download:
 *  0. rawNode.base64 — quando Evolution API tem webhookBase64: true, os bytes
 *     já chegam decodificados no payload (mais rápido, sem rede adicional).
 *  1. Evolution API /chat/getBase64FromMediaMessage — Baileys descriptografa
 *     a mídia com a mediaKey e devolve base64 válido.
 *
 * IMPORTANTE: CDN da Meta serve dados ENCRIPTADOS (sem a mediaKey são inúteis).
 * Nunca fazemos fetch directo do CDN URL — apenas rawNode.base64 ou Evolution API
 * produzem bytes válidos para Whisper/Vision.
 *
 * Buffer obtido é salvo no Cloudflare R2 para archiving.
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
// Strategy 1: Evolution API /chat/getBase64FromMediaMessage
// Baileys descriptografa a mídia com a mediaKey — única forma segura de obter
// bytes válidos quando rawNode.base64 não está disponível.
// NOTA: CDN da Meta serve dados ENCRIPTADOS → fetch directo é inútil.
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
// Core: download com cascata rawNode.base64 → Evolution API + archiving R2
// NOTA: CDN da Meta serve dados ENCRIPTADOS — nunca usamos fetch directo CDN
//       pois o buffer resultante é inútil sem a mediaKey. Apenas rawNode.base64
//       (Evolution com webhookBase64: true) ou Evolution API (Baileys decripta)
//       produzem bytes válidos.
// ---------------------------------------------------------------------------

async function downloadMediaBuffer(
  content: EvolutionAudioContent | EvolutionImageContent,
  instanceName: string,
  msgKey: MsgKey = {},
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  let buffer: Buffer | null = null;
  let mimeType = content.mimetype;

  // 0. Prioridade máxima: base64 que vem directamente no rawNode do webhook
  //    (quando Evolution API está configurada com webhookBase64: true)
  const rawBase64 = typeof content.rawNode.base64 === "string" && content.rawNode.base64.length > 0
    ? content.rawNode.base64
    : null;

  if (rawBase64) {
    let b64 = rawBase64;
    // Suporta formato data URL: "data:audio/ogg;base64,..."
    if (b64.startsWith("data:")) {
      const commaIdx = b64.indexOf(",");
      if (commaIdx !== -1) {
        const header = b64.slice(5, commaIdx);
        const mime = header.split(";")[0];
        if (mime) mimeType = mime;
        b64 = b64.slice(commaIdx + 1);
      }
    }
    try {
      buffer = Buffer.from(b64, "base64");
      console.log("[media-processor] base64 do rawNode ok", buffer.byteLength, "bytes");
    } catch (e) {
      console.warn("[media-processor] base64 decode error", e);
      buffer = null;
    }
  }

  // 1. Fallback: Evolution API — Baileys descriptografa a mídia com a mediaKey
  //    (CDN da Meta serve dados encriptados, por isso saltamos fetch directo CDN)
  if (!buffer) {
    console.log("[media-processor] rawNode.base64 ausente — tentando Evolution API para decriptar");
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
