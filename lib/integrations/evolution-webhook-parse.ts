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

export type EvolutionVideoContent = {
  type: "video";
  url: string;
  mimetype: string;
  mediaKey: string;
  caption: string;
  seconds?: number | null;
  rawNode: Record<string, unknown>;
};

export type EvolutionDocumentContent = {
  type: "document";
  url: string;
  mimetype: string;
  mediaKey: string;
  fileName: string;
  caption: string;
  rawNode: Record<string, unknown>;
};

type EvolutionInboundBase = {
  remoteJid: string;
  fromMe: boolean;
  messageId: string;
};

export type EvolutionInboundMessage = EvolutionInboundBase &
  (
    | EvolutionTextContent
    | EvolutionAudioContent
    | EvolutionImageContent
    | EvolutionVideoContent
    | EvolutionDocumentContent
  );

// ---------------------------------------------------------------------------
// Legacy alias (backward-compat — existing callers that import EvolutionInboundText)
// ---------------------------------------------------------------------------

/** @deprecated Use EvolutionInboundMessage with type === "text" */
export type EvolutionInboundText = EvolutionInboundBase & EvolutionTextContent;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normaliza o JID de números brasileiros inserindo o nono dígito móvel quando ausente.
 *
 * O WhatsApp (via Evolution API) pode entregar números brasileiros em dois formatos:
 *   - 12 dígitos: 55 + DDD(2) + local(8) — formato antigo sem nono dígito
 *   - 13 dígitos: 55 + DDD(2) + 9 + local(8) — formato correto atual
 *
 * Sem normalização, o mesmo contato gera dois remote_jid distintos em
 * whatsapp_messages, resultando em conversas duplicadas em /conversas.
 *
 * Regra aplicada: se o número tem 12 dígitos totais, começa com "55" (Brasil),
 * e o número local (8 dígitos após o DDD) começa com 6, 7, 8 ou 9 → insere "9".
 *
 * Exemplos:
 *   "556293580574@s.whatsapp.net"  → "5562993580574@s.whatsapp.net"  (corrigido)
 *   "5562993580574@s.whatsapp.net" → "5562993580574@s.whatsapp.net"  (inalterado)
 *   "5511987654321@s.whatsapp.net" → "5511987654321@s.whatsapp.net"  (já 13 dígitos)
 */
function normalizeBrazilianJid(jid: string): string {
  const atIdx = jid.indexOf("@");
  if (atIdx === -1) return jid;
  const suffix = jid.slice(atIdx + 1);
  const digits = jid.slice(0, atIdx).replace(/\D/g, "");

  // Número brasileiro com 12 dígitos: 55 + DDD(2) + local(8)
  if (digits.startsWith("55") && digits.length === 12) {
    const ddd = digits.slice(2, 4);
    const local = digits.slice(4); // 8 dígitos
    // Linha móvel: começa com 6, 7, 8 ou 9
    if (/^[6-9]/.test(local)) {
      return `55${ddd}9${local}@${suffix}`;
    }
  }

  return jid;
}

function extractContentFromMessageNode(
  message: unknown,
):
  | EvolutionTextContent
  | EvolutionAudioContent
  | EvolutionImageContent
  | EvolutionVideoContent
  | EvolutionDocumentContent
  | null {
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

  const video = m.videoMessage;
  if (video && typeof video === "object") {
    const v = video as Record<string, unknown>;
    const url = typeof v.url === "string" ? v.url : "";
    const mimetype = typeof v.mimetype === "string" ? v.mimetype : "video/mp4";
    const mediaKey = typeof v.mediaKey === "string" ? v.mediaKey : "";
    const caption = typeof v.caption === "string" ? v.caption : "";
    const seconds = typeof v.seconds === "number" ? v.seconds : null;
    if (url) return { type: "video", url, mimetype, mediaKey, caption, seconds, rawNode: { ...v } };
  }

  const document = m.documentMessage;
  if (document && typeof document === "object") {
    const d = document as Record<string, unknown>;
    const url = typeof d.url === "string" ? d.url : "";
    const mimetype = typeof d.mimetype === "string" ? d.mimetype : "application/octet-stream";
    const mediaKey = typeof d.mediaKey === "string" ? d.mediaKey : "";
    const fileName = typeof d.fileName === "string" ? d.fileName : "documento";
    const caption = typeof d.caption === "string" ? d.caption : "";
    if (url) {
      return { type: "document", url, mimetype, mediaKey, fileName, caption, rawNode: { ...d } };
    }
  }

  return null;
}

function pushMessageFromNode(node: unknown, out: EvolutionInboundMessage[]) {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  const key = n.key;
  if (!key || typeof key !== "object") return;
  const k = key as Record<string, unknown>;

  const rawJid =
    typeof k.remoteJid === "string"
      ? k.remoteJid
      : typeof k.remoteJidAlt === "string"
        ? k.remoteJidAlt
        : null;
  if (!rawJid || rawJid.endsWith("@g.us")) return;
  const remoteJid = normalizeBrazilianJid(rawJid);

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

export type EvolutionMessageDeliveryUpdate = {
  messageId: string;
  fromMe: boolean;
  status: unknown;
};

/** Extrai atualizações de entrega de payloads MESSAGES_UPDATE / messages.update. */
export function extractMessageDeliveryUpdates(payload: Record<string, unknown>): EvolutionMessageDeliveryUpdate[] {
  const raw = payload.data;
  const items = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  const updates: EvolutionMessageDeliveryUpdate[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const key = row.key;
    const update = row.update;
    if (!key || typeof key !== "object") continue;

    const keyObj = key as Record<string, unknown>;
    const messageId = typeof keyObj.id === "string" ? keyObj.id.trim() : "";
    if (!messageId) continue;

    const fromMe = keyObj.fromMe === true;
    const status =
      update && typeof update === "object" ? (update as Record<string, unknown>).status : row.status;

    updates.push({ messageId, fromMe, status });
  }

  return updates;
}
