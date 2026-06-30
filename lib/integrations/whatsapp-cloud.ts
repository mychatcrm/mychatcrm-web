import { createHmac, timingSafeEqual } from "node:crypto";

export type WhatsAppInboundText = {
  fromWaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  text: string;
  messageId: string;
  contactName: string | null;
};

/** Extrai primeira mensagem de texto do payload Cloud API (formato típico webhook). */
export function parseWhatsAppCloudPayload(body: unknown): WhatsAppInboundText | null {
  const root = body as { entry?: Array<{ changes?: Array<{ value?: unknown }> }> };
  const entries = root.entry;
  if (!Array.isArray(entries)) return null;
  for (const ent of entries) {
    const changes = ent.changes;
    if (!Array.isArray(changes)) continue;
    for (const ch of changes) {
      const value = ch.value as Record<string, unknown> | undefined;
      if (!value || typeof value !== "object") continue;
      const metadata = value.metadata as { display_phone_number?: string; phone_number_id?: string } | undefined;
      const contacts = value.contacts as unknown[] | undefined;
      const messages = value.messages as unknown[] | undefined;
      if (!Array.isArray(messages) || !metadata?.phone_number_id) continue;
      const m = messages[0] as Record<string, unknown> | undefined;
      if (!m || m.type !== "text") continue;
      const textObj = m.text as { body?: string } | undefined;
      const from = m.from;
      const id = m.id;
      if (typeof from !== "string" || typeof textObj?.body !== "string") continue;
      return {
        fromWaId: from,
        phoneNumberId: String(metadata.phone_number_id),
        displayPhoneNumber: typeof metadata.display_phone_number === "string" ? metadata.display_phone_number : null,
        text: textObj.body,
        messageId: typeof id === "string" ? id : "",
        contactName: extractCloudContactName(contacts, from),
      };
    }
  }
  return null;
}

export type WhatsAppInboundKind = "text" | "audio" | "image" | "document" | "video";

export type WhatsAppInboundMessage = {
  fromWaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  messageId: string;
  contactName: string | null;
  kind: WhatsAppInboundKind;
  text: string;
  /** Para mídia: id do media na Graph API, mimeType e caption. */
  mediaId: string | null;
  mimeType: string | null;
  caption: string | null;
};

/**
 * Parse de inbound Cloud API com suporte a texto, áudio e imagem (e documento/vídeo).
 * Retorna a primeira mensagem do payload.
 */
export function parseWhatsAppCloudInbound(body: unknown): WhatsAppInboundMessage | null {
  const root = body as { entry?: Array<{ changes?: Array<{ value?: unknown }> }> };
  const entries = root.entry;
  if (!Array.isArray(entries)) return null;
  for (const ent of entries) {
    const changes = ent.changes;
    if (!Array.isArray(changes)) continue;
    for (const ch of changes) {
      const value = ch.value as Record<string, unknown> | undefined;
      if (!value || typeof value !== "object") continue;
      const metadata = value.metadata as { display_phone_number?: string; phone_number_id?: string } | undefined;
      const contacts = value.contacts as unknown[] | undefined;
      const messages = value.messages as unknown[] | undefined;
      if (!Array.isArray(messages) || !metadata?.phone_number_id) continue;
      const m = messages[0] as Record<string, unknown> | undefined;
      if (!m) continue;
      const from = m.from;
      const id = m.id;
      if (typeof from !== "string") continue;

      const phoneNumberId = String(metadata.phone_number_id);
      const displayPhoneNumber =
        typeof metadata.display_phone_number === "string" ? metadata.display_phone_number : null;
      const contactName = extractCloudContactName(contacts, from);
      const messageId = typeof id === "string" ? id : "";
      const type = typeof m.type === "string" ? m.type : "text";

      const base = { fromWaId: from, phoneNumberId, displayPhoneNumber, messageId, contactName };

      if (type === "text") {
        const textObj = m.text as { body?: string } | undefined;
        if (typeof textObj?.body !== "string") continue;
        return { ...base, kind: "text", text: textObj.body, mediaId: null, mimeType: null, caption: null };
      }

      if (type === "audio" || type === "image" || type === "document" || type === "video") {
        const mediaObj = m[type] as { id?: string; mime_type?: string; caption?: string } | undefined;
        const mediaId = typeof mediaObj?.id === "string" ? mediaObj.id : null;
        const mimeType = typeof mediaObj?.mime_type === "string" ? mediaObj.mime_type : null;
        const caption = typeof mediaObj?.caption === "string" ? mediaObj.caption : null;
        return {
          ...base,
          kind: type as WhatsAppInboundKind,
          text: caption ?? "",
          mediaId,
          mimeType,
          caption,
        };
      }
    }
  }
  return null;
}

/** Baixa a mídia da Cloud API: resolve a URL pelo media id e faz o download dos bytes. */
export async function fetchWhatsAppCloudMedia(
  mediaId: string,
  accessToken: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const metaRes = await fetch(`${GRAPH_API}/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!metaRes.ok) return null;
    const meta = (await metaRes.json().catch(() => ({}))) as { url?: string; mime_type?: string };
    if (!meta.url) return null;

    const binRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!binRes.ok) return null;
    const arrayBuf = await binRes.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuf),
      mimeType: meta.mime_type ?? "application/octet-stream",
    };
  } catch {
    return null;
  }
}

function extractCloudContactName(contacts: unknown[] | undefined, waId: string): string | null {
  if (!Array.isArray(contacts)) return null;
  for (const contact of contacts) {
    if (!contact || typeof contact !== "object") continue;
    const row = contact as Record<string, unknown>;
    if (typeof row.wa_id === "string" && row.wa_id !== waId) continue;
    const profile = row.profile && typeof row.profile === "object"
      ? (row.profile as Record<string, unknown>)
      : null;
    const name = profile?.name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return null;
}

export function verifyMetaSignature256(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected =
    "sha256=" + createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  try {
    const a = Buffer.from(signatureHeader, "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const GRAPH_API = "https://graph.facebook.com/v21.0";

export async function sendWhatsAppTextMessage(params: {
  toWaId: string;
  text: string;
  phoneNumberId: string;
  accessToken: string;
}): Promise<{ ok: boolean; status: number; messageId?: string; error?: string }> {
  const url = `${GRAPH_API}/${encodeURIComponent(params.phoneNumberId)}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: params.toWaId,
      type: "text",
      text: { preview_url: false, body: params.text.slice(0, 4096) },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: t.slice(0, 500) };
  }
  const data = await res.json().catch(() => ({})) as { messages?: Array<{ id?: string }> };
  return { ok: true, status: res.status, messageId: data.messages?.[0]?.id };
}

export type WhatsAppCloudStatus = {
  id: string;
  status: string;
  recipientId: string;
};

export function parseWhatsAppCloudStatuses(body: unknown): WhatsAppCloudStatus[] {
  const root = body as { entry?: Array<{ changes?: Array<{ value?: unknown }> }> };
  const entries = root.entry;
  if (!Array.isArray(entries)) return [];
  const result: WhatsAppCloudStatus[] = [];
  for (const ent of entries) {
    const changes = ent.changes;
    if (!Array.isArray(changes)) continue;
    for (const ch of changes) {
      const value = ch.value as Record<string, unknown> | undefined;
      if (!value || typeof value !== "object") continue;
      const statuses = value.statuses as unknown[] | undefined;
      if (!Array.isArray(statuses)) continue;
      for (const s of statuses) {
        if (!s || typeof s !== "object") continue;
        const row = s as Record<string, unknown>;
        const id = typeof row.id === "string" ? row.id.trim() : "";
        const status = typeof row.status === "string" ? row.status.trim() : "";
        const recipientId = typeof row.recipient_id === "string" ? row.recipient_id.trim() : "";
        if (id && status) result.push({ id, status, recipientId });
      }
    }
  }
  return result;
}
