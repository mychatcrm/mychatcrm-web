"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MessageSquare,
  RefreshCw,
  Trash2,
  QrCode,
  Cloud,
  Search,
  Check,
  Clock,
  AlertCircle,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  subscribeToWhatsappMessages,
  type WhatsappMessageRealtimeRow,
} from "@/lib/conversas/whatsapp-messages-realtime";
import { AudioBubble, ImageBubble, VideoBubble } from "@/components/chat/media/ChatMediaBubbles";

type Channel = "evolution" | "meta_cloud" | null;
type ChannelFilter = "all" | "evolution" | "meta_cloud";

type Conversation = {
  remoteJid: string;
  lastContent: string;
  lastKind: string;
  lastDirection: string;
  lastAt: string;
  count: number;
  channel: Channel;
};

type ChatMessage = {
  id: string;
  direction: "inbound" | "outbound";
  kind: "text" | "audio" | "image" | "video" | "document";
  content: string;
  media_url: string | null;
  agent_id: string | null;
  created_at: string;
  delivery_status?: string | null;
  channel?: Channel;
};

const CHANNEL_TABS: { key: ChannelFilter; label: string; Icon: typeof QrCode }[] = [
  { key: "all", label: "Todas", Icon: MessageSquare },
  { key: "evolution", label: "QR Code", Icon: QrCode },
  { key: "meta_cloud", label: "API Oficial", Icon: Cloud },
];

const AVATAR_TONES = [
  "bg-primary/15 text-primary",
  "bg-sky-500/15 text-sky-400",
  "bg-emerald-500/15 text-emerald-400",
  "bg-violet-500/15 text-violet-400",
  "bg-amber-500/15 text-amber-400",
  "bg-pink-500/15 text-pink-400",
];

function avatarTone(jid: string): string {
  let hash = 0;
  for (let i = 0; i < jid.length; i++) hash = (hash * 31 + jid.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

/**
 * Foto de perfil real do WhatsApp (só disponível via Evolution/QR — a API
 * Oficial Meta não expõe foto de contatos). Sem foto, cai num ícone
 * genérico sobre o mesmo círculo colorido usado como fallback.
 */
function ContactAvatar({ jid, className }: { jid: string; className: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        className,
        avatarTone(jid),
      )}
    >
      {failed ? (
        <User className="h-1/2 w-1/2" aria-hidden />
      ) : (
        <img
          src={`/api/admin/system-agent/conversations/${encodeURIComponent(jid)}/photo`}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

function channelBadge(channel: Channel): { label: string; Icon: typeof QrCode; tone: string } | null {
  if (channel === "meta_cloud") return { label: "API Meta", Icon: Cloud, tone: "text-sky-400" };
  if (channel === "evolution") return { label: "QR Code", Icon: QrCode, tone: "text-emerald-400" };
  return null;
}

function deliveryStatusIcon(status: string | null | undefined): { Icon: typeof Check; className: string } | null {
  if (status === "sent") return { Icon: Check, className: "opacity-80" };
  if (status === "pending") return { Icon: Clock, className: "opacity-70" };
  if (status === "failed") return { Icon: AlertCircle, className: "text-amber-200" };
  return null;
}

function formatJid(jid: string): string {
  const digits = jid.split("@")[0]?.replace(/\D/g, "");
  return digits ? `+${digits}` : jid;
}

function formatListTimestamp(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function kindPreview(kind: string, content: string): string {
  if (kind === "audio") return "🎵 Áudio";
  if (kind === "image") return "📷 Imagem";
  if (kind === "video") return "🎬 Vídeo";
  if (kind === "document") return "📄 Documento";
  return content || "—";
}

function normalizeKind(kind: string): ChatMessage["kind"] {
  return kind === "audio" || kind === "image" || kind === "video" || kind === "document" ? kind : "text";
}

export function LiveConversationsPanel({ systemTenantId }: { systemTenantId: string }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeJid, setActiveJid] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [deletingJid, setDeletingJid] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [search, setSearch] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const activeJidRef = useRef<string | null>(null);
  activeJidRef.current = activeJid;
  const channelFilterRef = useRef<ChannelFilter>("all");
  channelFilterRef.current = channelFilter;

  const loadConversations = useCallback(async (filter: ChannelFilter) => {
    const qs = filter === "all" ? "" : `?channel=${filter}`;
    const res = await fetch(`/api/admin/system-agent/conversations${qs}`, { credentials: "same-origin" });
    const json = (await res.json().catch(() => ({}))) as { conversations?: Conversation[] };
    setConversations(json.conversations ?? []);
    setLoadingList(false);
  }, []);

  const loadMessages = useCallback(async (jid: string, filter: ChannelFilter) => {
    setLoadingThread(true);
    const qs = filter === "all" ? "" : `?channel=${filter}`;
    const res = await fetch(
      `/api/admin/system-agent/conversations/${encodeURIComponent(jid)}/messages${qs}`,
      { credentials: "same-origin" },
    );
    const json = (await res.json().catch(() => ({}))) as { messages?: ChatMessage[] };
    setMessages(
      (json.messages ?? []).map((m) => ({ ...m, kind: normalizeKind(m.kind), direction: m.direction === "outbound" ? "outbound" : "inbound" })),
    );
    setLoadingThread(false);
  }, []);

  const deleteConversation = useCallback(async (jid: string) => {
    if (!window.confirm(`Apagar todas as mensagens de ${formatJid(jid)}?`)) return;
    setDeletingJid(jid);
    await fetch(`/api/admin/system-agent/conversations?jid=${encodeURIComponent(jid)}`, {
      method: "DELETE",
      credentials: "same-origin",
    }).catch(() => null);
    setDeletingJid(null);
    if (activeJidRef.current === jid) {
      setActiveJid(null);
      setMessages([]);
    }
    void loadConversations(channelFilterRef.current);
  }, [loadConversations]);

  const deleteAll = useCallback(async () => {
    if (!window.confirm("Apagar TODAS as conversas do agente do sistema? Esta ação não pode ser desfeita.")) return;
    setDeletingAll(true);
    await fetch("/api/admin/system-agent/conversations?all=true", {
      method: "DELETE",
      credentials: "same-origin",
    }).catch(() => null);
    setDeletingAll(false);
    setActiveJid(null);
    setMessages([]);
    void loadConversations(channelFilterRef.current);
  }, [loadConversations]);

  // Trocar de aba deseleciona a conversa aberta — evita mostrar uma thread
  // "vazia" quando a conversa ativa não tem mensagens no canal escolhido.
  const changeChannelFilter = useCallback((next: ChannelFilter) => {
    setChannelFilter(next);
    setActiveJid(null);
    setMessages([]);
  }, []);

  useEffect(() => {
    setLoadingList(true);
    void loadConversations(channelFilter);
  }, [loadConversations, channelFilter]);

  useEffect(() => {
    if (activeJid) void loadMessages(activeJid, channelFilter);
  }, [activeJid, channelFilter, loadMessages]);

  // Auto-scroll para o fim quando novas mensagens chegam.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Realtime: novas mensagens do tenant do sistema. Sem mudar a assinatura do
  // hook compartilhado (também usado em /dashboard/conversas) — o filtro por
  // canal é aplicado aqui, no cliente, sobre as linhas que já chegam.
  useEffect(() => {
    const unsub = subscribeToWhatsappMessages({
      tenantId: systemTenantId,
      onInsert: (row: WhatsappMessageRealtimeRow) => {
        void loadConversations(channelFilterRef.current);
        const rowChannel = (row as WhatsappMessageRealtimeRow & { channel?: Channel }).channel ?? null;
        if (channelFilterRef.current !== "all" && rowChannel !== channelFilterRef.current) return;
        if (row.remote_jid === activeJidRef.current) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            return [
              ...prev,
              {
                id: row.id,
                direction: row.direction === "outbound" ? "outbound" : "inbound",
                kind: normalizeKind(row.kind),
                content: row.content ?? "",
                media_url: row.media_url ?? null,
                agent_id: row.agent_id ?? null,
                created_at: row.created_at,
                delivery_status: row.delivery_status ?? null,
                channel: rowChannel,
              },
            ];
          });
        }
      },
      onUpdate: (row: WhatsappMessageRealtimeRow) => {
        if (row.remote_jid !== activeJidRef.current) return;
        setMessages((prev) =>
          prev.map((m) => (m.id === row.id ? { ...m, delivery_status: row.delivery_status ?? m.delivery_status } : m)),
        );
      },
      pollMs: 15_000,
      onPoll: () => {
        void loadConversations(channelFilterRef.current);
        if (activeJidRef.current) void loadMessages(activeJidRef.current, channelFilterRef.current);
      },
    });
    return unsub;
  }, [systemTenantId, loadConversations, loadMessages]);

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) => formatJid(c.remoteJid).toLowerCase().includes(q) || c.lastContent.toLowerCase().includes(q),
    );
  }, [conversations, search]);

  const activeConversation = activeJid ? conversations.find((c) => c.remoteJid === activeJid) ?? null : null;
  const activeBadge = channelBadge(activeConversation?.channel ?? null);

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface-card">
      <div className="flex items-center justify-between gap-3 border-b border-line/60 px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MessageSquare className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-content">Conversas ao vivo</h2>
            <p className="text-[11px] text-content-muted">Agente do sistema · 2 números em tempo real</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {conversations.length > 0 && (
            <button
              type="button"
              title="Apagar todas as conversas"
              onClick={() => void deleteAll()}
              disabled={deletingAll}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-content-muted transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            title="Atualizar"
            onClick={() => {
              void loadConversations(channelFilter);
              if (activeJid) void loadMessages(activeJid, channelFilter);
            }}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-content-muted transition-colors hover:bg-surface-elevated/60 hover:text-primary"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {/* 3 abas: Todas / QR Code / API Oficial. */}
        <div className="mb-3 inline-flex w-full items-center gap-1 rounded-full border border-line/50 bg-surface-elevated/30 p-1">
          {CHANNEL_TABS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => changeChannelFilter(key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-all duration-150",
                channelFilter === key
                  ? "bg-primary text-white shadow-sm"
                  : "text-content-muted hover:bg-surface-elevated/60 hover:text-content-secondary",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por número ou mensagem…"
            className="w-full rounded-lg border border-line/60 bg-surface-elevated/20 py-2 pl-9 pr-3 text-xs text-content placeholder:text-content-faint transition-colors focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
          />
        </div>

        <div className="grid gap-3 lg:h-[560px] lg:grid-cols-[300px_1fr]">
          {/* Lista de conversas */}
          <div className="flex flex-col overflow-hidden rounded-lg border border-line/50 lg:h-full">
            <div className="flex-1 overflow-y-auto">
              {loadingList ? (
                <div className="space-y-1 p-2">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex animate-pulse items-center gap-2.5 px-2 py-2.5">
                      <div className="h-9 w-9 shrink-0 rounded-full bg-surface-elevated/60" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-2.5 w-24 rounded bg-surface-elevated/60" />
                        <div className="h-2 w-32 rounded bg-surface-elevated/40" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                  <MessageSquare className="h-6 w-6 text-content-faint" aria-hidden />
                  <p className="text-xs text-content-muted">
                    {search ? "Nenhuma conversa encontrada." : "Nenhuma conversa ainda."}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-line/40">
                  {filteredConversations.map((c) => {
                    const badge = channelBadge(c.channel);
                    const isActive = activeJid === c.remoteJid;
                    return (
                      <li key={c.remoteJid} className="group relative">
                        <button
                          type="button"
                          onClick={() => setActiveJid(c.remoteJid)}
                          className={cn(
                            "flex w-full items-center gap-2.5 py-2.5 pl-3 pr-9 text-left transition-colors",
                            isActive ? "bg-primary/[0.07]" : "hover:bg-surface-elevated/40",
                          )}
                        >
                          {isActive && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" aria-hidden />}
                          <ContactAvatar jid={c.remoteJid} className="h-9 w-9" />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className="truncate font-mono text-[12.5px] font-medium text-content">
                                {formatJid(c.remoteJid)}
                              </span>
                              <span className="shrink-0 text-[10px] text-content-faint">
                                {formatListTimestamp(c.lastAt)}
                              </span>
                            </span>
                            <span className="mt-0.5 flex items-center gap-1">
                              {badge && <badge.Icon className={cn("h-2.5 w-2.5 shrink-0", badge.tone)} aria-hidden />}
                              <span className="truncate text-[11px] text-content-muted">
                                {c.lastDirection === "outbound" ? "Você: " : ""}
                                {kindPreview(c.lastKind, c.lastContent)}
                              </span>
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          title="Apagar conversa"
                          disabled={deletingJid === c.remoteJid}
                          onClick={(e) => { e.stopPropagation(); void deleteConversation(c.remoteJid); }}
                          className={cn(
                            "absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-content-muted transition-opacity hover:text-red-500",
                            "opacity-0 group-hover:opacity-100 focus:opacity-100",
                            deletingJid === c.remoteJid ? "opacity-100" : "",
                          )}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* Thread */}
          <div className="flex flex-col overflow-hidden rounded-lg border border-line/50 bg-surface-elevated/10 lg:h-full">
            {activeJid && (
              <div className="flex items-center justify-between gap-2 border-b border-line/50 bg-surface-card px-3.5 py-2.5">
                <div className="flex items-center gap-2.5">
                  <ContactAvatar jid={activeJid} className="h-8 w-8" />
                  <div>
                    <p className="font-mono text-[12.5px] font-medium text-content">{formatJid(activeJid)}</p>
                    {activeBadge && (
                      <span className={cn("flex items-center gap-1 text-[10px]", activeBadge.tone)}>
                        <activeBadge.Icon className="h-2.5 w-2.5" aria-hidden />
                        {activeBadge.label}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  title="Apagar conversa"
                  disabled={deletingJid === activeJid}
                  onClick={() => void deleteConversation(activeJid)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-content-muted transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            <div ref={threadRef} className="flex flex-1 flex-col gap-2 overflow-y-auto p-3.5">
              {!activeJid ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                  <MessageSquare className="h-7 w-7 text-content-faint" aria-hidden />
                  <p className="text-xs text-content-muted">Selecione uma conversa para acompanhar.</p>
                </div>
              ) : loadingThread ? (
                <div className="flex flex-1 flex-col justify-end gap-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className={cn("flex animate-pulse", i % 2 === 0 ? "justify-start" : "justify-end")}>
                      <div className="h-9 w-40 rounded-2xl bg-surface-elevated/50" />
                    </div>
                  ))}
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                  <MessageSquare className="h-7 w-7 text-content-faint" aria-hidden />
                  <p className="text-xs text-content-muted">Sem mensagens nesta conversa.</p>
                </div>
              ) : (
                messages.map((m) => {
                  const out = m.direction === "outbound";
                  const statusIcon = out ? deliveryStatusIcon(m.delivery_status) : null;
                  return (
                    <div key={m.id} className={cn("flex w-full", out ? "justify-end" : "justify-start")}>
                      <div
                        className={cn(
                          "max-w-[75%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed shadow-sm",
                          out
                            ? "rounded-br-md bg-primary text-white"
                            : "rounded-bl-md border border-line/70 bg-surface-card text-content",
                        )}
                      >
                        {m.kind === "audio" && m.media_url ? (
                          <AudioBubble src={m.media_url} msgId={m.id} />
                        ) : m.kind === "image" && m.media_url ? (
                          <ImageBubble src={m.media_url} caption={m.content} />
                        ) : m.kind === "video" && m.media_url ? (
                          <VideoBubble src={m.media_url} caption={m.content} />
                        ) : (
                          <p className="whitespace-pre-wrap break-words">{m.content || "—"}</p>
                        )}
                        <div
                          className={cn(
                            "mt-1 flex items-center justify-end gap-1 text-[10px]",
                            out ? "text-white/70" : "text-content-faint",
                          )}
                        >
                          {new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                          {statusIcon && <statusIcon.Icon className={cn("h-3 w-3", statusIcon.className)} aria-hidden />}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
