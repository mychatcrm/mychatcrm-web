"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowLeft,
  Check,
  CheckCheck,
  CheckSquare,
  ChevronDown,
  Filter,
  MessageCircle,
  Mic,
  MoreVertical,
  Paperclip,
  Phone,
  Play,
  RotateCcw,
  Search,
  Send,
  Smile,
  Trash2,
  User,
  X,
} from "lucide-react";
import type { ClientSession } from "@/lib/client-auth";
import { cn } from "@/lib/utils";
import { DsButton } from "@/components/ds";
import {
  appendMessageDeduped,
  createClientTempId,
  createOptimisticOutboundMessage,
  mapDeliveryToSendStatus,
  markOptimisticMessageFailed,
  mergePolledMessages,
  reconcileOptimisticMessage,
  type SyncChatMessage,
} from "@/lib/conversas/message-sync";
import {
  subscribeToInboxBroadcast,
  type InboxBroadcastOperation,
  type WhatsappMessageRealtimeRow,
} from "@/lib/conversas/whatsapp-messages-realtime";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConvMode = "automation" | "waiting_human" | "human";

type WaConversation = {
  remoteJid: string;
  lastContent: string;
  lastKind: string;
  lastDirection: string;
  lastAt: string;
  unreadCount: number;
  connectionId?: string | null;
  channel?: "evolution" | "meta_cloud" | null;
  conversation_mode?: ConvMode;
  assigned_human_name?: string | null;
  agent_id?: string | null;
  handoff_suggested?: boolean;
  lead_id?: string | null;
  lead_name?: string | null;
  lead_status?: string | null;
  lead_crm_funnel_id?: string | null;
  lead_suggested_next_action?: string | null;
  messages: WaMessage[];
  messagesLoaded: boolean;
};

type WaMessage = {
  id: string;
  direction: "inbound" | "outbound";
  kind: "text" | "audio" | "image" | "video" | "document";
  content: string;
  media_url?: string | null;
  agent_id?: string | null;
  created_at: string;
  client_temp_id?: string | null;
  delivery_status?: string | null;
  send_status?: "sending" | "sent" | "delivered" | "read" | "failed" | null;
};

function rowToWaMessage(row: WhatsappMessageRealtimeRow | SyncChatMessage): WaMessage {
  const kind = (row.kind ?? "text") as WaMessage["kind"];
  return {
    id: row.id,
    direction: row.direction,
    kind: ["text", "audio", "image", "video", "document"].includes(kind) ? kind : "text",
    content: row.content ?? "",
    media_url: row.media_url ?? null,
    agent_id: row.agent_id ?? null,
    created_at: row.created_at,
    client_temp_id: row.client_temp_id ?? null,
    delivery_status: row.delivery_status ?? null,
    send_status: mapDeliveryToSendStatus(row.delivery_status) ?? (row as SyncChatMessage).send_status ?? null,
  };
}

type InboxTab = "all" | "ia" | "unread";

type AttendantFilter = "all" | "automation" | "human" | "waiting_human";
type PeriodFilter = "all" | "today" | "yesterday" | "yesterday_today" | "7d" | "30d" | "custom";
type TransportFilter = "all" | "evolution" | "cloud_api";

type ConnectionOption = {
  connectionId: string;
  transport: "evolution" | "cloud_api";
  label: string;
};

type AgentOption = {
  id: string;
  nome: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jidToPhone(jid: string): string {
  const num = jid.split("@")[0] ?? jid;
  return `+${num}`;
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?"
  );
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function fmtListDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 86_400_000) return fmtTime(iso);
    if (diff < 7 * 86_400_000) {
      return d.toLocaleDateString("pt-BR", { weekday: "short" });
    }
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  } catch {
    return "";
  }
}

function convDisplayName(conv: WaConversation): string {
  if (conv.lead_name) return conv.lead_name;
  return jidToPhone(conv.remoteJid);
}

const MODE_LABEL: Record<ConvMode, string> = {
  automation: "IA",
  waiting_human: "Aguardando",
  human: "Humano",
};

const MODE_DOT: Record<ConvMode, string> = {
  automation: "bg-emerald-500",
  waiting_human: "bg-amber-500",
  human: "bg-indigo-400",
};

const ATTENDANT_OPTIONS: { key: AttendantFilter; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "automation", label: "Só a inteligência artificial" },
  { key: "human", label: "Só atendimento humano" },
  { key: "waiting_human", label: "Aguardando uma pessoa" },
];

const TRANSPORT_OPTIONS: { key: TransportFilter; label: string }[] = [
  { key: "all", label: "Todos os WhatsApp" },
  { key: "evolution", label: "WhatsApp pelo QR Code" },
  { key: "cloud_api", label: "WhatsApp pela API Meta" },
];

const PERIOD_OPTIONS: { key: PeriodFilter; label: string }[] = [
  { key: "all", label: "Todo o período" },
  { key: "today", label: "Hoje" },
  { key: "yesterday", label: "Ontem" },
  { key: "yesterday_today", label: "Ontem e hoje" },
  { key: "7d", label: "Últimos 7 dias" },
  { key: "30d", label: "Últimos 30 dias" },
  { key: "custom", label: "Escolher datas" },
];

function conversationMatchesTransport(conv: WaConversation, transport: TransportFilter): boolean {
  if (transport === "all") return true;
  if (transport === "cloud_api") return conv.channel === "meta_cloud";
  return conv.channel === "evolution" || !conv.channel;
}

const selectClassName =
  "mt-1.5 h-10 w-full rounded-mc-base border border-mc-border bg-mc-surface-2 px-3 text-[13px] text-mc-text outline-none focus:border-[rgba(242,68,0,0.45)]";

function statusChipClass(active: boolean): string {
  return cn(
    "flex-1 rounded-mc-base px-2.5 py-2 text-center text-[12.5px] font-semibold transition-colors",
    active ? "bg-mc-rail text-white" : "bg-mc-surface-2 text-mc-muted hover:text-mc-text",
  );
}


function periodStart(period: PeriodFilter, customFrom: string): Date | null {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "today") return startOfToday;
  if (period === "yesterday" || period === "yesterday_today") {
    return new Date(startOfToday.getTime() - 86_400_000);
  }
  if (period === "7d") return new Date(now.getTime() - 7 * 86_400_000);
  if (period === "30d") return new Date(now.getTime() - 30 * 86_400_000);
  if (period === "custom" && customFrom) return new Date(`${customFrom}T00:00:00`);
  return null;
}

/** Único período com teto antes de agora: "ontem" não pode incluir hoje. */
function periodEnd(period: PeriodFilter): Date | null {
  if (period !== "yesterday") return null;
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Fecha popover/menu ao clicar fora do elemento referenciado. */
function useClickOutside(ref: React.RefObject<HTMLElement | null>, active: boolean, onOutside: () => void) {
  useEffect(() => {
    if (!active) return;
    function handlePointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}

// ---------------------------------------------------------------------------
// API helpers (local — same endpoints as OperacaoConversasHub)
// ---------------------------------------------------------------------------

async function apiLoadAgents(): Promise<AgentOption[]> {
  const res = await fetch("/api/client/agentes", { cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json()) as { agents?: Array<{ id?: string; nome?: string; status?: string }> };
  return (data.agents ?? [])
    .filter((a) => a.id && a.status !== "pausado" && a.status !== "inativo")
    .map((a) => ({ id: String(a.id), nome: String(a.nome ?? "Agente") }));
}

async function apiLoadConversations(
  connectionId?: string | null,
  options?: { archived?: boolean },
): Promise<WaConversation[]> {
  const params = new URLSearchParams();
  if (connectionId) params.set("connectionId", connectionId);
  if (options?.archived) params.set("archived", "true");
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`/api/client/conversas${qs}`, { cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    conversations: Omit<WaConversation, "messages" | "messagesLoaded">[];
  };
  return (data.conversations ?? []).map((c) => ({
    ...c,
    messages: [],
    messagesLoaded: false,
  }));
}

async function apiRestoreConversations(remoteJids: string[]): Promise<void> {
  const res = await fetch("/api/client/conversas/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remoteJids }),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error ?? `Erro ${res.status} ao restaurar conversas.`);
  }
}

async function apiLoadConnections(): Promise<ConnectionOption[]> {
  const res = await fetch("/api/client/whatsapp/connections", { cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json()) as { connections: ConnectionOption[] };
  return data.connections ?? [];
}

async function apiLoadMessages(
  remoteJid: string,
): Promise<{
  messages: WaMessage[];
  aiEnabled: boolean;
  canHumanSend: boolean;
  conversationMode: ConvMode;
}> {
  const enc = encodeURIComponent(remoteJid);
  const res = await fetch(`/api/client/conversas/${enc}/messages`, { cache: "no-store" });
  if (!res.ok) {
    return { messages: [], aiEnabled: true, canHumanSend: false, conversationMode: "automation" };
  }
  const data = (await res.json()) as {
    messages: WaMessage[];
    automation?: {
      enabled?: boolean;
      can_human_send?: boolean;
      conversation_mode?: ConvMode;
    };
  };
  const mode = data.automation?.conversation_mode
    ?? (data.automation?.enabled === false ? "human" : "automation");
  return {
    messages: (data.messages ?? []).map((m) => ({
      ...m,
      send_status: m.send_status ?? mapDeliveryToSendStatus(m.delivery_status),
    })),
    aiEnabled: data.automation?.enabled !== false,
    canHumanSend: data.automation?.can_human_send ?? mode !== "automation",
    conversationMode: mode,
  };
}

async function apiLoadInboxRealtimeTopic(): Promise<string> {
  const res = await fetch("/api/client/conversas/realtime", { cache: "no-store" });
  if (!res.ok) throw new Error(`realtime_topic_${res.status}`);
  const data = (await res.json()) as { topic?: unknown };
  if (typeof data.topic !== "string" || !data.topic.startsWith("inbox:")) {
    throw new Error("realtime_topic_invalid");
  }
  return data.topic;
}

async function apiHydrateRealtimeMessages(ids: string[]): Promise<WhatsappMessageRealtimeRow[]> {
  if (!ids.length) return [];
  const res = await fetch("/api/client/conversas/realtime", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`realtime_hydrate_${res.status}`);
  const data = (await res.json()) as { messages?: WhatsappMessageRealtimeRow[] };
  return Array.isArray(data.messages) ? data.messages : [];
}

async function apiSendMessage(
  remoteJid: string,
  text: string,
  clientTempId: string,
): Promise<WaMessage | null> {
  const res = await fetch("/api/client/conversas/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remoteJid, text, clientTempId }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string; message?: WaMessage };
    const error = new Error(err.error ?? `Erro ${res.status} ao enviar`) as Error & {
      persistedMessage?: WaMessage | null;
      status?: number;
    };
    error.persistedMessage = err.message ?? null;
    error.status = res.status;
    throw error;
  }
  const data = (await res.json()) as { message?: WaMessage };
  return data.message ?? null;
}

async function apiTakeoverConversation(remoteJid: string): Promise<{
  canHumanSend: boolean;
  conversationMode: ConvMode;
}> {
  const res = await fetch("/api/client/conversas/takeover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remoteJid }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Erro ${res.status} ao assumir atendimento`);
  }
  const data = (await res.json()) as {
    operation?: { conversation_mode?: ConvMode; can_human_send?: boolean };
  };
  return {
    canHumanSend: data.operation?.can_human_send ?? true,
    conversationMode: data.operation?.conversation_mode ?? "human",
  };
}

async function apiSaveConversationToCrm(
  remoteJid: string,
  name: string,
): Promise<{ id: string; name: string | null; status: string | null; crm_funnel_id: string | null }> {
  const enc = encodeURIComponent(remoteJid);
  const res = await fetch(`/api/client/conversas/${enc}/save-to-crm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    lead?: {
      id: string;
      name: string | null;
      status: string | null;
      crm_funnel_id: string | null;
    };
  };
  if (!res.ok || !data.lead) {
    throw new Error(data.error ?? "Não foi possível salvar o contato no CRM.");
  }
  return data.lead;
}

async function apiDeleteAllConversations(): Promise<void> {
  const res = await fetch("/api/client/conversas/all", { method: "DELETE" });
  if (!res.ok) throw new Error(`Erro ${res.status} ao limpar conversas.`);
}

async function apiBulkDeleteConversations(remoteJids: string[]): Promise<void> {
  const res = await fetch("/api/client/conversas/bulk-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remoteJids }),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error ?? `Erro ${res.status} ao excluir conversas selecionadas.`);
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ConvItemInner({
  conv,
  selected,
  onClick,
  selectionMode = false,
  checked = false,
  onToggleCheck,
}: {
  conv: WaConversation;
  selected: boolean;
  onClick: () => void;
  selectionMode?: boolean;
  checked?: boolean;
  onToggleCheck?: () => void;
}) {
  const name = convDisplayName(conv);
  const mode = conv.conversation_mode ?? "automation";
  const channelLabel =
    conv.channel === "meta_cloud" ? "Meta" : conv.channel === "evolution" ? "QR" : null;
  return (
    <button
      type="button"
      onClick={selectionMode ? onToggleCheck : onClick}
      className={cn(
        "flex w-full items-start gap-3 rounded-mc-base px-3 py-3 text-left transition-colors",
        selectionMode
          ? checked
            ? "border border-[rgba(242,68,0,0.3)] bg-[rgba(242,68,0,0.06)]"
            : "border border-transparent hover:bg-mc-surface-2"
          : selected
          ? "bg-[rgba(242,68,0,0.08)] border border-[rgba(242,68,0,0.2)]"
          : "border border-transparent hover:bg-mc-surface-2",
      )}
    >
      {selectionMode && (
        <span
          aria-hidden
          className={cn(
            "mt-1.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-2 transition-colors",
            checked ? "border-[#F24400] bg-[#F24400] text-white" : "border-mc-border bg-mc-surface",
          )}
        >
          {checked && <Check size={12} strokeWidth={3} />}
        </span>
      )}
      <div className="relative shrink-0">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-mc-surface-2 text-[13px] font-bold text-mc-muted">
          {initials(name)}
        </div>
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-mc-surface",
            MODE_DOT[mode],
          )}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13.5px] font-semibold text-mc-text">{name}</span>
          <span className="shrink-0 text-[11px] text-mc-muted">{fmtListDate(conv.lastAt)}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate text-[12.5px] text-mc-muted">{conv.lastContent}</span>
          {conv.unreadCount > 0 && (
            <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[#F24400] px-1 text-[10px] font-bold text-white">
              {conv.unreadCount}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {conv.conversation_mode && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-mc-muted">
              <span className={cn("h-1.5 w-1.5 rounded-full", MODE_DOT[mode])} />
              {mode === "human" && conv.assigned_human_name ? conv.assigned_human_name : MODE_LABEL[mode]}
            </span>
          )}
          {channelLabel && (
            <span className="rounded-full bg-mc-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-mc-muted">
              {channelLabel}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

const ConvItem = memo(ConvItemInner);

function MessageBubble({ msg }: { msg: WaMessage }) {
  const isOut = msg.direction === "outbound";
  const isBot = isOut && msg.agent_id === null;

  if (msg.kind === "audio") {
    return (
      <div className={cn("flex max-w-[62%] flex-col", isOut ? "self-end items-end" : "self-start items-start")}>
        <div
          className={cn(
            "flex items-center gap-3 rounded-mc-base border px-4 py-3",
            isOut
              ? "border-transparent bg-[#dcf8c6] rounded-tr-sm"
              : "border-mc-border bg-mc-surface rounded-tl-sm",
          )}
        >
          <button type="button" className={cn("shrink-0", isOut ? "text-[#1a3a1a]" : "text-mc-muted")}>
            <Play size={16} strokeWidth={1.9} />
          </button>
          <div className="h-1 w-28 overflow-hidden rounded-full bg-mc-border">
            <div className="h-full w-2/5 rounded-full bg-[#F24400]" />
          </div>
          <span className={cn("text-[11px]", isOut ? "text-[#1a3a1a]/70" : "text-mc-muted")}>0:08</span>
        </div>
        <div className="mt-1 flex items-center gap-1 text-[10.5px] text-mc-muted">
          <Mic size={10} strokeWidth={1.9} />
          <span>Áudio · {fmtTime(msg.created_at)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex max-w-[66%] flex-col", isOut ? "self-end items-end" : "self-start items-start")}>
      <div
        className={cn(
          "rounded-mc-base border px-4 py-3 text-[13.5px] leading-relaxed",
          isOut
            ? "border-transparent bg-[#dcf8c6] text-[#1a3a1a] rounded-tr-sm"
            : "border-mc-border bg-mc-surface text-mc-text rounded-tl-sm",
        )}
      >
        {msg.content}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-mc-muted">
        {isBot && <span className="font-semibold text-emerald-600">✦ IA</span>}
        <span>{fmtTime(msg.created_at)}</span>
        {isOut && (
          msg.send_status === "sent" || msg.send_status == null
            ? <CheckCheck size={12} strokeWidth={2} className="text-emerald-500" />
            : msg.send_status === "sending"
            ? <Check size={12} strokeWidth={2} className="text-mc-muted" />
            : null
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AtendimentoV2({ session }: { session: ClientSession }) {
  const tenantId = session.tenantId;
  const [conversations, setConversations] = useState<WaConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJid, setSelectedJid] = useState<string | null>(null);
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [canHumanSend, setCanHumanSend] = useState(false);
  const [msgLoading, setMsgLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<InboxTab>("all");
  const [compose, setCompose] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [takeoverBusy, setTakeoverBusy] = useState(false);
  const [showCrm, setShowCrm] = useState(true);
  const [savingToCrm, setSavingToCrm] = useState(false);
  const [saveToCrmError, setSaveToCrmError] = useState<string | null>(null);

  // Seleção múltipla + limpeza de conversas
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedForDeletion, setSelectedForDeletion] = useState<Set<string>>(new Set());
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"all" | "selected" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);

  // Conversas arquivadas — visualização e restauração. "Limpar tudo" arquiva
  // sem apagar, mas até aqui não havia como voltar pelo painel.
  const [archivedView, setArchivedView] = useState(false);
  const [archivedConversations, setArchivedConversations] = useState<WaConversation[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [selectedForRestore, setSelectedForRestore] = useState<Set<string>>(new Set());

  // Filtros (chips visíveis + popover de período/modo/número)
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [attendantFilter, setAttendantFilter] = useState<AttendantFilter>("all");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [connections, setConnections] = useState<ConnectionOption[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [connectionFilter, setConnectionFilter] = useState<string | null>(null);
  const [transportFilter, setTransportFilter] = useState<TransportFilter>("all");
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [realtimeLive, setRealtimeLive] = useState(false);
  const initialListLoadedRef = useRef(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  const selectedJidRef = useRef<string | null>(null);
  const connectionFilterRef = useRef<string | null>(null);
  const realtimeLiveRef = useRef(false);

  useClickOutside(headerMenuRef, headerMenuOpen, () => setHeaderMenuOpen(false));
  useClickOutside(filtersRef, filtersOpen, () => setFiltersOpen(false));

  useEffect(() => {
    selectedJidRef.current = selectedJid;
  }, [selectedJid]);

  useEffect(() => {
    connectionFilterRef.current = connectionFilter;
  }, [connectionFilter]);

  useEffect(() => {
    realtimeLiveRef.current = realtimeLive;
  }, [realtimeLive]);

  // Linhas WhatsApp + agentes para filtros
  useEffect(() => {
    apiLoadConnections()
      .then(setConnections)
      .catch(() => {});
    apiLoadAgents()
      .then(setAgents)
      .catch(() => {});
  }, []);

  // Load conversations — sem skeleton ao trocar número (só no 1º load)
  useEffect(() => {
    let cancelled = false;
    const showSkeleton = !initialListLoadedRef.current;
    if (showSkeleton) setLoading(true);
    apiLoadConversations(connectionFilter)
      .then((list) => {
        if (cancelled) return;
        setConversations(list);
        setSelectedJid((prev) =>
          prev && list.some((c) => c.remoteJid === prev) ? prev : list[0]?.remoteJid ?? null,
        );
        initialListLoadedRef.current = true;
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionFilter]);

  // Load messages when selection changes
  useEffect(() => {
    if (!selectedJid) {
      setMessages([]);
      setCanHumanSend(false);
      return;
    }
    const jid = selectedJid;
    let cancelled = false;
    setMsgLoading(true);
    setSendError(null);
    apiLoadMessages(jid)
      .then(({ messages: msgs, aiEnabled: ai, canHumanSend: canSend, conversationMode }) => {
        if (cancelled || selectedJidRef.current !== jid) return;
        setMessages(msgs);
        setAiEnabled(ai);
        setCanHumanSend(canSend);
        setConversations((prev) =>
          prev.map((c) =>
            c.remoteJid !== jid
              ? c
              : {
                  ...c,
                  unreadCount: 0,
                  conversation_mode: conversationMode,
                  messagesLoaded: true,
                },
          ),
        );
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled && selectedJidRef.current === jid) setMsgLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedJid]);

  const mergeConversationList = useCallback((list: WaConversation[]) => {
    setConversations((prev) => {
      const prevByJid = new Map(prev.map((c) => [c.remoteJid, c]));
      return list.map((c) => {
        const old = prevByJid.get(c.remoteJid);
        return old
          ? {
              ...c,
              unreadCount:
                c.remoteJid === selectedJidRef.current ? 0 : Math.max(c.unreadCount, old.unreadCount),
              messages: old.messages,
              messagesLoaded: old.messagesLoaded,
            }
          : c;
      });
    });
  }, []);

  // Broadcast tenant-wide. O evento contém apenas o UUID; os dados são
  // hidratados por uma API autenticada e agrupados no mesmo frame.
  useEffect(() => {
    if (!tenantId) return;

    let active = true;
    let unsubscribe: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let retryAttempt = 0;
    let connecting = false;
    let replacingChannel = false;
    let hydrating = false;
    const pending = new Map<string, InboxBroadcastOperation>();
    const seenMessageIds = new Set<string>();

    const applyIncoming = (row: WhatsappMessageRealtimeRow) => {
      const connectionId = connectionFilterRef.current;
      if (connectionId && row.connection_id !== connectionId) return;
      const msg = rowToWaMessage(row);
      const jid = row.remote_jid;
      if (!jid) return;
      const openJid = selectedJidRef.current;
      const channel =
        row.channel === "meta_cloud" || row.channel === "evolution" ? row.channel : undefined;

      setConversations((prev) => {
        const existing = prev.find((c) => c.remoteJid === jid);
        if (existing) {
          return prev
            .map((c) =>
              c.remoteJid !== jid
                ? c
                : {
                    ...c,
                    lastContent: msg.content,
                    lastKind: msg.kind,
                    lastDirection: msg.direction,
                    lastAt: msg.created_at,
                    channel: channel ?? c.channel,
                    connectionId: row.connection_id ?? c.connectionId,
                    agent_id: msg.agent_id ?? c.agent_id,
                    unreadCount:
                      msg.direction === "inbound" && jid !== openJid
                        ? c.unreadCount + 1
                        : c.unreadCount,
                  },
            )
            .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
        }
        return [
          {
            remoteJid: jid,
            lastContent: msg.content,
            lastKind: msg.kind,
            lastDirection: msg.direction,
            lastAt: msg.created_at,
            channel: channel ?? null,
            connectionId: row.connection_id ?? null,
            agent_id: msg.agent_id ?? null,
            unreadCount: msg.direction === "inbound" && jid !== openJid ? 1 : 0,
            messages: [],
            messagesLoaded: false,
          },
          ...prev,
        ];
      });

      if (jid === openJid) {
        setMessages((prev) => appendMessageDeduped(prev, msg) as WaMessage[]);
      }
    };

    const applyUpdate = (row: WhatsappMessageRealtimeRow) => {
      const connectionId = connectionFilterRef.current;
      if (connectionId && row.connection_id !== connectionId) return;
      const msg = rowToWaMessage(row);
      setConversations((prev) =>
        prev.map((conversation) => {
          if (conversation.remoteJid !== row.remote_jid) return conversation;
          if (new Date(msg.created_at).getTime() < new Date(conversation.lastAt).getTime()) {
            return conversation;
          }
          return {
            ...conversation,
            lastContent: msg.content,
            lastKind: msg.kind,
            lastDirection: msg.direction,
            lastAt: msg.created_at,
            agent_id: msg.agent_id ?? conversation.agent_id,
          };
        }),
      );
      if (row.remote_jid !== selectedJidRef.current) return;
      setMessages((prev) => appendMessageDeduped(prev, msg) as WaMessage[]);
    };

    const reconcile = async () => {
      if (!active || (typeof document !== "undefined" && document.hidden)) return;
      const jid = selectedJidRef.current;
      const [listResult, messagesResult] = await Promise.allSettled([
        apiLoadConversations(connectionFilterRef.current),
        jid ? apiLoadMessages(jid) : Promise.resolve(null),
      ]);
      if (!active) return;
      if (listResult.status === "fulfilled") mergeConversationList(listResult.value);
      if (jid && messagesResult.status === "fulfilled" && messagesResult.value) {
        if (selectedJidRef.current !== jid) return;
        const result = messagesResult.value;
        setMessages((prev) => mergePolledMessages(prev, result.messages) as WaMessage[]);
        setAiEnabled(result.aiEnabled);
        setCanHumanSend(result.canHumanSend);
        setConversations((prev) =>
          prev.map((conversation) =>
            conversation.remoteJid === jid
              ? { ...conversation, conversation_mode: result.conversationMode, unreadCount: 0 }
              : conversation,
          ),
        );
      }
    };

    const scheduleFlush = (delay = 16) => {
      if (!active || flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flush();
      }, delay);
    };

    const flush = async () => {
      if (!active || hydrating || pending.size === 0) return;
      hydrating = true;
      const batch = Array.from(pending.entries()).slice(0, 50);
      for (const [id] of batch) pending.delete(id);
      try {
        const rows = await apiHydrateRealtimeMessages(batch.map(([id]) => id));
        if (!active) return;
        const operations = new Map(batch);
        for (const row of rows) {
          if (operations.get(row.id) === "update" || seenMessageIds.has(row.id)) {
            applyUpdate(row);
          } else {
            seenMessageIds.add(row.id);
            applyIncoming(row);
          }
        }
      } catch {
        for (const [id, operation] of batch) {
          const previous = pending.get(id);
          pending.set(id, previous === "insert" ? "insert" : operation);
        }
        scheduleFlush(1_000);
      } finally {
        hydrating = false;
        if (pending.size > 0) scheduleFlush();
      }
    };

    const queueMessage = (messageId: string, operation: InboxBroadcastOperation) => {
      const previous = pending.get(messageId);
      pending.set(messageId, previous === "insert" ? "insert" : operation);
      scheduleFlush();
    };

    const scheduleReconnect = () => {
      if (!active || retryTimer) return;
      const delay = Math.min(5_000, 250 * 2 ** Math.min(retryAttempt, 5));
      retryAttempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (!active || connecting) return;
      connecting = true;
      try {
        const topic = await apiLoadInboxRealtimeTopic();
        if (!active) return;
        replacingChannel = true;
        unsubscribe?.();
        unsubscribe = subscribeToInboxBroadcast({
          topic,
          onMessage: queueMessage,
          onStatus: (status) => {
            if (!active || replacingChannel) return;
            const subscribed = status === "SUBSCRIBED";
            setRealtimeLive(subscribed);
            if (subscribed) {
              retryAttempt = 0;
              void reconcile();
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
              scheduleReconnect();
            }
          },
        });
        replacingChannel = false;
      } catch {
        setRealtimeLive(false);
        scheduleReconnect();
      } finally {
        connecting = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) return;
      void reconcile();
      if (!realtimeLiveRef.current) void connect();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    void connect();

    return () => {
      active = false;
      replacingChannel = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (retryTimer) clearTimeout(retryTimer);
      if (flushTimer) clearTimeout(flushTimer);
      unsubscribe?.();
    };
  }, [mergeConversationList, tenantId]);

  // Poll lista: 45s com realtime vivo, 8s se cair
  useEffect(() => {
    const refreshConvs = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const list = await apiLoadConversations(connectionFilterRef.current);
        mergeConversationList(list);
      } catch {
        /* ignore poll errors */
      }
    };
    const tickMs = realtimeLive ? 45_000 : 8_000;
    const id = setInterval(() => void refreshConvs(), tickMs);
    return () => clearInterval(id);
  }, [mergeConversationList, realtimeLive]);

  // Poll chat aberto: NÃO duplicar o load do select — só intervalo (12s live / 3s fallback)
  useEffect(() => {
    if (!selectedJid) return;
    const jid = selectedJid;
    const refreshMsgs = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const { messages: polled, aiEnabled: ai, canHumanSend: canSend, conversationMode } =
          await apiLoadMessages(jid);
        if (selectedJidRef.current !== jid) return;
        setMessages((prev) => mergePolledMessages(prev, polled) as WaMessage[]);
        setAiEnabled(ai);
        setCanHumanSend(canSend);
        setConversations((prev) =>
          prev.map((c) =>
            c.remoteJid !== jid ? c : { ...c, conversation_mode: conversationMode, unreadCount: 0 },
          ),
        );
      } catch {
        /* ignore */
      }
    };
    const tickMs = realtimeLiveRef.current || realtimeLive ? 12_000 : 3_000;
    const id = setInterval(() => void refreshMsgs(), tickMs);
    return () => clearInterval(id);
  }, [selectedJid, realtimeLive]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const selectedConv = conversations.find((c) => c.remoteJid === selectedJid) ?? null;
  const selectedName = selectedConv ? convDisplayName(selectedConv) : "";

  const unreadCount = useMemo(
    () => conversations.filter((c) => c.unreadCount > 0).length,
    [conversations],
  );
  const filtersActive =
    attendantFilter !== "all" ||
    periodFilter !== "all" ||
    connectionFilter !== null ||
    transportFilter !== "all" ||
    agentFilter !== null;

  const filteredConnections = useMemo(() => {
    if (transportFilter === "all") return connections;
    return connections.filter((c) => c.transport === transportFilter);
  }, [connections, transportFilter]);

  const filtered = useMemo(() => {
    return conversations.filter((c) => {
      const name = convDisplayName(c).toLowerCase();
      const matchSearch =
        !search ||
        name.includes(search.toLowerCase()) ||
        c.lastContent.toLowerCase().includes(search.toLowerCase());
      const matchTab =
        tab === "all" ||
        (tab === "ia" && c.conversation_mode === "automation") ||
        (tab === "unread" && c.unreadCount > 0);
      const matchAttendant =
        attendantFilter === "all" || (c.conversation_mode ?? "automation") === attendantFilter;
      const matchTransport = conversationMatchesTransport(c, transportFilter);
      const matchAgent = !agentFilter || c.agent_id === agentFilter;
      const matchConnection = !connectionFilter || c.connectionId === connectionFilter;

      let matchPeriod = true;
      if (periodFilter !== "all") {
        const convDate = new Date(c.lastAt);
        const start = periodStart(periodFilter, customFrom);
        if (start && convDate < start) matchPeriod = false;
        const end = periodEnd(periodFilter);
        if (end && convDate >= end) matchPeriod = false;
        if (periodFilter === "custom" && customTo) {
          const end = new Date(`${customTo}T23:59:59`);
          if (convDate > end) matchPeriod = false;
        }
      }

      return (
        matchSearch &&
        matchTab &&
        matchAttendant &&
        matchTransport &&
        matchAgent &&
        matchConnection &&
        matchPeriod
      );
    });
  }, [
    conversations,
    search,
    tab,
    attendantFilter,
    transportFilter,
    agentFilter,
    connectionFilter,
    periodFilter,
    customFrom,
    customTo,
  ]);

  const clearFilters = () => {
    setAttendantFilter("all");
    setPeriodFilter("all");
    setCustomFrom("");
    setCustomTo("");
    setConnectionFilter(null);
    setTransportFilter("all");
    setAgentFilter(null);
  };

  const enterSelectionMode = () => {
    setHeaderMenuOpen(false);
    setSelectionMode(true);
    setSelectedForDeletion(new Set());
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedForDeletion(new Set());
  };

  const toggleSelectForDeletion = (jid: string) => {
    setSelectedForDeletion((prev) => {
      const next = new Set(prev);
      if (next.has(jid)) next.delete(jid);
      else next.add(jid);
      return next;
    });
  };

  const handleConfirmDelete = async () => {
    if (deleteBusy || !confirmAction) return;
    setDeleteBusy(true);
    setActionError(null);
    const jids = confirmAction === "all" ? conversations.map((c) => c.remoteJid) : Array.from(selectedForDeletion);
    const jidSet = new Set(jids);
    const previous = conversations;
    setConversations((prev) => prev.filter((c) => !jidSet.has(c.remoteJid)));
    if (selectedJid && jidSet.has(selectedJid)) setSelectedJid(null);
    try {
      if (confirmAction === "all") {
        await apiDeleteAllConversations();
      } else {
        await apiBulkDeleteConversations(jids);
      }
      setConfirmAction(null);
      setSelectionMode(false);
      setSelectedForDeletion(new Set());
    } catch (e) {
      setConversations(previous);
      setActionError(e instanceof Error ? e.message : "Erro ao limpar conversas.");
    } finally {
      setDeleteBusy(false);
    }
  };

  const openArchivedView = useCallback(async () => {
    setHeaderMenuOpen(false);
    setArchivedView(true);
    setSelectedForRestore(new Set());
    setActionError(null);
    setArchivedLoading(true);
    try {
      const list = await apiLoadConversations(connectionFilterRef.current, { archived: true });
      setArchivedConversations(list);
    } finally {
      setArchivedLoading(false);
    }
  }, []);

  const closeArchivedView = () => {
    setArchivedView(false);
    setArchivedConversations([]);
    setSelectedForRestore(new Set());
  };

  const toggleSelectForRestore = (jid: string) => {
    setSelectedForRestore((prev) => {
      const next = new Set(prev);
      if (next.has(jid)) next.delete(jid);
      else next.add(jid);
      return next;
    });
  };

  const handleRestore = async (jids: string[]) => {
    if (restoreBusy || jids.length === 0) return;
    setRestoreBusy(true);
    setActionError(null);
    const jidSet = new Set(jids);
    const previous = archivedConversations;
    setArchivedConversations((prev) => prev.filter((c) => !jidSet.has(c.remoteJid)));
    setSelectedForRestore((prev) => {
      const next = new Set(prev);
      for (const jid of jids) next.delete(jid);
      return next;
    });
    try {
      await apiRestoreConversations(jids);
      // A lista principal está com Realtime + poll; um refresh explícito
      // evita esperar o próximo tick pra a conversa restaurada aparecer.
      const list = await apiLoadConversations(connectionFilterRef.current);
      setConversations(list);
    } catch (e) {
      setArchivedConversations(previous);
      setActionError(e instanceof Error ? e.message : "Erro ao restaurar conversas.");
    } finally {
      setRestoreBusy(false);
    }
  };

  const handleTakeover = useCallback(async () => {
    if (!selectedJid || takeoverBusy) return;
    setTakeoverBusy(true);
    setSendError(null);
    try {
      const result = await apiTakeoverConversation(selectedJid);
      setCanHumanSend(result.canHumanSend);
      setAiEnabled(false);
      setConversations((prev) =>
        prev.map((c) =>
          c.remoteJid !== selectedJid
            ? c
            : { ...c, conversation_mode: result.conversationMode },
        ),
      );
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Não foi possível assumir o atendimento.");
    } finally {
      setTakeoverBusy(false);
    }
  }, [selectedJid, takeoverBusy]);

  const handleSend = useCallback(async () => {
    if (!selectedJid || !compose.trim() || sending) return;
    if (!canHumanSend) {
      setSendError("Assuma o atendimento para enviar mensagens humanas.");
      return;
    }
    const text = compose.trim();
    const jid = selectedJid;
    const clientTempId = createClientTempId();
    const tempMsg = createOptimisticOutboundMessage({ text, clientTempId }) as WaMessage;
    setCompose("");
    setSending(true);
    setSendError(null);
    setMessages((prev) => [...prev, tempMsg]);
    setConversations((prev) =>
      prev
        .map((c) =>
          c.remoteJid !== jid
            ? c
            : {
                ...c,
                lastContent: text,
                lastKind: "text",
                lastDirection: "outbound",
                lastAt: tempMsg.created_at,
              },
        )
        .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime()),
    );

    try {
      const saved = await apiSendMessage(jid, text, clientTempId);
      if (saved) {
        setMessages((prev) =>
          reconcileOptimisticMessage(prev, clientTempId, rowToWaMessage(saved)) as WaMessage[],
        );
      }
    } catch (e) {
      const persisted =
        e && typeof e === "object" && "persistedMessage" in e
          ? (e as { persistedMessage?: WaMessage | null }).persistedMessage
          : null;
      setSendError(e instanceof Error ? e.message : "Erro ao enviar mensagem.");
      setMessages((prev) =>
        persisted
          ? (reconcileOptimisticMessage(prev, clientTempId, {
              ...rowToWaMessage(persisted),
              send_status: "failed",
              delivery_status: "failed",
            }) as WaMessage[])
          : (markOptimisticMessageFailed(prev, clientTempId) as WaMessage[]),
      );
    } finally {
      setSending(false);
    }
  }, [selectedJid, compose, sending, canHumanSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleSaveToCrm = async () => {
    if (!selectedConv || selectedConv.lead_id || savingToCrm) return;
    setSavingToCrm(true);
    setSaveToCrmError(null);
    try {
      const lead = await apiSaveConversationToCrm(selectedConv.remoteJid, selectedName);
      setConversations((current) =>
        current.map((conversation) =>
          conversation.remoteJid === selectedConv.remoteJid
            ? {
                ...conversation,
                lead_id: lead.id,
                lead_name: lead.name,
                lead_status: lead.status,
                lead_crm_funnel_id: lead.crm_funnel_id,
              }
            : conversation,
        ),
      );
    } catch (error) {
      setSaveToCrmError(
        error instanceof Error ? error.message : "Não foi possível salvar o contato no CRM.",
      );
    } finally {
      setSavingToCrm(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-mc-bg">
      {/* ── Conversation list panel ── */}
      <div
        className={cn(
          "flex w-[344px] shrink-0 flex-col border-r border-mc-border bg-mc-surface",
          selectedJid ? "hidden md:flex" : "flex",
        )}
      >
        {/* Header */}
        <div className="border-b border-mc-border px-5 pb-3 pt-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-extrabold tracking-tight text-mc-text">Conversas</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-mc-base text-white transition-colors active:scale-[0.98]"
                style={{ backgroundColor: "var(--color-brand)" }}
                aria-label="Nova conversa"
              >
                <span className="text-xl font-light leading-none">+</span>
              </button>
              <div className="relative" ref={headerMenuRef}>
                <button
                  type="button"
                  onClick={() => setHeaderMenuOpen((v) => !v)}
                  className="flex h-9 w-9 items-center justify-center rounded-mc-base text-mc-muted transition-colors hover:bg-mc-surface-2"
                  aria-label="Mais opções"
                  aria-expanded={headerMenuOpen}
                >
                  <MoreVertical size={18} strokeWidth={1.9} />
                </button>
                {headerMenuOpen && (
                  <div className="absolute right-0 top-11 z-20 w-56 overflow-hidden rounded-mc-base border border-mc-border bg-mc-surface py-1.5">
                    <button
                      type="button"
                      onClick={enterSelectionMode}
                      disabled={conversations.length === 0}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] font-medium text-mc-text transition-colors hover:bg-mc-surface-2 disabled:opacity-40"
                    >
                      <CheckSquare size={15} strokeWidth={1.9} />
                      Selecionar conversas
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setHeaderMenuOpen(false);
                        setConfirmAction("all");
                      }}
                      disabled={conversations.length === 0}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] font-medium text-error transition-colors hover:bg-mc-surface-2 disabled:opacity-40"
                    >
                      <Trash2 size={15} strokeWidth={1.9} />
                      Limpar todas as conversas
                    </button>
                    <button
                      type="button"
                      onClick={openArchivedView}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] font-medium text-mc-text transition-colors hover:bg-mc-surface-2"
                    >
                      <Archive size={15} strokeWidth={1.9} />
                      Ver arquivadas
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* Busca */}
          <div className="flex items-center gap-2.5 rounded-mc-base bg-mc-surface-2 px-4 py-2.5">
            <Search size={14} strokeWidth={1.9} className="shrink-0 text-mc-muted" />
            <input
              type="search"
              placeholder="Buscar por nome ou mensagem…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent text-[13.5px] text-mc-text placeholder:text-mc-muted focus:outline-none"
            />
          </div>
        </div>

        {archivedView ? (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-mc-border px-5 py-3">
              <button
                type="button"
                onClick={closeArchivedView}
                className="flex items-center gap-1.5 text-[12.5px] font-semibold text-mc-muted transition-colors hover:text-mc-text"
              >
                <ArrowLeft size={15} strokeWidth={2} />
                Voltar
              </button>
              <span className="text-[12.5px] font-semibold text-mc-text">Conversas arquivadas</span>
              <span className="w-[52px]" />
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {archivedLoading && (
                <div className="space-y-2 p-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-16 animate-pulse rounded-mc-base bg-mc-surface-2" />
                  ))}
                </div>
              )}
              {!archivedLoading && archivedConversations.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                  <Archive size={28} strokeWidth={1.5} className="text-mc-muted/50" />
                  <p className="text-[13px] text-mc-muted">Nenhuma conversa arquivada.</p>
                </div>
              )}
              <div className="space-y-1">
                {archivedConversations.map((conv) => (
                  <div
                    key={conv.remoteJid}
                    className="flex items-center justify-between gap-2 rounded-mc-base px-3 py-2.5 hover:bg-mc-surface-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-semibold text-mc-text">
                        {conv.lead_name ?? jidToPhone(conv.remoteJid)}
                      </p>
                      <p className="truncate text-[12px] text-mc-muted">{conv.lastContent}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRestore([conv.remoteJid])}
                      disabled={restoreBusy}
                      className="flex shrink-0 items-center gap-1.5 rounded-mc-base border border-mc-border px-2.5 py-1.5 text-[12px] font-semibold text-mc-text transition-colors hover:bg-mc-surface-2 disabled:opacity-40"
                    >
                      <RotateCcw size={13} strokeWidth={2} />
                      Restaurar
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
        {/* Filtros / barra de seleção */}
        {selectionMode ? (
          <div className="flex items-center justify-between gap-2 border-b border-mc-border px-5 py-3">
            <span className="text-[12.5px] font-semibold text-mc-text">
              {selectedForDeletion.size} selecionada{selectedForDeletion.size === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-2">
              <DsButton variant="ghost" size="sm" onClick={exitSelectionMode}>
                Cancelar
              </DsButton>
              <DsButton
                variant="danger"
                size="sm"
                disabled={selectedForDeletion.size === 0}
                onClick={() => setConfirmAction("selected")}
              >
                <Trash2 size={14} strokeWidth={1.9} />
                Excluir
              </DsButton>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5 border-b border-mc-border px-4 py-3">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setTab("all")} className={statusChipClass(tab === "all")}>
                Todas
              </button>
              <button
                type="button"
                onClick={() => setTab("unread")}
                className={statusChipClass(tab === "unread")}
              >
                {unreadCount > 0 ? `Não lidas (${unreadCount})` : "Não lidas"}
              </button>
            </div>

            <div className="relative" ref={filtersRef}>
              <button
                type="button"
                onClick={() => setFiltersOpen((v) => !v)}
                className={cn(
                  "flex h-10 w-full items-center justify-between rounded-mc-base px-3 text-[13px] font-semibold transition-colors",
                  filtersOpen || filtersActive
                    ? "bg-mc-rail text-white"
                    : "bg-mc-surface-2 text-mc-text hover:bg-mc-border/40",
                )}
                aria-expanded={filtersOpen}
              >
                <span className="inline-flex items-center gap-2">
                  <Filter size={14} strokeWidth={2} />
                  {filtersActive ? "Filtros ativos" : "Filtrar conversas"}
                </span>
                <span className="text-[12px] font-medium opacity-80">
                  {filtersOpen ? "Fechar" : filtersActive ? "Editar" : "Abrir"}
                </span>
              </button>

              {filtersOpen && (
                <div className="absolute left-0 right-0 top-[2.85rem] z-30 rounded-mc-base border border-mc-border bg-mc-surface p-3.5 shadow-lg">
                  <label className="mb-3 block">
                    <span className="text-[12px] font-medium text-mc-muted">Tipo de WhatsApp</span>
                    <select
                      value={transportFilter}
                      onChange={(e) => {
                        setTransportFilter(e.target.value as TransportFilter);
                        setConnectionFilter(null);
                      }}
                      className={selectClassName}
                    >
                      {TRANSPORT_OPTIONS.map(({ key, label }) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {agents.length > 0 && (
                    <label className="mb-3 block">
                      <span className="text-[12px] font-medium text-mc-muted">Agente de IA</span>
                      <select
                        value={agentFilter ?? ""}
                        onChange={(e) => setAgentFilter(e.target.value || null)}
                        className={selectClassName}
                      >
                        <option value="">Todos os agentes</option>
                        {agents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.nome}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {filteredConnections.length > 1 && (
                    <label className="mb-3 block">
                      <span className="text-[12px] font-medium text-mc-muted">Número do WhatsApp</span>
                      <select
                        value={connectionFilter ?? ""}
                        onChange={(e) => setConnectionFilter(e.target.value || null)}
                        className={selectClassName}
                      >
                        <option value="">Todos os números</option>
                        {filteredConnections.map((c) => (
                          <option key={c.connectionId} value={c.connectionId}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label className="mb-3 block">
                    <span className="text-[12px] font-medium text-mc-muted">Quem está atendendo</span>
                    <select
                      value={attendantFilter}
                      onChange={(e) => setAttendantFilter(e.target.value as AttendantFilter)}
                      className={selectClassName}
                    >
                      {ATTENDANT_OPTIONS.map(({ key, label }) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="mb-3 block">
                    <span className="text-[12px] font-medium text-mc-muted">Período</span>
                    <select
                      value={periodFilter}
                      onChange={(e) => setPeriodFilter(e.target.value as PeriodFilter)}
                      className={selectClassName}
                    >
                      {PERIOD_OPTIONS.map(({ key, label }) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {periodFilter === "custom" && (
                    <div className="mb-3 grid grid-cols-2 gap-2">
                      <input
                        type="date"
                        value={customFrom}
                        onChange={(e) => setCustomFrom(e.target.value)}
                        className={selectClassName}
                        aria-label="Data inicial"
                      />
                      <input
                        type="date"
                        value={customTo}
                        onChange={(e) => setCustomTo(e.target.value)}
                        className={selectClassName}
                        aria-label="Data final"
                      />
                    </div>
                  )}

                  <div className="mt-1 flex items-center justify-between gap-2 border-t border-mc-border pt-3">
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="text-[12.5px] font-semibold text-mc-muted transition-colors hover:text-mc-text"
                    >
                      Limpar filtros
                    </button>
                    <DsButton size="sm" onClick={() => setFiltersOpen(false)}>
                      Pronto
                    </DsButton>
                  </div>
                </div>
              )}
            </div>

            {filtersActive && !filtersOpen && (
              <button
                type="button"
                onClick={clearFilters}
                className="w-full text-center text-[12px] font-semibold text-mc-muted underline-offset-2 hover:text-mc-text hover:underline"
              >
                Limpar filtros
              </button>
            )}
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3">
          {loading && (
            <div className="space-y-2 p-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-mc-base bg-mc-surface-2" />
              ))}
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <MessageCircle size={28} strokeWidth={1.5} className="text-mc-muted/50" />
              <p className="text-[13px] text-mc-muted">Nenhuma conversa encontrada.</p>
              {filtersActive || tab !== "all" || search ? (
                <button
                  type="button"
                  onClick={() => {
                    clearFilters();
                    setTab("all");
                    setSearch("");
                  }}
                  className="mt-1 text-[12.5px] font-semibold text-[#F24400] hover:underline"
                >
                  Limpar busca e filtros
                </button>
              ) : null}
            </div>
          )}
          <div className="space-y-1">
            {filtered.map((conv) => (
              <ConvItem
                key={conv.remoteJid}
                conv={conv}
                selected={conv.remoteJid === selectedJid}
                onClick={() => setSelectedJid(conv.remoteJid)}
                selectionMode={selectionMode}
                checked={selectedForDeletion.has(conv.remoteJid)}
                onToggleCheck={() => toggleSelectForDeletion(conv.remoteJid)}
              />
            ))}
          </div>
        </div>
          </>
        )}
      </div>

      {/* ── Chat panel ── */}
      {selectedConv ? (
        <div className="flex min-w-0 flex-1 flex-col bg-mc-surface-2">
          {/* Chat header */}
          <div className="flex items-center justify-between gap-4 border-b border-mc-border bg-mc-surface px-6 py-3.5">
            <div className="flex min-w-0 items-center gap-3">
              {/* Back button (mobile) */}
              <button
                type="button"
                className="mr-1 flex h-8 w-8 items-center justify-center rounded-mc-base text-mc-muted transition hover:bg-mc-surface-2 md:hidden"
                onClick={() => setSelectedJid(null)}
                aria-label="Voltar"
              >
                <ChevronDown size={18} strokeWidth={1.9} className="rotate-90" />
              </button>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[rgba(242,68,0,0.12)] text-[13px] font-bold" style={{ color: "var(--color-brand)" }}>
                {initials(selectedName)}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="truncate text-[15.5px] font-bold tracking-tight text-mc-text">
                    {selectedName}
                  </span>
                  {selectedConv.handoff_suggested && (
                    <span className="shrink-0 rounded-full border border-[#f7ddcf] bg-[#fff4ee] px-2 py-0.5 text-[10.5px] font-semibold text-[#B22A00]">
                      🔥 Lead quente
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-mc-muted">
                  {jidToPhone(selectedConv.remoteJid)} · respondendo agora
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* AI status pill */}
              {aiEnabled && (
                <div className="hidden items-center gap-2 rounded-full border border-[#c9efd6] bg-[#ecfdf3] px-3 py-1.5 sm:flex">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                  <span className="text-[12px] font-semibold text-[#067a3c]">IA atendendo</span>
                </div>
              )}
              <button
                type="button"
                className="hidden h-9 w-9 items-center justify-center rounded-mc-base bg-mc-surface-2 text-mc-muted transition hover:bg-mc-border sm:flex"
                aria-label="Ligar"
              >
                <Phone size={16} strokeWidth={1.9} />
              </button>
              <button
                type="button"
                onClick={() => setShowCrm((v) => !v)}
                className="flex h-9 w-9 items-center justify-center rounded-mc-base bg-mc-surface-2 text-mc-muted transition hover:bg-mc-border xl:hidden"
                aria-label="Painel CRM"
              >
                <User size={16} strokeWidth={1.9} />
              </button>
            </div>
          </div>

          {/* Messages thread */}
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-6">
            {msgLoading && (
              <div className="flex flex-1 items-center justify-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-mc-border border-t-[#F24400]" />
              </div>
            )}
            {!msgLoading && messages.length === 0 && (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-[13px] text-mc-muted">Nenhuma mensagem nesta conversa.</p>
              </div>
            )}
            {!msgLoading &&
              messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)}
            <div ref={messagesEndRef} />
          </div>

          {/* Composer + AI suggestion */}
          <div className="border-t border-mc-border bg-mc-surface px-6 pb-5 pt-3.5">
            {/* Takeover when automation still owns the thread */}
            {!canHumanSend && (
              <div className="mb-3 flex items-start gap-3 rounded-[12px] border border-[#f7ddcf] bg-[#fff7f3] px-4 py-3">
                <span className="mt-0.5 shrink-0 text-base">✨</span>
                <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-[#7c3a1e]">
                  <span className="font-bold text-[#B22A00]">Atendimento automático ativo. </span>
                  Assuma a conversa para enviar mensagens como humano.
                </div>
                <button
                  type="button"
                  onClick={() => void handleTakeover()}
                  disabled={takeoverBusy}
                  className="shrink-0 rounded-mc-base px-3 py-1.5 text-[12px] font-semibold text-white transition disabled:opacity-50"
                  style={{ backgroundColor: "var(--color-brand)" }}
                >
                  {takeoverBusy ? "Assumindo…" : "Assumir"}
                </button>
              </div>
            )}

            {sendError ? (
              <p className="mb-2 text-[12.5px] font-semibold text-error">{sendError}</p>
            ) : null}

            {/* Compose input */}
            <div className="flex items-center gap-3 rounded-[13px] bg-mc-surface-2 px-4 py-2">
              <button type="button" className="shrink-0 text-mc-muted/60 transition hover:text-mc-muted" aria-label="Emoji">
                <Smile size={19} strokeWidth={1.9} />
              </button>
              <button type="button" className="shrink-0 text-mc-muted/60 transition hover:text-mc-muted" aria-label="Anexar">
                <Paperclip size={19} strokeWidth={1.9} />
              </button>
              <textarea
                ref={textareaRef}
                rows={1}
                value={compose}
                onChange={(e) => setCompose(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  canHumanSend
                    ? "Escreva uma mensagem…"
                    : "Assuma o atendimento para escrever…"
                }
                disabled={!canHumanSend}
                className="flex-1 resize-none bg-transparent py-2 text-[13.5px] text-mc-text placeholder:text-mc-muted focus:outline-none disabled:opacity-60"
              />
              <button
                type="button"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-mc-base bg-mc-surface text-mc-muted transition hover:bg-mc-border"
                aria-label="Gravar áudio"
              >
                <Mic size={18} strokeWidth={1.9} />
              </button>
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!canHumanSend || !compose.trim() || sending}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-mc-base text-white transition active:scale-[0.98] disabled:opacity-40"
                style={{ backgroundColor: "var(--color-brand)" }}
                aria-label="Enviar"
              >
                <Send size={16} strokeWidth={1.9} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Empty state */
        <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-mc-surface-2">
          <MessageCircle size={40} strokeWidth={1.2} className="text-mc-muted/40" />
          <p className="text-[14px] text-mc-muted">Selecione uma conversa para começar.</p>
        </div>
      )}

      {/* ── CRM context panel ── */}
      {selectedConv && (showCrm || true) && (
        <div
          className={cn(
            "w-[312px] shrink-0 overflow-y-auto border-l border-mc-border bg-mc-surface",
            "hidden xl:block",
            showCrm && "block xl:block",
          )}
        >
          <div className="p-6">
            {/* Contact header */}
            <div className="border-b border-mc-border pb-6 text-center">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-[rgba(242,68,0,0.1)] text-xl font-bold" style={{ color: "var(--color-brand)" }}>
                {initials(selectedName)}
              </div>
              <p className="text-[17px] font-bold tracking-tight text-mc-text">{selectedName}</p>
              <p className="mt-0.5 text-[13px] text-mc-muted">{jidToPhone(selectedConv.remoteJid)}</p>
              <div className="mt-4 flex justify-center gap-2">
                <button type="button" className="rounded-mc-base bg-mc-surface-2 px-4 py-2 text-[12.5px] font-semibold text-mc-text transition hover:bg-mc-border">
                  <Phone size={12} strokeWidth={1.9} className="mr-1.5 inline" />
                  Ligar
                </button>
                {selectedConv.lead_id ? (
                  <span className="rounded-mc-base bg-emerald-500/10 px-4 py-2 text-[12.5px] font-semibold text-emerald-600">
                    <Check size={12} strokeWidth={2} className="mr-1.5 inline" />
                    Salvo no CRM
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleSaveToCrm()}
                    disabled={savingToCrm}
                    className="rounded-mc-base bg-[#F24400] px-4 py-2 text-[12.5px] font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                  >
                    <User size={12} strokeWidth={1.9} className="mr-1.5 inline" />
                    {savingToCrm ? "Salvando..." : "Salvar no CRM"}
                  </button>
                )}
              </div>
              {saveToCrmError ? (
                <p className="mt-3 text-[11.5px] font-semibold text-error">{saveToCrmError}</p>
              ) : null}
            </div>

            {/* Pipeline stage */}
            <div className="border-b border-mc-border py-5">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.1em] text-mc-muted">
                Etapa no funil
              </p>
              {selectedConv.lead_id ? (
                <div className="rounded-mc-base bg-mc-surface-2 px-3.5 py-3">
                  <p className="text-[14px] font-semibold capitalize text-mc-text">
                    {selectedConv.lead_status ?? "novo"}
                  </p>
                  <p className="mt-1 text-[11.5px] text-mc-muted">
                    Funil: {selectedConv.lead_crm_funnel_id ?? "funil-default"}
                  </p>
                </div>
              ) : (
                <p className="text-[12.5px] leading-relaxed text-mc-muted">
                  Este contato ainda não foi salvo no CRM.
                </p>
              )}
            </div>

            {selectedConv.lead_suggested_next_action ? (
              <div className="border-b border-mc-border py-5">
                <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.1em] text-mc-muted">
                  Próxima ação
                </p>
                <div className="rounded-mc-base bg-mc-surface-2 p-3.5 text-[12.5px] leading-relaxed text-mc-text">
                  {selectedConv.lead_suggested_next_action}
                </div>
              </div>
            ) : null}

            {/* Tags */}
            <div className="border-b border-mc-border py-5">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.1em] text-mc-muted">
                Etiquetas
              </p>
              <div className="flex flex-wrap gap-2">
                {selectedConv.handoff_suggested && (
                  <span className="rounded-full border border-[#f7ddcf] bg-[#fff4ee] px-2.5 py-1 text-[11.5px] font-semibold text-[#B22A00]">
                    🔥 Lead quente
                  </span>
                )}
                <span className="rounded-full border border-[#c9efd6] bg-[#ecfdf3] px-2.5 py-1 text-[11.5px] font-semibold text-[#067a3c]">
                  {selectedConv.conversation_mode === "automation" ? "IA" : "Humano"}
                </span>
              </div>
            </div>

            {/* Notes */}
            <div className="pt-5">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.1em] text-mc-muted">
                Notas internas
              </p>
              <div className="rounded-mc-base border border-mc-border bg-mc-surface p-3.5 text-[12.5px] leading-relaxed text-mc-muted">
                {selectedConv.agent_id
                  ? `Atendido por agente ${selectedConv.agent_id}.`
                  : "Sem notas adicionais para este contato."}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmação — limpar todas / limpar selecionadas */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-mc-base border border-mc-border bg-mc-surface p-6">
            <p className="text-[15px] font-bold text-mc-text">
              {confirmAction === "all"
                ? "Limpar todas as conversas?"
                : `Excluir ${selectedForDeletion.size} conversa${selectedForDeletion.size === 1 ? "" : "s"}?`}
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-mc-muted">
              {confirmAction === "all"
                ? "As conversas somem da sua caixa de entrada. O histórico e os dados do lead continuam guardados, e a conversa volta a aparecer automaticamente se o contato mandar uma nova mensagem."
                : "As conversas selecionadas somem da caixa de entrada. O histórico e os dados do lead continuam guardados, e voltam a aparecer se o contato mandar nova mensagem."}
            </p>
            {actionError && (
              <p className="mt-3 text-[12.5px] font-semibold text-error">{actionError}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <DsButton variant="ghost" size="sm" onClick={() => setConfirmAction(null)} disabled={deleteBusy}>
                Cancelar
              </DsButton>
              <DsButton variant="danger" size="sm" onClick={() => void handleConfirmDelete()} isLoading={deleteBusy}>
                {confirmAction === "all" ? "Limpar tudo" : "Excluir"}
              </DsButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
