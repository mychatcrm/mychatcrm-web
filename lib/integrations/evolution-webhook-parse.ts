import { resolveCanonicalInboundContact } from "@/lib/integrations/whatsapp-contact-identity";

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
  /** Telefone canônico confiável derivado apenas do JID enviado pelo provedor. */
  contactPhone: string | null;
  /** Identificadores originais, preservados para auditoria e troubleshooting. */
  providerRemoteJid: string;
  providerRemoteJidAlt: string | null;
  fromMe: boolean;
  messageId: string;
  /** Instante original informado pelo WhatsApp/Evolution, não o momento em que
   *  o webhook terminou de processar. Preserva a ordem real do burst. */
  occurredAt: string | null;
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

function parseEvolutionMessageTimestamp(value: unknown): string | null {
  let numeric: number | null = null;
  if (typeof value === "number" && Number.isFinite(value)) numeric = value;
  else if (typeof value === "string" && /^\d+$/.test(value.trim())) numeric = Number(value);
  else if (value && typeof value === "object") {
    const low = (value as { low?: unknown }).low;
    if (typeof low === "number" && Number.isFinite(low)) numeric = low >>> 0;
  }
  if (numeric == null || !Number.isFinite(numeric) || numeric <= 0) return null;
  const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  if (year < 2000 || year > 2100) return null;
  return date.toISOString();
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

  const rawJid = typeof k.remoteJid === "string" ? k.remoteJid : null;
  const rawJidAlt = typeof k.remoteJidAlt === "string" ? k.remoteJidAlt : null;
  if (!rawJid) return;
  const contact = resolveCanonicalInboundContact({ remoteJid: rawJid, remoteJidAlt: rawJidAlt });
  if (!contact) return;

  const fromMe = Boolean(k.fromMe);
  const messageId = typeof k.id === "string" ? k.id : "";
  const occurredAt = parseEvolutionMessageTimestamp(n.messageTimestamp);

  const content = extractContentFromMessageNode(n.message);
  if (!content) return;

  out.push({
    remoteJid: contact.canonicalRemoteJid,
    contactPhone: contact.canonicalPhone,
    providerRemoteJid: contact.providerRemoteJid,
    providerRemoteJidAlt: contact.providerRemoteJidAlt,
    fromMe,
    messageId,
    occurredAt,
    ...content,
  } as EvolutionInboundMessage);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function extractAllMessagesFromEvolutionPayload(
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
    return out;
  }

  if (typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.messages)) {
      for (const m of d.messages) pushMessageFromNode(m, out);
    } else if ("key" in d) {
      pushMessageFromNode(d, out);
    }
  }

  return out;
}

/**
 * Extrai mensagens recebidas (texto, áudio ou imagem) a partir do payload Evolution v2.
 * Filtra mensagens enviadas por nós (fromMe) e grupos (@g.us).
 */
export function extractInboundMessagesFromEvolutionPayload(
  payload: Record<string, unknown>,
): EvolutionInboundMessage[] {
  return extractAllMessagesFromEvolutionPayload(payload).filter((m) => !m.fromMe);
}

/**
 * Extrai mensagens enviadas por nós (fromMe) — inclui tanto o echo de envios
 * feitos pelo painel/agente quanto mensagens digitadas direto no aparelho
 * conectado, que de outra forma nunca chegariam ao CRM. Filtra grupos (@g.us).
 */
export function extractFromMeMessagesFromEvolutionPayload(
  payload: Record<string, unknown>,
): EvolutionInboundMessage[] {
  return extractAllMessagesFromEvolutionPayload(payload).filter((m) => m.fromMe);
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

export function extractConnectionStatusReason(payload: Record<string, unknown>): number | null {
  const data = payload.data;
  if (!data || typeof data !== "object") return null;
  const raw = (data as Record<string, unknown>).statusReason;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) return Number(raw.trim());
  return null;
}

/** Baileys/Evolution reasons that require a fresh QR instead of auto-reconnect. */
export function isTerminalEvolutionDisconnectReason(reason: number | null): boolean {
  return reason === 401 || reason === 402 || reason === 403 || reason === 406;
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

function readDeliveryKey(row: Record<string, unknown>): Record<string, unknown> | null {
  const key = row.key;
  if (key && typeof key === "object") return key as Record<string, unknown>;

  const message = row.message;
  if (message && typeof message === "object") {
    const messageKey = (message as Record<string, unknown>).key;
    if (messageKey && typeof messageKey === "object") return messageKey as Record<string, unknown>;
  }

  return null;
}

function readDeliveryStatus(row: Record<string, unknown>): unknown {
  const update = row.update;
  if (update && typeof update === "object") {
    const updateObj = update as Record<string, unknown>;
    if (updateObj.status !== undefined) return updateObj.status;
    if (updateObj.ack !== undefined) return updateObj.ack;
    if (updateObj.statusAck !== undefined) return updateObj.statusAck;
  }

  if (row.status !== undefined) return row.status;
  if (row.statusAck !== undefined) return row.statusAck;
  if (row.ack !== undefined) return row.ack;

  const message = row.message;
  if (message && typeof message === "object") {
    const messageObj = message as Record<string, unknown>;
    if (messageObj.status !== undefined) return messageObj.status;
  }

  return null;
}

function readDeliveryMessageId(row: Record<string, unknown>, keyObj: Record<string, unknown>): string {
  const fromKey = typeof keyObj.id === "string" ? keyObj.id.trim() : "";
  if (fromKey) return fromKey;

  for (const candidate of [row.messageId, row.keyId, row.id]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }

  return "";
}

function readDeliveryFromMe(keyObj: Record<string, unknown>, row: Record<string, unknown>): boolean {
  if (keyObj.fromMe === true) return true;
  if (row.fromMe === true) return true;

  const update = row.update;
  if (update && typeof update === "object" && (update as Record<string, unknown>).fromMe === true) {
    return true;
  }

  return false;
}

/** Extrai atualizações de entrega de payloads MESSAGES_UPDATE / messages.update. */
export function extractMessageDeliveryUpdates(payload: Record<string, unknown>): EvolutionMessageDeliveryUpdate[] {
  const raw = payload.data;
  let items: unknown[] = [];

  if (Array.isArray(raw)) {
    items = raw;
  } else if (raw && typeof raw === "object") {
    const dataObj = raw as Record<string, unknown>;
    if (Array.isArray(dataObj.messages)) items = dataObj.messages;
    else items = [raw];
  } else if (payload.key && typeof payload.key === "object") {
    items = [payload];
  }

  const updates: EvolutionMessageDeliveryUpdate[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const keyObj = readDeliveryKey(row);

    if (!keyObj) {
      const messageId = readDeliveryMessageId(row, {});
      if (!messageId) continue;
      updates.push({
        messageId,
        fromMe: readDeliveryFromMe({}, row),
        status: readDeliveryStatus(row),
      });
      continue;
    }

    const messageId = readDeliveryMessageId(row, keyObj);
    if (!messageId) continue;

    updates.push({
      messageId,
      fromMe: readDeliveryFromMe(keyObj, row),
      status: readDeliveryStatus(row),
    });
  }

  return updates;
}
