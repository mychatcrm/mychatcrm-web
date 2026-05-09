"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Loader2, Search, Send } from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import { Badge } from "@/components/ui/Badge";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { ProfileAvatar } from "@/components/dashboard/ProfileAvatar";
import type { ClientSession } from "@/lib/client-auth";
import { getPlanMonthlyConversationCapForSession, normalizeClientPlan } from "@/lib/plan-limits";
import { formatIntegerPtBr } from "@/lib/format-number";
import { cn } from "@/lib/utils";
import { phoneToWhatsAppWebHref, WhatsAppGlyph } from "@/components/dashboard/crm/crm-phone";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WaMessage = {
  id: string;
  direction: "inbound" | "outbound";
  kind: "text" | "audio" | "image" | "document";
  content: string;
  media_url: string | null;
  agent_id: string | null;
  created_at: string;
};

type WaConversation = {
  remoteJid: string;
  lastContent: string;
  lastKind: string;
  lastDirection: string;
  lastAt: string;
  unreadCount: number;
  messages: WaMessage[];
  messagesLoaded: boolean;
};

// ---------------------------------------------------------------------------
// Supabase browser client (singleton)
// ---------------------------------------------------------------------------

let _supa: ReturnType<typeof createClient> | null = null;
function getSupaBrowser() {
  if (!_supa) {
    _supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return _supa;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiLoadConversations(): Promise<WaConversation[]> {
  const res = await fetch("/api/client/conversas", { cache: "no-store" });
  if (!res.ok) throw new Error(`GET /api/client/conversas ${res.status}`);
  const data = (await res.json()) as { conversations: Omit<WaConversation, "messages" | "messagesLoaded">[] };
  return (data.conversations ?? []).map((c) => ({ ...c, messages: [], messagesLoaded: false }));
}

async function apiLoadMessages(remoteJid: string): Promise<WaMessage[]> {
  const enc = encodeURIComponent(remoteJid);
  const res = await fetch(`/api/client/conversas/${enc}/messages`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET messages ${res.status}`);
  const data = (await res.json()) as { messages: WaMessage[] };
  return data.messages ?? [];
}

async function apiSendMessage(remoteJid: string, text: string): Promise<WaMessage | null> {
  const res = await fetch("/api/client/conversas/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remoteJid, text }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Erro ${res.status} ao enviar`);
  }
  const data = (await res.json()) as { message?: WaMessage };
  return data.message ?? null;
}

// ---------------------------------------------------------------------------
// Helpers de formatação
// ---------------------------------------------------------------------------

function jidToPhone(jid: string): string {
  return "+" + (jid.split("@")[0] ?? jid).replace(/\D/g, "");
}

function formatShortTime(iso: string) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  } catch {
    return "";
  }
}

function previewFromConv(conv: WaConversation): string {
  if (conv.lastKind === "audio") return "🎵 Áudio";
  if (conv.lastKind === "image") return "🖼️ Imagem";
  return conv.lastContent.slice(0, 80);
}

function MessageBubble({ msg, isLight }: { msg: WaMessage; isLight: boolean }) {
  const out = msg.direction === "outbound";
  return (
    <div className={cn("flex w-full", out ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[min(100%,28rem)] rounded-xl px-3 py-2 text-sm",
          out
            ? isLight
              ? "rounded-br-md bg-[#d9fdd3] text-[#111b21]"
              : "rounded-br-md bg-emerald-900/55 text-emerald-50"
            : "rounded-bl-md border border-line/60 bg-surface-card text-content",
        )}
      >
        {msg.kind === "audio" ? (
          <p className="flex items-center gap-1.5 text-sm opacity-80">
            <span>🎵</span>
            <span>Áudio</span>
          </p>
        ) : msg.kind === "image" ? (
          <p className="flex items-center gap-1.5 text-sm opacity-80">
            <span>🖼️</span>
            <span>{msg.content.replace("[Imagem]", "").trim() || "Imagem"}</span>
          </p>
        ) : (
          <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
        )}
        <p className={cn("mt-1 text-[10px] opacity-60", out ? "text-right" : "text-left")}>
          {formatShortTime(msg.created_at)}
          {out && msg.agent_id && msg.agent_id !== "human" && (
            <span className="ml-1 opacity-70">· IA</span>
          )}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function OperacaoConversasHub({ session }: { session: ClientSession }) {
  const { isLight } = usePanelAppearance();
  const tenantId = session.tenantId;

  const [conversations, setConversations] = useState<WaConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJid, setSelectedJid] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);

  const threadEndRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------------------
  // Carga inicial
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiLoadConversations()
      .then((convs) => {
        if (!cancelled) {
          setConversations(convs);
          setLoading(false);
        }
      })
      .catch((e) => {
        console.warn("[conversas] load error", e);
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [tenantId]);

  // ---------------------------------------------------------------------------
  // Supabase Realtime — INSERT em whatsapp_messages
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const supa = getSupaBrowser();
    const channel = supa
      .channel(`wamsg-${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "whatsapp_messages",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          const row = payload.new as WaMessage & { remote_jid: string; tenant_id: string };
          const msg: WaMessage = {
            id: row.id,
            direction: row.direction,
            kind: row.kind,
            content: row.content,
            media_url: row.media_url,
            agent_id: row.agent_id,
            created_at: row.created_at,
          };
          const jid: string = row.remote_jid;

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
                        unreadCount: msg.direction === "inbound" && jid !== selectedJid
                          ? c.unreadCount + 1
                          : c.unreadCount,
                        messages: c.messagesLoaded ? [...c.messages, msg] : c.messages,
                      },
                )
                .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
            }
            // Nova conversa — adiciona no topo
            const newConv: WaConversation = {
              remoteJid: jid,
              lastContent: msg.content,
              lastKind: msg.kind,
              lastDirection: msg.direction,
              lastAt: msg.created_at,
              unreadCount: msg.direction === "inbound" ? 1 : 0,
              messages: [msg],
              messagesLoaded: true,
            };
            return [newConv, ...prev];
          });
        },
      )
      .subscribe();

    return () => {
      supa.removeChannel(channel);
    };
  }, [tenantId, selectedJid]);

  // ---------------------------------------------------------------------------
  // Carrega mensagens ao seleccionar conversa
  // ---------------------------------------------------------------------------

  const handleSelect = useCallback(
    async (jid: string) => {
      setSelectedJid(jid);
      setSendError("");
      setDraft("");

      // Zera unread
      setConversations((prev) =>
        prev.map((c) => (c.remoteJid === jid ? { ...c, unreadCount: 0 } : c)),
      );

      // Carrega mensagens se ainda não carregadas
      const conv = conversations.find((c) => c.remoteJid === jid);
      if (conv?.messagesLoaded) return;

      try {
        const msgs = await apiLoadMessages(jid);
        setConversations((prev) =>
          prev.map((c) =>
            c.remoteJid === jid ? { ...c, messages: msgs, messagesLoaded: true } : c,
          ),
        );
      } catch (e) {
        console.warn("[conversas] load messages error", e);
      }
    },
    [conversations],
  );

  // Scroll ao fim quando thread muda
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedJid, conversations]);

  // ---------------------------------------------------------------------------
  // Enviar mensagem
  // ---------------------------------------------------------------------------

  const handleSend = useCallback(async () => {
    if (!selectedJid || !draft.trim() || sending) return;
    setSendError("");
    const text = draft.trim();
    setDraft("");
    setSending(true);

    // Optimistic: adiciona a mensagem localmente de imediato
    const tempMsg: WaMessage = {
      id: `temp-${Date.now()}`,
      direction: "outbound",
      kind: "text",
      content: text,
      media_url: null,
      agent_id: "human",
      created_at: new Date().toISOString(),
    };
    setConversations((prev) =>
      prev.map((c) =>
        c.remoteJid !== selectedJid
          ? c
          : { ...c, messages: [...c.messages, tempMsg], lastContent: text, lastAt: tempMsg.created_at },
      ),
    );

    try {
      const saved = await apiSendMessage(selectedJid, text);
      // Substitui mensagem temporária pela salva (com ID real)
      if (saved) {
        setConversations((prev) =>
          prev.map((c) =>
            c.remoteJid !== selectedJid
              ? c
              : { ...c, messages: c.messages.map((m) => (m.id === tempMsg.id ? saved : m)) },
          ),
        );
      }
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Erro ao enviar mensagem.");
      // Remove mensagem optimista em caso de erro
      setConversations((prev) =>
        prev.map((c) =>
          c.remoteJid !== selectedJid
            ? c
            : { ...c, messages: c.messages.filter((m) => m.id !== tempMsg.id) },
        ),
      );
    } finally {
      setSending(false);
    }
  }, [selectedJid, draft, sending]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.remoteJid.toLowerCase().includes(q) ||
        jidToPhone(c.remoteJid).includes(q) ||
        c.lastContent.toLowerCase().includes(q),
    );
  }, [conversations, query]);

  const active = useMemo(
    () => conversations.find((c) => c.remoteJid === selectedJid) ?? null,
    [conversations, selectedJid],
  );

  const planNorm = useMemo(() => normalizeClientPlan(session.plan), [session.plan]);
  const conversationCap = useMemo(() => getPlanMonthlyConversationCapForSession(session), [session]);

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-content sm:text-2xl">Conversas em tempo real</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-content-muted">
            Todas as conversas WhatsApp do tenant, sincronizadas via Supabase Realtime. Mensagens recebidas e enviadas pelo
            agente IA aparecem automaticamente. Pode responder manualmente por aqui.
          </p>
        </div>
        <Badge className="w-fit border-line/60 bg-surface-elevated/50 text-[11px] font-medium text-content-secondary">
          Supabase Realtime · ao vivo
        </Badge>
      </div>

      {planNorm !== "enterprise" ? (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-deep/30 px-4 py-3 text-sm text-content-secondary sm:flex-row sm:items-center sm:justify-between">
          <p>
            Limite de referência do plano: até{" "}
            <strong className="text-content">{formatIntegerPtBr(conversationCap)}</strong>{" "}
            <strong className="text-content">novas conversas</strong> de clientes por mês.{" "}
            Neste painel: <strong className="text-content">{formatIntegerPtBr(conversations.length)}</strong> conversas.
          </p>
          <Link
            href="/planos"
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl border border-primary/40 bg-primary/10 px-4 text-sm font-semibold text-primary transition hover:bg-primary/15"
          >
            Aumentar volume
          </Link>
        </div>
      ) : null}

      <div
        className={cn(
          "flex min-h-0 w-full flex-1 overflow-hidden rounded-xl border border-line bg-surface-card",
          "h-[min(780px,calc(100dvh-12.5rem))] max-h-[calc(100dvh-12.5rem)]",
        )}
      >
        {/* Lista de conversas */}
        <div
          className={cn(
            "flex min-h-0 w-full min-w-0 flex-col border-line bg-surface-sidebar/30 md:w-[min(100%,320px)] md:max-w-[360px] md:border-r",
            selectedJid ? "hidden md:flex" : "flex",
          )}
        >
          <div className="shrink-0 border-b border-line/80 p-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-faint" strokeWidth={1.75} aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar conversas…"
                className="h-10 w-full rounded-xl border border-line/80 bg-surface-elevated/40 pl-9 pr-3 text-sm text-content outline-none ring-primary/20 placeholder:text-content-faint focus:border-primary/40 focus:ring-2"
                aria-label="Buscar conversas"
              />
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-content-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
                <p className="text-sm text-content-muted">
                  {conversations.length === 0
                    ? "Nenhuma conversa ainda. As mensagens WhatsApp aparecerão aqui automaticamente."
                    : "Nenhuma conversa corresponde à busca."}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-line/60">
                {filtered.map((c) => {
                  const selected = c.remoteJid === selectedJid;
                  const phone = jidToPhone(c.remoteJid);
                  return (
                    <li key={c.remoteJid}>
                      <button
                        type="button"
                        onClick={() => handleSelect(c.remoteJid)}
                        className={cn(
                          "flex w-full gap-3 px-3 py-3 text-left transition hover:bg-surface-elevated/35",
                          selected && "bg-surface-elevated/50",
                        )}
                      >
                        <ProfileAvatar
                          avatar={{ kind: "initials", initials: phone.slice(-4) }}
                          size={44}
                          className="ring-1 ring-line/40"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <span className="truncate font-medium text-content">{phone}</span>
                            <span className="shrink-0 text-[11px] text-content-faint">{formatShortTime(c.lastAt)}</span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5">
                            {c.unreadCount > 0 && (
                              <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">
                                {c.unreadCount > 99 ? "99+" : c.unreadCount}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 line-clamp-2 text-[13px] text-content-muted">
                            {previewFromConv(c)}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Thread da conversa */}
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col bg-surface-base/40",
            !selectedJid ? "hidden md:flex" : "flex",
          )}
        >
          {!active ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-content-muted">
              <p>Selecione uma conversa na lista.</p>
            </div>
          ) : (
            <>
              <header className="flex shrink-0 items-center gap-3 border-b border-line/80 bg-surface-card/80 px-3 py-2.5 backdrop-blur-sm">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="md:hidden"
                  onClick={() => setSelectedJid(null)}
                  aria-label="Voltar"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <ProfileAvatar
                  avatar={{ kind: "initials", initials: jidToPhone(active.remoteJid).slice(-4) }}
                  size={40}
                  className="ring-1 ring-line/40"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate font-semibold text-content">{jidToPhone(active.remoteJid)}</h3>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-content-muted">
                    <span className="truncate font-mono text-[11px]">{active.remoteJid}</span>
                    <a
                      href={phoneToWhatsAppWebHref(jidToPhone(active.remoteJid))}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <WhatsAppGlyph className="h-3.5 w-3.5" />
                      WhatsApp Web
                    </a>
                  </div>
                </div>
              </header>

              <div className="relative min-h-0 flex-1 overflow-y-auto px-2 py-4 sm:px-4">
                <div className="relative z-[1] mx-auto flex max-w-3xl flex-col gap-2">
                  {!active.messagesLoaded ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-sm text-content-muted">
                      <Loader2 className="h-4 w-4 animate-spin" /> Carregando mensagens…
                    </div>
                  ) : active.messages.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-line/70 bg-surface-card/60 px-4 py-10 text-center text-sm text-content-muted">
                      Sem mensagens nesta conversa ainda.
                    </div>
                  ) : (
                    active.messages.map((m) => (
                      <MessageBubble key={m.id} msg={m} isLight={isLight} />
                    ))
                  )}
                  <div ref={threadEndRef} />
                </div>
              </div>

              <footer className="shrink-0 border-t border-line/80 bg-surface-card/90 px-2 py-2 backdrop-blur-sm sm:px-3">
                {sendError && (
                  <div className="mb-2 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>{sendError}</span>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value.slice(0, 4000))}
                    rows={2}
                    placeholder="Digite uma mensagem…"
                    className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-line bg-surface-elevated/40 px-3 py-2.5 text-sm text-content outline-none ring-primary/15 placeholder:text-content-faint focus:border-primary/35 focus:ring-2"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                    aria-label="Mensagem"
                    disabled={sending}
                  />
                  <Button
                    type="button"
                    className="h-11 w-11 shrink-0 rounded-full bg-primary text-white hover:brightness-110"
                    disabled={sending || !draft.trim()}
                    onClick={() => void handleSend()}
                    aria-label="Enviar"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="mt-1 text-[10px] text-content-faint">{draft.length}/4000</p>
              </footer>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
