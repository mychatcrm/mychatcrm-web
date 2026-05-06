import type { ClientLead } from "@/lib/dashboard-data";
import { loadCrmLeadsSnapshot } from "@/lib/crm-leads-storage";

export const OPERACAO_INBOX_UPDATED_EVENT = "mychatcrm-operacao-inbox-updated";

/** v2: ignora inbox antiga com mensagens seed de demonstração. */
const STORAGE_PREFIX = "mychatcrm.operacao.inbox.v2.";

/** Alinhado ao treino de agentes (`WizardStep2Treinamento`). */
export const OPERACAO_CHAT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_DATA_URL_BYTES = 600 * 1024;

const ACCEPTED_EXT = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xlsx",
  ".pptx",
  ".xml",
  ".md",
  ".markdown",
  ".adoc",
  ".html",
  ".htm",
  ".csv",
  ".png",
  ".jpg",
  ".jpeg",
  ".tif",
  ".tiff",
  ".bmp",
  ".txt",
]);

export type OperacaoAttendant =
  | { mode: "agente"; agentLabel: string }
  | { mode: "humano" };

export type OperacaoMessage = {
  id: string;
  conversationId: string;
  direction: "in" | "out";
  kind: "text" | "file";
  text?: string;
  file?: { name: string; mime: string; size: number; previewDataUrl?: string };
  status: "sent" | "pending" | "failed";
  createdAt: string;
};

export type OperacaoConversation = {
  id: string;
  leadId: string;
  contactName: string;
  phoneLabel: string;
  attendant: OperacaoAttendant;
  lastPreview: string;
  lastAt: string;
  unread: number;
  messages: OperacaoMessage[];
};

export type OperacaoInboxState = {
  conversations: OperacaoConversation[];
};

type PersistedThread = {
  messages: OperacaoMessage[];
  unread: number;
};

type PersistedInbox = {
  threads: Record<string, PersistedThread>;
};

function operacaoInboxStorageKey(tenantId: string) {
  return `${STORAGE_PREFIX}${tenantId}`;
}

function isPersistedInbox(v: unknown): v is PersistedInbox {
  if (!v || typeof v !== "object") return false;
  const threads = (v as PersistedInbox).threads;
  if (!threads || typeof threads !== "object") return false;
  return true;
}

export function conversationIdForLead(leadId: string) {
  return `lead:${leadId}`;
}

export function deriveAttendantFromLead(lead: ClientLead): OperacaoAttendant {
  const agentLabel = (lead.agenteAtendendo || "").trim();
  const lower = agentLabel.toLowerCase();
  const tags = lead.tags.map((t) => t.toLowerCase());
  if (
    tags.some((t) => t.includes("humano") || t.includes("atendimento humano")) ||
    lower.includes("atendimento humano") ||
    lower.includes("humano") ||
    lower === "manual"
  ) {
    return { mode: "humano" };
  }
  if (!agentLabel) {
    return { mode: "agente", agentLabel: "Sem agente definido" };
  }
  return { mode: "agente", agentLabel };
}

/** ISO estável entre SSR e cliente (evita mismatch de hidratação em previews/datas). */
function stableSeedTimestampIso(lead: ClientLead): string {
  const raw = lead.dataEntradaISO.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T12:00:00.000Z`;
  return "2020-01-01T12:00:00.000Z";
}

const EMPTY_THREAD_PREVIEW = "Sem mensagens ainda";

function previewFromMessage(msg: OperacaoMessage | undefined): string {
  if (!msg) return "";
  if (msg.kind === "text") return (msg.text ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  return msg.file?.name ? `📎 ${msg.file.name}` : "Arquivo";
}

export function loadPersistedInbox(tenantId: string): PersistedInbox {
  if (typeof window === "undefined") return { threads: {} };
  try {
    const raw = window.localStorage.getItem(operacaoInboxStorageKey(tenantId));
    if (!raw) return { threads: {} };
    const parsed = JSON.parse(raw) as unknown;
    if (!isPersistedInbox(parsed)) return { threads: {} };
    return parsed;
  } catch {
    return { threads: {} };
  }
}

function persistInbox(tenantId: string, data: PersistedInbox) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(operacaoInboxStorageKey(tenantId), JSON.stringify(data));
    window.dispatchEvent(new Event(OPERACAO_INBOX_UPDATED_EVENT));
  } catch {
    /* quota / private mode */
  }
}

function pruneThreads(persisted: PersistedInbox, validIds: Set<string>): PersistedInbox {
  const nextThreads: Record<string, PersistedThread> = {};
  for (const id of validIds) {
    if (persisted.threads[id]) nextThreads[id] = persisted.threads[id];
  }
  return { threads: nextThreads };
}

export type BuildOperacaoInboxOptions = {
  /**
   * Quando true, ignora `localStorage` (mesmo resultado no SSR e no 1.º paint do cliente).
   * Depois do mount, use `refreshOperacaoInboxView` / efeitos para sincronizar com persistência.
   */
  ignorePersisted?: boolean;
};

export function buildOperacaoInboxView(
  tenantId: string,
  leads: ClientLead[],
  options?: BuildOperacaoInboxOptions,
): OperacaoInboxState {
  const persistedRaw = options?.ignorePersisted ? ({ threads: {} } satisfies PersistedInbox) : loadPersistedInbox(tenantId);
  const validIds = new Set(leads.map((l) => conversationIdForLead(l.id)));
  const persisted = pruneThreads(persistedRaw, validIds);

  const conversations: OperacaoConversation[] = leads.map((lead) => {
    const id = conversationIdForLead(lead.id);
    const thread = persisted.threads[id];
    const messages = thread?.messages?.length ? thread.messages.map((m) => ({ ...m })) : [];
    const last = messages.length ? messages[messages.length - 1] : undefined;
    const unread = thread !== undefined ? thread.unread : 0;
    return {
      id,
      leadId: lead.id,
      contactName: lead.nome,
      phoneLabel: lead.telefone,
      attendant: deriveAttendantFromLead(lead),
      lastPreview: last ? previewFromMessage(last) : EMPTY_THREAD_PREVIEW,
      lastAt: last?.createdAt ?? stableSeedTimestampIso(lead),
      unread,
      messages,
    };
  });

  conversations.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
  return { conversations };
}

export function refreshOperacaoInboxView(tenantId: string, fallbackLeads: ClientLead[]): OperacaoInboxState {
  const leads = loadCrmLeadsSnapshot(tenantId, fallbackLeads);
  return buildOperacaoInboxView(tenantId, leads);
}

export function markOperacaoConversationRead(tenantId: string, fallbackLeads: ClientLead[], conversationId: string) {
  const view = refreshOperacaoInboxView(tenantId, fallbackLeads);
  const conv = view.conversations.find((c) => c.id === conversationId);
  if (!conv || conv.unread === 0) return;
  const persisted = loadPersistedInbox(tenantId);
  const validIds = new Set(view.conversations.map((c) => c.id));
  const pruned = pruneThreads(persisted, validIds);
  pruned.threads[conversationId] = { messages: conv.messages, unread: 0 };
  persistInbox(tenantId, pruned);
}

export function appendOperacaoOutboundText(
  tenantId: string,
  fallbackLeads: ClientLead[],
  conversationId: string,
  text: string,
): { ok: true } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Mensagem vazia." };
  if (trimmed.length > 4000) return { ok: false, error: "Use no máximo 4000 caracteres." };

  const view = refreshOperacaoInboxView(tenantId, fallbackLeads);
  const conv = view.conversations.find((c) => c.id === conversationId);
  if (!conv) return { ok: false, error: "Conversa não encontrada." };

  const msg: OperacaoMessage = {
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    conversationId,
    direction: "out",
    kind: "text",
    text: trimmed,
    status: "sent",
    createdAt: new Date().toISOString(),
  };

  const nextMessages = [...conv.messages, msg];
  const persisted = loadPersistedInbox(tenantId);
  const validIds = new Set(view.conversations.map((c) => c.id));
  const pruned = pruneThreads(persisted, validIds);
  pruned.threads[conversationId] = {
    messages: nextMessages,
    unread: 0,
  };
  persistInbox(tenantId, pruned);
  return { ok: true };
}

export function appendOperacaoOutboundFile(
  tenantId: string,
  fallbackLeads: ClientLead[],
  conversationId: string,
  filePayload: { name: string; mime: string; size: number; previewDataUrl?: string },
): { ok: true } | { ok: false; error: string } {
  const view = refreshOperacaoInboxView(tenantId, fallbackLeads);
  const conv = view.conversations.find((c) => c.id === conversationId);
  if (!conv) return { ok: false, error: "Conversa não encontrada." };

  const msg: OperacaoMessage = {
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    conversationId,
    direction: "out",
    kind: "file",
    file: filePayload,
    status: "sent",
    createdAt: new Date().toISOString(),
  };

  const nextMessages = [...conv.messages, msg];
  const persisted = loadPersistedInbox(tenantId);
  const validIds = new Set(view.conversations.map((c) => c.id));
  const pruned = pruneThreads(persisted, validIds);
  pruned.threads[conversationId] = {
    messages: nextMessages,
    unread: 0,
  };
  persistInbox(tenantId, pruned);
  return { ok: true };
}

export function validateOperacaoAttachment(file: File): { ok: true } | { ok: false; error: string } {
  if (file.size > OPERACAO_CHAT_MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: "Cada arquivo deve ter no máximo 10MB." };
  }
  const lower = file.name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot) : "";
  if (!ACCEPTED_EXT.has(ext)) {
    return {
      ok: false,
      error: "Tipo de arquivo não suportado neste painel (use PDF, Office, imagens, CSV ou TXT).",
    };
  }
  return { ok: true };
}

export async function readFilePayloadForOperacaoChat(file: File): Promise<{
  name: string;
  mime: string;
  size: number;
  previewDataUrl?: string;
}> {
  const base = {
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
  };
  if (file.type.startsWith("image/") && file.size <= MAX_IMAGE_DATA_URL_BYTES) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("read"));
      r.readAsDataURL(file);
    });
    return { ...base, previewDataUrl: dataUrl };
  }
  return base;
}

export function attendantTagLabel(att: OperacaoAttendant): string {
  if (att.mode === "humano") return "Atendimento humano";
  return `Agente: ${att.agentLabel}`;
}
