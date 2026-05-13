"use client";

import { useEffect, useState } from "react";
import { Bot, Hand, PauseCircle, Sparkles, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ChatbotConversationState,
  ChatbotHistoryMessage,
  ChatbotHistorySummary,
} from "@/lib/server/lead-chatbot-history";

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function messageLabel(message: ChatbotHistoryMessage) {
  if (message.direction === "inbound") return "Cliente";
  if (message.agent_id === "human") return "Humano";
  return message.agent_name ? `Agente IA · ${message.agent_name}` : "Agente IA";
}

function stripMediaPrefix(content: string) {
  return content.replace(/^\[(Imagem|Vídeo|Áudio|Documento)\]\s*/i, "").trim();
}

function ChatMedia({ message }: { message: ChatbotHistoryMessage }) {
  const caption = message.caption?.trim() || stripMediaPrefix(message.content);
  const src = message.media_url;

  if (message.kind === "image" && src) {
    return (
      <div className="space-y-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={caption || "Imagem"}
          className="max-h-56 w-full rounded-lg object-cover"
          loading="lazy"
        />
        {caption ? <p className="text-xs text-content-secondary">{caption}</p> : null}
      </div>
    );
  }

  if (message.kind === "audio" && src) {
    return <audio controls preload="metadata" src={src} className="w-full max-w-sm" />;
  }

  if (message.kind === "video" && src) {
    return (
      <div className="space-y-2">
        <video
          controls
          preload="metadata"
          playsInline
          src={src}
          className="max-h-56 w-full rounded-lg bg-black"
        />
        {caption ? <p className="text-xs text-content-secondary">{caption}</p> : null}
      </div>
    );
  }

  if (message.kind === "document") {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-content-secondary">{message.content}</p>
        {src ? (
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex text-xs font-semibold text-primary hover:underline"
          >
            Abrir arquivo
          </a>
        ) : null}
      </div>
    );
  }

  return null;
}

export function CrmChatbotHistoryPanel({ leadId }: { leadId: string }) {
  const [messages, setMessages] = useState<ChatbotHistoryMessage[]>([]);
  const [summary, setSummary] = useState<ChatbotHistorySummary | null>(null);
  const [state, setState] = useState<ChatbotConversationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/client/crm/leads/${encodeURIComponent(leadId)}/chatbot-history`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as {
          messages?: ChatbotHistoryMessage[];
          summary?: ChatbotHistorySummary | null;
          conversationState?: ChatbotConversationState | null;
          error?: string;
        };
        if (!response.ok) throw new Error(data.error || "Erro ao carregar histórico do chatbot.");
        if (cancelled) return;
        setMessages(Array.isArray(data.messages) ? data.messages : []);
        setSummary(data.summary ?? null);
        setState(data.conversationState ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setMessages([]);
        setSummary(null);
        setState(null);
        setError(err instanceof Error ? err.message : "Erro ao carregar histórico do chatbot.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-content">Histórico do Chatbot</p>
        <p className="mt-1 text-xs leading-relaxed text-content-muted">
          Conversa entre o lead e o agente IA no WhatsApp, com mídias e estado de handoff/pausa humana.
        </p>
      </div>

      {state ? (
        <div className="flex flex-wrap gap-2">
          {state.human_paused ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-200">
              <PauseCircle className="h-3.5 w-3.5" aria-hidden />
              Pausa humana ativa
            </span>
          ) : null}
          {state.handoff_suggested ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
              <Hand className="h-3.5 w-3.5" aria-hidden />
              Handoff sugerido
            </span>
          ) : null}
          {state.paused_reason ? (
            <span className="rounded-full border border-line px-2.5 py-1 text-[11px] text-content-muted">
              Motivo: {state.paused_reason}
            </span>
          ) : null}
        </div>
      ) : null}

      {summary ? (
        <div className="rounded-xl border border-primary/25 bg-primary/[0.06] p-4 ring-1 ring-primary/10">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Sparkles className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-content">Resumo da conversa</p>
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-content-secondary">
                {summary.summary}
              </p>
              <div className="mt-3 grid gap-2 text-xs text-content-muted sm:grid-cols-3">
                <span>
                  Temperatura: <strong className="text-content-secondary">{summary.lead_temperature ?? "—"}</strong>
                </span>
                <span>
                  Intenção: <strong className="text-content-secondary">{summary.customer_intent ?? "—"}</strong>
                </span>
                <span>
                  Próxima ação: <strong className="text-content-secondary">{summary.suggested_next_action ?? "—"}</strong>
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-line/90 bg-surface-deep/25 p-4">
        {loading ? <p className="text-xs text-content-faint">Carregando conversa…</p> : null}
        {error ? (
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {error}
          </p>
        ) : null}
        {!loading && !error && messages.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line/80 bg-surface-card/40 px-4 py-8 text-center text-sm text-content-muted">
            Ainda não há mensagens do chatbot para este lead.
          </p>
        ) : null}
        {messages.length > 0 ? (
          <ul className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
            {messages.map((message) => {
              const outbound = message.direction === "outbound";
              const isHuman = message.agent_id === "human";
              return (
                <li key={message.id} className={cn("flex", outbound ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[88%] rounded-2xl border px-3 py-2 text-sm shadow-sm",
                      outbound
                        ? isHuman
                          ? "border-emerald-500/30 bg-emerald-500/10"
                          : "border-primary/30 bg-primary/12"
                        : "border-line bg-surface-card",
                    )}
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-content-faint">
                      <span className="inline-flex items-center gap-1">
                        {outbound ? (
                          isHuman ? (
                            <UserRound className="h-3 w-3" aria-hidden />
                          ) : (
                            <Bot className="h-3 w-3" aria-hidden />
                          )
                        ) : null}
                        {messageLabel(message)}
                      </span>
                      <span>•</span>
                      <span>{message.channel}</span>
                      <span>•</span>
                      <span>{message.kind}</span>
                      <span>•</span>
                      <span>{formatDateTime(message.created_at)}</span>
                    </div>
                    <ChatMedia message={message} />
                    {message.kind === "text" || (!message.media_url && message.kind !== "document") ? (
                      <p className="whitespace-pre-line leading-relaxed text-content-secondary">
                        {message.content}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
