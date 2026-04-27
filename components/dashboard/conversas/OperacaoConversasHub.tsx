"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { AlertCircle, ArrowLeft, Loader2, Paperclip, Search, Send } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { ProfileAvatar } from "@/components/dashboard/ProfileAvatar";
import type { ClientSession } from "@/lib/client-auth";
import { formatIntegerPtBr } from "@/lib/format-number";
import { getPlanMonthlyConversationCapForSession, normalizeClientPlan } from "@/lib/plan-limits";
import type { ClientLead } from "@/lib/dashboard-data";
import { CRM_LEADS_UPDATED_EVENT } from "@/lib/crm-leads-storage";
import {
  OPERACAO_INBOX_UPDATED_EVENT,
  appendOperacaoOutboundFile,
  appendOperacaoOutboundText,
  attendantTagLabel,
  buildOperacaoInboxView,
  markOperacaoConversationRead,
  readFilePayloadForOperacaoChat,
  refreshOperacaoInboxView,
  validateOperacaoAttachment,
  type OperacaoConversation,
} from "@/lib/operacao-inbox";
import { cn } from "@/lib/utils";
import { phoneToWhatsAppWebHref, WhatsAppGlyph } from "@/components/dashboard/crm/crm-phone";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";

function contactInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
  return (parts[0]?.slice(0, 2) || "??").toUpperCase();
}

function formatShortTime(iso: string) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    if (sameDay) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  } catch {
    return "";
  }
}

function AttendantTag({ conv }: { conv: OperacaoConversation }) {
  const human = conv.attendant.mode === "humano";
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-md border px-1.5 py-0.5 text-[10px] font-semibold leading-tight",
        human
          ? "border-indigo-500/35 bg-indigo-500/10 text-indigo-200"
          : "border-primary/30 bg-primary/10 text-primary",
      )}
      title={attendantTagLabel(conv.attendant)}
    >
      {attendantTagLabel(conv.attendant)}
    </span>
  );
}

export function OperacaoConversasHub({ session, leads }: { session: ClientSession; leads: ClientLead[] }) {
  const { isLight } = usePanelAppearance();
  const tenantId = session.tenantId;
  const fallbackLeads = useMemo(() => leads.map((l) => ({ ...l })), [leads]);
  const [inbox, setInbox] = useState(() =>
    buildOperacaoInboxView(tenantId, fallbackLeads, { ignorePersisted: true }),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [attachError, setAttachError] = useState("");
  const [sendError, setSendError] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const listEndRef = useRef<HTMLDivElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const didInitialPickRef = useRef(false);

  const bump = useCallback(() => {
    setInbox(refreshOperacaoInboxView(tenantId, fallbackLeads));
  }, [tenantId, fallbackLeads]);

  useLayoutEffect(() => {
    bump();
  }, [bump]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const on = () => bump();
    window.addEventListener(OPERACAO_INBOX_UPDATED_EVENT, on);
    window.addEventListener(CRM_LEADS_UPDATED_EVENT, on);
    window.addEventListener("storage", on);
    const t = window.setInterval(on, 5000);
    const onVis = () => {
      if (document.visibilityState === "visible") bump();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener(OPERACAO_INBOX_UPDATED_EVENT, on);
      window.removeEventListener(CRM_LEADS_UPDATED_EVENT, on);
      window.removeEventListener("storage", on);
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [bump]);

  const handleSelectConversation = useCallback(
    (id: string) => {
      setSelectedId(id);
      markOperacaoConversationRead(tenantId, fallbackLeads, id);
      bump();
    },
    [tenantId, fallbackLeads, bump],
  );

  useEffect(() => {
    if (inbox.conversations.length === 0) {
      didInitialPickRef.current = false;
    }
    if (!selectedId && inbox.conversations[0] && !didInitialPickRef.current) {
      didInitialPickRef.current = true;
      handleSelectConversation(inbox.conversations[0].id);
      return;
    }
    if (selectedId && !inbox.conversations.some((c) => c.id === selectedId)) {
      const next = inbox.conversations[0]?.id;
      if (next) handleSelectConversation(next);
      else setSelectedId(null);
    }
  }, [inbox.conversations, selectedId, handleSelectConversation]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedId, inbox]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return inbox.conversations;
    return inbox.conversations.filter(
      (c) =>
        c.contactName.toLowerCase().includes(q) ||
        c.phoneLabel.toLowerCase().includes(q) ||
        c.lastPreview.toLowerCase().includes(q),
    );
  }, [inbox.conversations, query]);

  const active = useMemo(
    () => inbox.conversations.find((c) => c.id === selectedId) ?? null,
    [inbox.conversations, selectedId],
  );

  const planNorm = useMemo(() => normalizeClientPlan(session.plan), [session.plan]);
  const conversationCap = useMemo(() => getPlanMonthlyConversationCapForSession(session), [session]);
  const conversationCount = inbox.conversations.length;

  const sendText = useCallback(() => {
    if (!active) return;
    setSendError("");
    const res = appendOperacaoOutboundText(tenantId, fallbackLeads, active.id, draft);
    if (!res.ok) {
      setSendError(res.error);
      return;
    }
    setDraft("");
    bump();
  }, [active, draft, tenantId, fallbackLeads, bump]);

  const onPickFile = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file || !active) return;
      setAttachError("");
      const v = validateOperacaoAttachment(file);
      if (!v.ok) {
        setAttachError(v.error);
        return;
      }
      setUploading(true);
      try {
        const payload = await readFilePayloadForOperacaoChat(file);
        const res = appendOperacaoOutboundFile(tenantId, fallbackLeads, active.id, payload);
        if (!res.ok) setAttachError(res.error);
        bump();
      } catch {
        setAttachError("Não foi possível ler o arquivo. Tente novamente.");
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [active, tenantId, fallbackLeads, bump],
  );

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-content sm:text-2xl">Conversas em tempo real</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-content-muted">
            Visão operacional das conversas ligadas ao CRM Kanban deste painel. As mensagens e anexos ficam neste navegador
            até existir integração com o WhatsApp Cloud API no backend — o painel atualiza quando o CRM Kanban ou outra aba
            alteram dados (evento + armazenamento local + sondagem leve).
          </p>
        </div>
        <Badge className="w-fit border-line/60 bg-surface-elevated/50 text-[11px] font-medium text-content-secondary">
          Demo local · sem WebSocket dedicado
        </Badge>
      </div>

      {planNorm !== "enterprise" ? (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-deep/30 px-4 py-3 text-sm text-content-secondary sm:flex-row sm:items-center sm:justify-between">
          <p>
            Limite de referência do plano: até <strong className="text-content">{formatIntegerPtBr(conversationCap)}</strong>{" "}
            <strong className="text-content">novas conversas</strong> de clientes por mês (contatos / threads distintos — não
            conta cada mensagem ao mesmo cliente). Nesta demo:{" "}
            <strong className="text-content">{formatIntegerPtBr(conversationCount)}</strong> conversas na caixa.
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
        {/* Lista */}
        <div
          className={cn(
            "flex min-h-0 w-full min-w-0 flex-col border-line bg-surface-sidebar/30 md:w-[min(100%,320px)] md:max-w-[360px] md:border-r",
            selectedId ? "hidden md:flex" : "flex",
          )}
        >
          <div className="shrink-0 border-b border-line/80 p-3">
            <label className="relative block">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-faint"
                strokeWidth={1.75}
                aria-hidden
              />
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
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
                <p className="text-sm text-content-muted">
                  {inbox.conversations.length === 0
                    ? "Não há leads no CRM Kanban para mostrar como conversas."
                    : "Nenhuma conversa corresponde à busca."}
                </p>
                {inbox.conversations.length === 0 ? (
                  <Link
                    href="/dashboard/crm"
                    className="inline-flex min-h-[44px] items-center rounded-xl border border-primary/30 bg-primary/[0.08] px-4 text-sm font-medium text-primary hover:bg-primary/[0.14]"
                  >
                    Abrir CRM Kanban
                  </Link>
                ) : null}
              </div>
            ) : (
              <ul className="divide-y divide-line/60">
                {filtered.map((c) => {
                  const selected = c.id === selectedId;
                  const avatar = { kind: "initials" as const, initials: contactInitials(c.contactName) };
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => handleSelectConversation(c.id)}
                        className={cn(
                          "flex w-full gap-3 px-3 py-3 text-left transition hover:bg-surface-elevated/35",
                          selected && "bg-surface-elevated/50",
                        )}
                      >
                        <ProfileAvatar avatar={avatar} size={44} className="ring-1 ring-line/40" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <span className="truncate font-medium text-content">{c.contactName}</span>
                            <span className="shrink-0 text-[11px] text-content-faint">{formatShortTime(c.lastAt)}</span>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            <AttendantTag conv={c} />
                            {c.unread > 0 ? (
                              <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">
                                {c.unread > 99 ? "99+" : c.unread}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 line-clamp-2 text-[13px] text-content-muted">{c.lastPreview}</p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div ref={listEndRef} />
          </div>
        </div>

        {/* Thread */}
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col bg-surface-base/40",
            !selectedId ? "hidden md:flex" : "flex",
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
                  onClick={() => setSelectedId(null)}
                  aria-label="Voltar à lista de conversas"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <ProfileAvatar
                  avatar={{ kind: "initials", initials: contactInitials(active.contactName) }}
                  size={40}
                  className="ring-1 ring-line/40"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate font-semibold text-content">{active.contactName}</h3>
                    <AttendantTag conv={active} />
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-content-muted">
                    <span className="truncate">{active.phoneLabel}</span>
                    <a
                      href={phoneToWhatsAppWebHref(active.phoneLabel)}
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

              <div className="relative min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(ellipse_at_20%_0%,rgba(242,68,0,0.06),transparent_50%),radial-gradient(ellipse_at_80%_100%,rgba(14,29,47,0.10),transparent_45%)] px-2 py-4 sm:px-4">
                <div
                  className={cn("pointer-events-none absolute inset-0", isLight ? "opacity-[0.4]" : "opacity-[0.25]")}
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='0.07'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                  }}
                  aria-hidden
                />
                <div className="relative z-[1] mx-auto flex max-w-3xl flex-col gap-2">
                  {active.messages.map((m) => {
                    const out = m.direction === "out";
                    return (
                      <div key={m.id} className={cn("flex w-full", out ? "justify-end" : "justify-start")}>
                        <div
                          className={cn(
                            "max-w-[min(100%,28rem)] rounded-xl px-3 py-2 text-sm",
                            out
                              ? (isLight ? "rounded-br-md bg-[#d9fdd3] text-[#111b21]" : "rounded-br-md bg-emerald-900/55 text-emerald-50")
                              : "rounded-bl-md border border-line/60 bg-surface-card text-content",
                          )}
                        >
                          {m.kind === "text" ? (
                            <p className="whitespace-pre-wrap break-words leading-relaxed">{m.text}</p>
                          ) : (
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-content-muted">
                                {m.file?.name ?? "Arquivo"}
                                {m.file?.size != null
                                  ? ` · ${formatIntegerPtBr(Math.max(0, Math.round(m.file.size / 1024)))} KB`
                                  : null}
                              </p>
                              {m.file?.previewDataUrl ? (
                                <div className="relative h-44 w-full max-w-xs overflow-hidden rounded-lg border border-line/50">
                                  <Image
                                    src={m.file.previewDataUrl}
                                    alt={m.file.name ?? "Pré-visualização"}
                                    fill
                                    className="object-cover"
                                    unoptimized
                                  />
                                </div>
                              ) : (
                                <div className="rounded-lg border border-dashed border-line/60 bg-surface-elevated/30 px-3 py-6 text-center text-xs text-content-muted">
                                  Pré-visualização indisponível (arquivo guardado só com metadados nesta demo).
                                </div>
                              )}
                            </div>
                          )}
                          <p className={cn("mt-1 text-[10px] opacity-70", out ? "text-right" : "text-left")}>
                            {formatShortTime(m.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={threadEndRef} />
                </div>
              </div>

              <footer className="shrink-0 border-t border-line/80 bg-surface-card/90 px-2 py-2 backdrop-blur-sm sm:px-3">
                {(sendError || attachError) && (
                  <div className="mb-2 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>{sendError || attachError}</span>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.xlsx,.pptx,.xml,.md,.markdown,.adoc,.html,.htm,.csv,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.txt"
                    onChange={(e) => onPickFile(e.target.files)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-11 w-11 shrink-0 rounded-full"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                    aria-label="Anexar arquivo"
                    title="Anexar arquivo"
                  >
                    {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
                  </Button>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value.slice(0, 4000))}
                    rows={2}
                    placeholder="Digite uma mensagem…"
                    className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-line bg-surface-elevated/40 px-3 py-2.5 text-sm text-content outline-none ring-primary/15 placeholder:text-content-faint focus:border-primary/35 focus:ring-2"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendText();
                      }
                    }}
                    aria-label="Mensagem"
                    disabled={uploading}
                  />
                  <Button
                    type="button"
                    className="h-11 w-11 shrink-0 rounded-full bg-primary text-white hover:brightness-110"
                    disabled={uploading || !draft.trim()}
                    onClick={sendText}
                    aria-label="Enviar"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
                <p className="mt-1 text-[10px] text-content-faint">
                  {draft.length}/4000 · anexos até 10MB · tipos alinhados ao upload de treino de agentes
                </p>
              </footer>
            </>
          )}
        </div>
      </div>

    </div>
  );
}
