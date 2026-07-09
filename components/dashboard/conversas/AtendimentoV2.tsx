"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bot,
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
  send_status?: "sending" | "sent" | "failed" | null;
};

type InboxTab = "all" | "ia" | "unread";

type AttendantFilter = "all" | "automation" | "human" | "waiting_human";
type PeriodFilter = "all" | "today" | "7d" | "30d" | "custom";

type ConnectionOption = {
  connectionId: string;
  transport: "evolution" | "cloud_api";
  label: string;
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
  { key: "automation", label: "IA" },
  { key: "human", label: "Humano" },
  { key: "waiting_human", label: "Aguardando humano" },
];

const PERIOD_OPTIONS: { key: PeriodFilter; label: string }[] = [
  { key: "all", label: "Todo período" },
  { key: "today", label: "Hoje" },
  { key: "7d", label: "Últimos 7 dias" },
  { key: "30d", label: "Últimos 30 dias" },
  { key: "custom", label: "Personalizado" },
];

function periodStart(period: PeriodFilter, customFrom: string): Date | null {
  const now = new Date();
  if (period === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "7d") return new Date(now.getTime() - 7 * 86_400_000);
  if (period === "30d") return new Date(now.getTime() - 30 * 86_400_000);
  if (period === "custom" && customFrom) return new Date(`${customFrom}T00:00:00`);
  return null;
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

async function apiLoadConversations(connectionId?: string | null): Promise<WaConversation[]> {
  const qs = connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : "";
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

async function apiLoadConnections(): Promise<ConnectionOption[]> {
  const res = await fetch("/api/client/whatsapp/connections", { cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json()) as { connections: ConnectionOption[] };
  return data.connections ?? [];
}

async function apiLoadMessages(
  remoteJid: string,
): Promise<{ messages: WaMessage[]; aiEnabled: boolean }> {
  const enc = encodeURIComponent(remoteJid);
  const res = await fetch(`/api/client/conversas/${enc}/messages`, { cache: "no-store" });
  if (!res.ok) return { messages: [], aiEnabled: true };
  const data = (await res.json()) as {
    messages: WaMessage[];
    automation?: { enabled?: boolean };
  };
  return {
    messages: data.messages ?? [],
    aiEnabled: data.automation?.enabled !== false,
  };
}

async function apiSendMessage(remoteJid: string, text: string): Promise<boolean> {
  const enc = encodeURIComponent(remoteJid);
  const res = await fetch(`/api/client/conversas/${enc}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return res.ok;
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

function ConvItem({
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
      {/* Checkbox (apenas em modo seleção) */}
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
      {/* Avatar with mode dot */}
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

      {/* Content */}
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
        {conv.conversation_mode && (
          <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-mc-muted">
            <span className={cn("h-1.5 w-1.5 rounded-full", MODE_DOT[mode])} />
            {mode === "human" && conv.assigned_human_name ? conv.assigned_human_name : MODE_LABEL[mode]}
          </span>
        )}
      </div>
    </button>
  );
}

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
  const [conversations, setConversations] = useState<WaConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJid, setSelectedJid] = useState<string | null>(null);
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<InboxTab>("all");
  const [compose, setCompose] = useState("");
  const [sending, setSending] = useState(false);
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

  // Filtros avançados (período + atendente + número)
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [attendantFilter, setAttendantFilter] = useState<AttendantFilter>("all");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [connections, setConnections] = useState<ConnectionOption[]>([]);
  const [connectionFilter, setConnectionFilter] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);

  useClickOutside(headerMenuRef, headerMenuOpen, () => setHeaderMenuOpen(false));
  useClickOutside(filtersRef, filtersOpen, () => setFiltersOpen(false));

  // Load available WhatsApp lines (QR Code + API Meta) para o filtro "Número"
  useEffect(() => {
    apiLoadConnections()
      .then(setConnections)
      .catch(() => {});
  }, []);

  // Load conversations (recarrega quando o filtro de número muda)
  useEffect(() => {
    setLoading(true);
    apiLoadConversations(connectionFilter)
      .then((list) => {
        setConversations(list);
        setSelectedJid((prev) => (prev && list.some((c) => c.remoteJid === prev) ? prev : list[0]?.remoteJid ?? null));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionFilter]);

  // Load messages when selection changes
  useEffect(() => {
    if (!selectedJid) return;
    setMsgLoading(true);
    apiLoadMessages(selectedJid)
      .then(({ messages: msgs, aiEnabled: ai }) => {
        setMessages(msgs);
        setAiEnabled(ai);
      })
      .catch(() => {})
      .finally(() => setMsgLoading(false));
  }, [selectedJid]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const selectedConv = conversations.find((c) => c.remoteJid === selectedJid) ?? null;
  const selectedName = selectedConv ? convDisplayName(selectedConv) : "";

  const iaCount = conversations.filter((c) => c.conversation_mode === "automation").length;
  const unreadCount = conversations.filter((c) => c.unreadCount > 0).length;
  const filtersActive = attendantFilter !== "all" || periodFilter !== "all" || connectionFilter !== null;

  const filtered = conversations.filter((c) => {
    const name = convDisplayName(c).toLowerCase();
    const matchSearch = !search || name.includes(search.toLowerCase()) || c.lastContent.toLowerCase().includes(search.toLowerCase());
    const matchTab =
      tab === "all" ||
      (tab === "ia" && c.conversation_mode === "automation") ||
      (tab === "unread" && c.unreadCount > 0);
    const matchAttendant =
      attendantFilter === "all" || (c.conversation_mode ?? "automation") === attendantFilter;

    let matchPeriod = true;
    if (periodFilter !== "all") {
      const convDate = new Date(c.lastAt);
      const start = periodStart(periodFilter, customFrom);
      if (start && convDate < start) matchPeriod = false;
      if (periodFilter === "custom" && customTo) {
        const end = new Date(`${customTo}T23:59:59`);
        if (convDate > end) matchPeriod = false;
      }
    }

    return matchSearch && matchTab && matchAttendant && matchPeriod;
  });

  const clearFilters = () => {
    setAttendantFilter("all");
    setPeriodFilter("all");
    setCustomFrom("");
    setCustomTo("");
    setConnectionFilter(null);
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

  const handleSend = async () => {
    if (!selectedJid || !compose.trim() || sending) return;
    const text = compose.trim();
    setCompose("");
    setSending(true);
    const ok = await apiSendMessage(selectedJid, text);
    if (ok) {
      const { messages: msgs } = await apiLoadMessages(selectedJid);
      setMessages(msgs);
    }
    setSending(false);
  };

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
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* Search + filtros */}
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2.5 rounded-mc-base bg-mc-surface-2 px-4 py-2.5">
              <Search size={14} strokeWidth={1.9} className="shrink-0 text-mc-muted" />
              <input
                type="search"
                placeholder="Buscar contato ou mensagem…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-transparent text-[13.5px] text-mc-text placeholder:text-mc-muted focus:outline-none"
              />
            </div>
            <div className="relative shrink-0" ref={filtersRef}>
              <button
                type="button"
                onClick={() => setFiltersOpen((v) => !v)}
                className={cn(
                  "relative flex h-[38px] w-[38px] items-center justify-center rounded-mc-base transition-colors",
                  filtersActive || filtersOpen
                    ? "bg-mc-rail text-white"
                    : "bg-mc-surface-2 text-mc-muted hover:text-mc-text",
                )}
                aria-label="Filtros"
                aria-expanded={filtersOpen}
              >
                <Filter size={15} strokeWidth={1.9} />
                {filtersActive && (
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#F24400] ring-2 ring-mc-surface" />
                )}
              </button>
              {filtersOpen && (
                <div className="absolute right-0 top-11 z-20 w-72 rounded-mc-base border border-mc-border bg-mc-surface p-4">
                  {connections.length > 1 && (
                    <>
                      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-mc-muted">
                        Número
                      </p>
                      <div className="mb-4 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => setConnectionFilter(null)}
                          className={cn(
                            "rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors",
                            connectionFilter === null
                              ? "bg-mc-rail text-white"
                              : "bg-mc-surface-2 text-mc-muted hover:text-mc-text",
                          )}
                        >
                          Todos os números
                        </button>
                        {connections.map((c) => (
                          <button
                            key={c.connectionId}
                            type="button"
                            onClick={() => setConnectionFilter(c.connectionId)}
                            className={cn(
                              "rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors",
                              connectionFilter === c.connectionId
                                ? "bg-mc-rail text-white"
                                : "bg-mc-surface-2 text-mc-muted hover:text-mc-text",
                            )}
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-mc-muted">
                    Atendente
                  </p>
                  <div className="mb-4 flex flex-wrap gap-1.5">
                    {ATTENDANT_OPTIONS.map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setAttendantFilter(key)}
                        className={cn(
                          "rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors",
                          attendantFilter === key
                            ? "bg-mc-rail text-white"
                            : "bg-mc-surface-2 text-mc-muted hover:text-mc-text",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-mc-muted">
                    Período
                  </p>
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {PERIOD_OPTIONS.map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setPeriodFilter(key)}
                        className={cn(
                          "rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors",
                          periodFilter === key
                            ? "bg-mc-rail text-white"
                            : "bg-mc-surface-2 text-mc-muted hover:text-mc-text",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {periodFilter === "custom" && (
                    <div className="mb-1 mt-3 flex items-center gap-2">
                      <input
                        type="date"
                        value={customFrom}
                        onChange={(e) => setCustomFrom(e.target.value)}
                        className="w-full rounded-mc-base border border-mc-border bg-mc-surface px-2.5 py-1.5 text-[12px] text-mc-text focus:outline-none"
                      />
                      <span className="shrink-0 text-[11px] text-mc-muted">até</span>
                      <input
                        type="date"
                        value={customTo}
                        onChange={(e) => setCustomTo(e.target.value)}
                        className="w-full rounded-mc-base border border-mc-border bg-mc-surface px-2.5 py-1.5 text-[12px] text-mc-text focus:outline-none"
                      />
                    </div>
                  )}
                  <div className="mt-4 flex items-center justify-between border-t border-mc-border pt-3">
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="text-[12px] font-semibold text-mc-muted transition-colors hover:text-mc-text"
                    >
                      Limpar filtros
                    </button>
                    <DsButton size="sm" onClick={() => setFiltersOpen(false)}>
                      Aplicar
                    </DsButton>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Filter tabs / barra de seleção */}
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
          <div className="flex gap-2 border-b border-mc-border px-5 py-3">
            {([
              { key: "all", label: "Todas" },
              { key: "ia", label: `IA · ${iaCount}` },
              { key: "unread", label: `Não lidas · ${unreadCount}` },
            ] as { key: InboxTab; label: string }[]).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors",
                  tab === key
                    ? "bg-mc-rail text-white"
                    : "bg-mc-surface-2 text-mc-muted hover:text-mc-text",
                )}
              >
                {label}
              </button>
            ))}
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
            {/* AI suggestion bar */}
            {aiEnabled && selectedConv.handoff_suggested && (
              <div className="mb-3 flex items-start gap-3 rounded-[12px] border border-[#f7ddcf] bg-[#fff7f3] px-4 py-3">
                <span className="mt-0.5 shrink-0 text-base">✨</span>
                <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-[#7c3a1e]">
                  <span className="font-bold text-[#B22A00]">Sugestão da IA: </span>
                  Deseja transferir este lead para um atendente humano?
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-mc-base px-3 py-1.5 text-[12px] font-semibold text-mc-muted transition hover:bg-mc-surface-2"
                >
                  Ignorar
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded-mc-base px-3 py-1.5 text-[12px] font-semibold text-white transition"
                  style={{ backgroundColor: "var(--color-brand)" }}
                >
                  Assumir
                </button>
              </div>
            )}

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
                placeholder="Escreva uma mensagem ou deixe a IA responder…"
                className="flex-1 resize-none bg-transparent py-2 text-[13.5px] text-mc-text placeholder:text-mc-muted focus:outline-none"
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
                disabled={!compose.trim() || sending}
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
