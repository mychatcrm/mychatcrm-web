"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";
import { PanelButton } from "@/components/panel/ui/PanelButton";
import { PanelInput } from "@/components/panel/ui/PanelInput";
import { cn } from "@/lib/utils";
import { formatClock } from "../meeting-format";

type ChatMessage = { id: string; role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Faça um resumo em 3 linhas",
  "O que ficou pendente?",
  "Quais foram as decisões?",
  "Quem ficou responsável por quê?",
];

/** Transforma "12:04" citado na resposta num botão que leva ao trecho do áudio. */
function renderWithTimestamps(content: string, onSeek: (ms: number) => void) {
  const parts = content.split(/(\b\d{1,2}:\d{2}(?::\d{2})?\b)/g);
  return parts.map((part, index) => {
    const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(part);
    if (!match) return <span key={index}>{part}</span>;

    const [, a, b, c] = match;
    const ms =
      c === undefined
        ? (Number(a) * 60 + Number(b)) * 1000
        : (Number(a) * 3600 + Number(b) * 60 + Number(c)) * 1000;

    return (
      <button
        key={index}
        type="button"
        onClick={() => onSeek(ms)}
        className="font-mono text-primary hover:underline"
      >
        {formatClock(ms)}
      </button>
    );
  });
}

export function TabAskAi({
  meetingId,
  onSeek,
  disabled,
}: {
  meetingId: string;
  onSeek: (ms: number) => void;
  disabled?: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetch(`/api/client/reunioes/${encodeURIComponent(meetingId)}/chat`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (body?.messages) setMessages(body.messages as ChatMessage[]);
      })
      .catch(() => undefined);
  }, [meetingId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const ask = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      setBusy(true);
      setError(null);
      setQuestion("");
      // Otimista: a pergunta aparece na hora, a resposta chega depois.
      setMessages((current) => [
        ...current,
        { id: `local-${Date.now()}`, role: "user", content: trimmed },
      ]);

      try {
        const response = await fetch(`/api/client/reunioes/${encodeURIComponent(meetingId)}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: trimmed }),
        });
        const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok) {
          setError(typeof body.error === "string" ? body.error : "Não foi possível responder.");
          return;
        }
        setMessages((current) => [
          ...current,
          { id: `a-${Date.now()}`, role: "assistant", content: String(body.answer ?? "") },
        ]);
      } catch {
        setError("Não foi possível responder agora.");
      } finally {
        setBusy(false);
      }
    },
    [busy, meetingId],
  );

  if (disabled) {
    return (
      <p className="rounded-panel-2xl border border-line/45 bg-surface-card/60 px-4 py-6 text-center text-sm text-content-muted">
        Disponível quando a transcrição estiver pronta.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {messages.length === 0 ? (
        <div className="rounded-panel-2xl border border-line/45 bg-surface-card/60 p-4 text-center">
          <Sparkles className="mx-auto mb-2 h-5 w-5 text-primary" aria-hidden />
          <p className="text-sm font-medium text-content">Pergunte sobre esta reunião</p>
          <p className="mt-1 text-xs text-content-muted">
            As respostas usam apenas o que foi dito, e citam o momento.
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => void ask(suggestion)}
                className="rounded-xl border border-line/45 px-2.5 py-1 text-[11px] text-content-secondary hover:border-primary/40 hover:text-content"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "rounded-panel-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                message.role === "user"
                  ? "ml-8 bg-primary/[0.08] text-content"
                  : "mr-8 border border-line/45 bg-surface-card/60 text-content-secondary",
              )}
            >
              {message.role === "assistant"
                ? renderWithTimestamps(message.content, onSeek)
                : message.content}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

      {error ? (
        <p className="rounded-panel-xl border border-error/30 bg-error/[0.06] px-3 py-2 text-xs text-content">
          {error}
        </p>
      ) : null}

      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
      >
        <PanelInput
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="O que você quer saber?"
          aria-label="Pergunta sobre a reunião"
          disabled={busy}
        />
        <PanelButton type="submit" size="sm" disabled={busy || !question.trim()}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Send className="h-4 w-4" aria-hidden />
          )}
        </PanelButton>
      </form>
    </div>
  );
}
