/** Normaliza `messages.upsert` / `MESSAGES_UPSERT` → `MESSAGES_UPSERT`. */
export function normalizeEvolutionEventName(event: unknown): string {
  if (typeof event !== "string") return "";
  return event.replace(/\./g, "_").toUpperCase();
}

export type EvolutionInboundText = {
  remoteJid: string;
  text: string;
  fromMe: boolean;
  messageId: string;
};

function extractTextFromMessageNode(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const m = message as Record<string, unknown>;
  if (typeof m.conversation === "string" && m.conversation.trim()) return m.conversation;
  const ext = m.extendedTextMessage;
  if (ext && typeof ext === "object") {
    const t = (ext as Record<string, unknown>).text;
    if (typeof t === "string" && t.trim()) return t;
  }
  return null;
}

function pushFromMessageNode(node: unknown, out: EvolutionInboundText[]) {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  const key = n.key;
  if (!key || typeof key !== "object") return;
  const k = key as Record<string, unknown>;
  const remoteJid = typeof k.remoteJid === "string" ? k.remoteJid : typeof k.remoteJidAlt === "string" ? k.remoteJidAlt : null;
  if (!remoteJid || remoteJid.endsWith("@g.us")) return;
  const fromMe = Boolean(k.fromMe);
  const messageId = typeof k.id === "string" ? k.id : "";
  const text = extractTextFromMessageNode(n.message);
  if (!text) return;
  out.push({ remoteJid, text, fromMe, messageId });
}

/** Extrai mensagens de texto recebidas (não enviadas por nós) a partir do payload Evolution v2. */
export function extractInboundTextsFromEvolutionPayload(payload: Record<string, unknown>): EvolutionInboundText[] {
  const out: EvolutionInboundText[] = [];
  const data = payload.data;
  if (!data) return out;

  if (Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item === "object" && "messages" in (item as object)) {
        const msgs = (item as Record<string, unknown>).messages;
        if (Array.isArray(msgs)) for (const m of msgs) pushFromMessageNode(m, out);
      } else {
        pushFromMessageNode(item, out);
      }
    }
    return out.filter((m) => !m.fromMe);
  }

  if (typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.messages)) {
      for (const m of d.messages) pushFromMessageNode(m, out);
    } else if ("key" in d) {
      pushFromMessageNode(d, out);
    }
  }

  return out.filter((m) => !m.fromMe);
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
  if (inst && typeof inst === "object" && typeof (inst as { instanceName?: string }).instanceName === "string") {
    return (inst as { instanceName: string }).instanceName.trim();
  }
  return null;
}
