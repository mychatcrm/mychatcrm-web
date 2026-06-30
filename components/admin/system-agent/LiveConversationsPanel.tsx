"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, RefreshCw, Bot, User, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  subscribeToWhatsappMessages,
  type WhatsappMessageRealtimeRow,
} from "@/lib/conversas/whatsapp-messages-realtime";
import { AudioBubble, ImageBubble, VideoBubble } from "@/components/chat/media/ChatMediaBubbles";

type Conversation = {
  remoteJid: string;
  lastContent: string;
  lastKind: string;
  lastDirection: string;
  lastAt: string;
  count: number;
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
};

function formatJid(jid: string): string {
  const digits = jid.split("@")[0]?.replace(/\D/g, "");
  return digits ? `+${digits}` : jid;
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
  const threadRef = useRef<HTMLDivElement>(null);
  const activeJidRef = useRef<string | null>(null);
  activeJidRef.current = activeJid;

  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/admin/system-agent/conversations", { credentials: "same-origin" });
    const json = (await res.json().catch(() => ({}))) as { conversations?: Conversation[] };
    setConversations(json.conversations ?? []);
    setLoadingList(false);
  }, []);

  const loadMessages = useCallback(async (jid: string) => {
    setLoadingThread(true);
    const res = await fetch(
      `/api/admin/system-agent/conversations/${encodeURIComponent(jid)}/messages`,
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
    void loadConversations();
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
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (activeJid) void loadMessages(activeJid);
  }, [activeJid, loadMessages]);

  // Auto-scroll para o fim quando novas mensagens chegam.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Realtime: novas mensagens do tenant do sistema.
  useEffect(() => {
    const unsub = subscribeToWhatsappMessages({
      tenantId: systemTenantId,
      onInsert: (row: WhatsappMessageRealtimeRow) => {
        void loadConversations();
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
        void loadConversations();
        if (activeJidRef.current) void loadMessages(activeJidRef.current);
      },
    });
    return unsub;
  }, [systemTenantId, loadConversations, loadMessages]);

  return (
    <section className="rounded-xl border border-line bg-surface-card p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-content-secondary">
            Conversas ao vivo
          </h2>
        </div>
        <div className="flex items-center gap-3">
          {conversations.length > 0 && (
            <button
              type="button"
              onClick={() => void deleteAll()}
              disabled={deletingAll}
              className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:underline disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deletingAll ? "Apagando…" : "Apagar todas"}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              void loadConversations();
              if (activeJid) void loadMessages(activeJid);
            }}
            className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Atualizar
          </button>
        </div>
      </div>
      <p className="mb-4 text-xs text-content-muted">
        Monitoramento (somente leitura) das conversas que o agente do sistema atende automaticamente —
        texto, áudio e imagem.
      </p>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Lista de conversas */}
        <div className="max-h-[460px] overflow-y-auto rounded-lg border border-line/60">
          {loadingList ? (
            <p className="p-4 text-xs text-content-muted">Carregando…</p>
          ) : conversations.length === 0 ? (
            <p className="p-4 text-xs text-content-muted">Nenhuma conversa ainda.</p>
          ) : (
            <ul className="divide-y divide-line/40">
              {conversations.map((c) => (
                <li key={c.remoteJid} className="group relative">
                  <button
                    type="button"
                    onClick={() => setActiveJid(c.remoteJid)}
                    className={cn(
                      "flex w-full flex-col items-start gap-0.5 py-2.5 pl-3 pr-9 text-left transition-colors hover:bg-surface-elevated/40",
                      activeJid === c.remoteJid ? "bg-primary/5" : "",
                    )}
                  >
                    <span className="font-mono text-xs font-medium text-content-secondary">
                      {formatJid(c.remoteJid)}
                    </span>
                    <span className="line-clamp-1 text-[11px] text-content-muted">
                      {c.lastDirection === "outbound" ? "→ " : "← "}
                      {kindPreview(c.lastKind, c.lastContent)}
                    </span>
                    <span className="text-[10px] text-content-faint">
                      {new Date(c.lastAt).toLocaleString("pt-BR")}
                    </span>
                  </button>
                  {/* Botão de lixeira — aparece ao hover */}
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
              ))}
            </ul>
          )}
        </div>

        {/* Thread */}
        <div
          ref={threadRef}
          className="flex max-h-[460px] min-h-[260px] flex-col gap-2 overflow-y-auto rounded-lg border border-line/60 bg-surface-elevated/20 p-3"
        >
          {!activeJid ? (
            <div className="flex flex-1 items-center justify-center text-xs text-content-muted">
              Selecione uma conversa para acompanhar.
            </div>
          ) : loadingThread ? (
            <p className="text-xs text-content-muted">Carregando mensagens…</p>
          ) : messages.length === 0 ? (
            <p className="text-xs text-content-muted">Sem mensagens nesta conversa.</p>
          ) : (
            messages.map((m) => {
              const out = m.direction === "outbound";
              return (
                <div
                  key={m.id}
                  className={cn("flex w-full", out ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[78%] rounded-2xl px-3 py-2 text-sm",
                      out
                        ? "rounded-br-sm bg-primary text-white"
                        : "rounded-bl-sm border border-line bg-surface-card text-content",
                    )}
                  >
                    <div className="mb-0.5 flex items-center gap-1 text-[10px] opacity-70">
                      {out ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
                      {out ? "Agente" : "Cliente"}
                    </div>
                    {m.kind === "audio" && m.media_url ? (
                      <AudioBubble src={m.media_url} msgId={m.id} />
                    ) : m.kind === "image" && m.media_url ? (
                      <ImageBubble src={m.media_url} caption={m.content} />
                    ) : m.kind === "video" && m.media_url ? (
                      <VideoBubble src={m.media_url} caption={m.content} />
                    ) : (
                      <p className="whitespace-pre-wrap break-words">{m.content || "—"}</p>
                    )}
                    <div className={cn("mt-1 text-[10px]", out ? "text-white/70" : "text-content-faint")}>
                      {new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
