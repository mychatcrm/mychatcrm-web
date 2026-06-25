"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Calendar,
  Check,
  CheckCheck,
  ChevronDown,
  MessageCircle,
  Mic,
  Paperclip,
  Phone,
  Play,
  Search,
  Send,
  Smile,
  Tag,
  User,
  X,
} from "lucide-react";
import type { ClientSession } from "@/lib/client-auth";
import { cn } from "@/lib/utils";

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

// ---------------------------------------------------------------------------
// API helpers (local — same endpoints as OperacaoConversasHub)
// ---------------------------------------------------------------------------

async function apiLoadConversations(): Promise<WaConversation[]> {
  const res = await fetch("/api/client/conversas", { cache: "no-store" });
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ConvItem({
  conv,
  selected,
  onClick,
}: {
  conv: WaConversation;
  selected: boolean;
  onClick: () => void;
}) {
  const name = convDisplayName(conv);
  const mode = conv.conversation_mode ?? "automation";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 rounded-mc-base px-3 py-3 text-left transition-colors",
        selected
          ? "bg-[rgba(242,68,0,0.08)] border border-[rgba(242,68,0,0.2)]"
          : "border border-transparent hover:bg-mc-surface-2",
      )}
    >
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
            {MODE_LABEL[mode]}
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load conversations
  useEffect(() => {
    setLoading(true);
    apiLoadConversations()
      .then((list) => {
        setConversations(list);
        if (list.length > 0 && !selectedJid) {
          setSelectedJid(list[0]!.remoteJid);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const filtered = conversations.filter((c) => {
    const name = convDisplayName(c).toLowerCase();
    const matchSearch = !search || name.includes(search.toLowerCase()) || c.lastContent.toLowerCase().includes(search.toLowerCase());
    const matchTab =
      tab === "all" ||
      (tab === "ia" && c.conversation_mode === "automation") ||
      (tab === "unread" && c.unreadCount > 0);
    return matchSearch && matchTab;
  });

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
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-mc-base text-white transition-colors active:scale-[0.98]"
              style={{ backgroundColor: "var(--color-brand)" }}
              aria-label="Nova conversa"
            >
              <span className="text-xl font-light leading-none">+</span>
            </button>
          </div>
          {/* Search */}
          <div className="flex items-center gap-2.5 rounded-mc-base bg-mc-surface-2 px-4 py-2.5">
            <Search size={14} strokeWidth={1.9} className="shrink-0 text-mc-muted" />
            <input
              type="search"
              placeholder="Buscar contato ou mensagem…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent text-[13.5px] text-mc-text placeholder:text-mc-muted focus:outline-none"
            />
          </div>
        </div>

        {/* Filter tabs */}
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
                <button type="button" className="rounded-mc-base bg-mc-surface-2 px-4 py-2 text-[12.5px] font-semibold text-mc-text transition hover:bg-mc-border">
                  <User size={12} strokeWidth={1.9} className="mr-1.5 inline" />
                  Perfil
                </button>
              </div>
            </div>

            {/* Pipeline stage */}
            <div className="border-b border-mc-border py-5">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.1em] text-mc-muted">
                Etapa no funil
              </p>
              <div className="mb-3 flex items-center gap-1.5">
                {["Captado", "Qualificado", "Agendado", "Fechado"].map((step, i) => (
                  <div
                    key={step}
                    className={cn(
                      "h-1.5 flex-1 rounded-full",
                      i <= 2 ? "" : "bg-mc-border",
                    )}
                    style={i <= 2 ? { backgroundColor: i === 2 ? "var(--color-brand)" : "#00A650" } : {}}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-semibold text-mc-text">Agendado</span>
                <button
                  type="button"
                  className="text-[12px] font-semibold transition"
                  style={{ color: "var(--color-brand)" }}
                >
                  Mover →
                </button>
              </div>
            </div>

            {/* Next event */}
            <div className="border-b border-mc-border py-5">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.1em] text-mc-muted">
                Próximo evento
              </p>
              <div className="flex items-center gap-3 rounded-mc-base bg-mc-surface-2 p-3.5">
                <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-[10px] bg-mc-surface leading-none">
                  <span className="text-[9px] font-bold uppercase" style={{ color: "var(--color-brand)" }}>QUI</span>
                  <span className="mt-0.5 text-[17px] font-extrabold text-mc-text">18</span>
                </div>
                <div>
                  <p className="text-[13.5px] font-semibold text-mc-text">Avaliação gratuita</p>
                  <p className="text-[11.5px] text-mc-muted">
                    <Calendar size={10} strokeWidth={1.9} className="mr-1 inline" />
                    10:00 · Próxima semana
                  </p>
                </div>
              </div>
            </div>

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
                <button
                  type="button"
                  className="rounded-full bg-mc-surface-2 px-2.5 py-1 text-[11.5px] font-semibold text-mc-muted transition hover:bg-mc-border"
                >
                  <Tag size={10} strokeWidth={1.9} className="mr-1 inline" />
                  Adicionar
                </button>
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
    </div>
  );
}
