/** Normaliza `messages.upsert` / `MESSAGES_UPSERT` → `MESSAGES_UPSERT`. */
export function normalizeEvolutionEventName(event: unknown): string {
  if (typeof event !== "string") return "";
  return event.replace(/\./g, "_").toUpperCase();
}

// ---------------------------------------------------------------------------
// Content types
// ---------------------------------------------------------------------------

export type EvolutionTextContent = {
  type: "text";
  text: string;
};

export type EvolutionAudioContent = {
  type: "audio";
  url: string;
  mimetype: string;
  mediaKey: string;
  /** Objeto audioMessage completo do webhook — contém todos os campos necessários
   *  para Baileys descriptografar a mídia (fileEncSha256, fileSha256, fileLength,
   *  directPath, mediaKeyTimestamp, etc.). Passado intacto ao endpoint de download. */
  rawNode: Record<string, unknown>;
};

export type EvolutionImageContent = {
  type: "image";
  url: string;
  mimetype: string;
  mediaKey: string;
  caption: string;
  /** Objeto imageMessage completo do webhook — idem EvolutionAudioContent.rawNode. */
  rawNode: Record<string, unknown>;
};

type EvolutionInboundBase = {
  remoteJid: string;
  fromMe: boolean;
  messageId: string;
};

export type EvolutionInboundMessage = EvolutionInboundBase &
  (EvolutionTextContent | EvolutionAudioContent | EvolutionImageContent);

// ---------------------------------------------------------------------------
// Legacy alias (backward-compat — existing callers that import EvolutionInboundText)
// ---------------------------------------------------------------------------

/** @deprecated Use EvolutionInboundMessage with type === "text" */
export type EvolutionInboundText = EvolutionInboundBase & EvolutionTextContent;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractContentFromMessageNode(
  message: unknown,
): EvolutionTextContent | EvolutionAudioContent | EvolutionImageContent | null {
  if (!message || typeof message !== "object") return null;
  const m = message as Record<string, unknown>;

  // Text — conversation
  if (typeof m.conversation === "string" && m.conversation.trim()) {
    return { type: "text", text: m.conversation.trim() };
  }

  // Text — extendedTextMessage
  const ext = m.extendedTextMessage;
  if (ext && typeof ext === "object") {
    const t = (ext as Record<string, unknown>).text;
    if (typeof t === "string" && t.trim()) return { type: "text", text: t.trim() };
  }

  // Audio — audioMessage
  const audio = m.audioMessage;
  if (audio && typeof audio === "object") {
    const a = audio as Record<string, unknown>;
    const url = typeof a.url === "string" ? a.url : "";
    const mimetype = typeof a.mimetype === "string" ? a.mimetype : "audio/ogg";
    const mediaKey = typeof a.mediaKey === "string" ? a.mediaKey : "";
    // Spread completo: preserva fileEncSha256, fileSha256, fileLength, directPath,
    // mediaKeyTimestamp e todos os outros campos que Baileys precisa para descriptografar.
    if (url) return { type: "audio", url, mimetype, mediaKey, rawNode: { ...a } };
  }

  // Image — imageMessage
  const image = m.imageMessage;
  if (image && typeof image === "object") {
    const i = image as Record<string, unknown>;
    const url = typeof i.url === "string" ? i.url : "";
    const mimetype = typeof i.mimetype === "string" ? i.mimetype : "image/jpeg";
    const mediaKey = typeof i.mediaKey === "string" ? i.mediaKey : "";
    const caption = typeof i.caption === "string" ? i.caption : "";
    if (url) return { type: "image", url, mimetype, mediaKey, caption, rawNode: { ...i } };
  }

  return null;
}

function pushMessageFromNode(node: unknown, out: EvolutionInboundMessage[]) {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  const key = n.key;
  if (!key || typeof key !== "object") return;
  const k = key as Record<string, unknown>;

  const remoteJid =
    typeof k.remoteJid === "string"
      ? k.remoteJid
      : typeof k.remoteJidAlt === "string"
        ? k.remoteJidAlt
        : null;
  if (!remoteJid || remoteJid.endsWith("@g.us")) return;

  const fromMe = Boolean(k.fromMe);
  const messageId = typeof k.id === "string" ? k.id : "";

  const content = extractContentFromMessageNode(n.message);
  if (!content) return;

  out.push({ remoteJid, fromMe, messageId, ...content } as EvolutionInboundMessage);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extrai mensagens recebidas (texto, áudio ou imagem) a partir do payload Evolution v2.
 * Filtra mensagens enviadas por nós (fromMe) e grupos (@g.us).
 */
export function extractInboundMessagesFromEvolutionPayload(
  payload: Record<string, unknown>,
): EvolutionInboundMessage[] {
  const out: EvolutionInboundMessage[] = [];
  const data = payload.data;
  if (!data) return out;

  if (Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item === "object" && "messages" in (item as object)) {
        const msgs = (item as Record<string, unknown>).messages;
        if (Array.isArray(msgs)) for (const m of msgs) pushMessageFromNode(m, out);
      } else {
        pushMessageFromNode(item, out);
      }
    }
    return out.filter((m) => !m.fromMe);
  }

  if (typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.messages)) {
      for (const m of d.messages) pushMessageFromNode(m, out);
    } else if ("key" in d) {
      pushMessageFromNode(d, out);
    }
  }

  return out.filter((m) => !m.fromMe);
}

/**
 * @deprecated Use extractInboundMessagesFromEvolutionPayload instead.
 * Kept for backward compatibility with existing callers.
 */
export function extractInboundTextsFromEvolutionPayload(
  payload: Record<string, unknown>,
): EvolutionInboundText[] {
  return extractInboundMessagesFromEvolutionPayload(payload).filter(
    (m): m is EvolutionInboundText => m.type === "text",
  );
}

export function extractConnectionState(payload: Record<string, unknown>): string | null {
  const data = payload.data;
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.state === "string") return d.state;
  const conn = d.connection;
  if (typeof conn === "string") return conn;
  return null;
}

export function extractInstanceName(payload: Record<string, unknown>): string | null {
  const inst = payload.instance;
  if (typeof inst === "string" && inst.trim()) return inst.trim();
  if (
    inst &&
    typeof inst === "object" &&
    typeof (inst as { instanceName?: string }).instanceName === "string"
  ) {
    return (inst as { instanceName: string }).instanceName.trim();
  }
  return null;
}

export function extractInstanceJid(payload: Record<string, unknown>): string | null {
  const candidateKeys = new Set([
    "jid",
    "owner",
    "ownerJid",
    "user",
    "waJid",
    "wuid",
  ]);

  function normalizeCandidate(value: string): string | null {
    const clean = value.trim();
    if (!clean) return null;
    if (clean.includes("@s.whatsapp.net")) return clean;
    const digits = clean.replace(/\D/g, "");
    return digits.length >= 8 ? `${digits}@s.whatsapp.net` : null;
  }

  function visit(value: unknown, depth: number, keyHint?: string): string | null {
    if (!value || depth > 6) return null;

    if (typeof value === "string") {
      if (!keyHint || !candidateKeys.has(keyHint)) return null;
      return normalizeCandidate(value);
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, depth + 1);
        if (found) return found;
      }
      return null;
    }

    if (typeof value !== "object") return null;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const found = visit(child, depth + 1, key);
      if (found) return found;
    }
    return null;
  }

  return visit(payload.data, 0) ?? visit(payload.instance, 0) ?? null;
}
