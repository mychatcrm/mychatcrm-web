"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type LabMessage = {
  direction: "tester" | "agent";
  kind: string;
  content: string | null;
  provider_message_id: string | null;
  provider_occurred_at: string | null;
  received_at: string;
};

const field = "w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-orange-500";
const button = "rounded-xl border border-white/15 px-4 py-2 text-sm hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";

/**
 * The real conversation, as the laboratory can prove it. Tester messages appear only
 * after the provider confirmed them; agent messages only after the webhook stored
 * them. Nothing here is drawn optimistically, because an unconfirmed send is exactly
 * the case this panel exists to make visible.
 */
export function AgentTestLabConversation({ runId, status, onSent }: {
  runId: string; status: string; onSent: () => void;
}) {
  const [messages, setMessages] = useState<LabMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const open = !["completed", "failed", "cancelled"].includes(status);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/admin/agent-tests/runs/${runId}/messages`, { cache: "no-store", credentials: "same-origin", signal });
    if (!response.ok) return;
    const body = await response.json();
    setMessages(Array.isArray(body.messages) ? body.messages : []);
  }, [runId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(() => {});
    // The turn happens on the server; the page only follows it.
    const timer = open ? setInterval(() => void load().catch(() => {}), 5000) : null;
    return () => { controller.abort(); if (timer) clearInterval(timer); };
  }, [load, open]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [messages.length]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/admin/agent-tests/runs/${runId}/messages`, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        // A retry of the same click must not become a second message to a real number.
        body: JSON.stringify({ text: value, idempotencyKey: `lab-msg:${runId}:${crypto.randomUUID()}` }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(String(body.code ?? "message_rejected")); return; }
      setText("");
      await load();
      onSent();
    } catch { setError("network_failed"); }
    finally { setBusy(false); }
  }

  return <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">Conversa pelo WhatsApp testador</h3>
      <span className="text-xs text-white/45">{messages.length} mensagem(ns) comprovada(s)</span>
    </div>
    <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl bg-black/20 p-3">
      {messages.length === 0
        ? <p className="text-sm text-white/45">Nada enviado ainda. O que aparecer aqui foi confirmado pelo provedor ou recebido pelo webhook.</p>
        : messages.map((message, index) => <div key={message.provider_message_id ?? index}
            className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${message.direction === "tester" ? "ml-auto bg-orange-600/25" : "bg-white/10"}`}>
            <span className="block text-[11px] uppercase tracking-wide text-white/40">
              {message.direction === "tester" ? "Testador" : "Agente"} · {message.kind}
            </span>
            <span className="whitespace-pre-wrap break-words">{message.content ?? "(sem texto)"}</span>
            <span className="mt-1 block text-[11px] text-white/35">
              {new Date(message.provider_occurred_at ?? message.received_at).toLocaleTimeString()}
            </span>
          </div>)}
      <div ref={endRef} />
    </div>
    {open
      ? <form className="mt-3 flex flex-wrap gap-2" onSubmit={send}>
          <input className={`${field} flex-1`} value={text} maxLength={4000} disabled={busy}
            onChange={event => setText(event.target.value)}
            placeholder="Escreva como se fosse o lead e envie pelo número testador" aria-label="Mensagem do testador" />
          <button className={button} disabled={busy || !text.trim()}>{busy ? "Enviando…" : "Enviar"}</button>
        </form>
      : <p className="mt-3 text-sm text-white/50">Execução encerrada. O histórico continua disponível como evidência.</p>}
    {error && <p role="alert" className="mt-2 text-sm text-amber-400">Recusado: {error}</p>}
  </section>;
}
