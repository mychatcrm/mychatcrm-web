"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BookOpen,
  CalendarClock,
  Check,
  Gauge,
  Layers,
  MessageSquareMore,
  Radio,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import { WhatsAppGlyph } from "@/components/dashboard/crm/crm-phone";
import {
  loadDisparosDrafts,
  persistDisparosDrafts,
  type DisparosDraft,
} from "@/components/dashboard/disparos/disparos-drafts-storage";
import { SITUATION_TEMPLATES } from "@/components/dashboard/disparos/disparos-situation-templates";

const DEFAULT_MESSAGE =
  "Ola {{nome}}, preparamos uma condicao especial para {{empresa}}. Responda SIM para receber o link seguro.";

const AUDIENCE = [
  { id: "todos" as const, label: "Base completa", hint: "Opt-in WhatsApp validado", reach: "~12,4k" },
  { id: "tag" as const, label: "Por tag", hint: "Segmentos do CRM Kanban", reach: "~2,1k" },
  { id: "etapa" as const, label: "Por funil", hint: "Colunas do CRM Kanban", reach: "~890" },
];

const THROUGHPUT = [
  { id: "suave" as const, label: "Suave", sub: "Menos risco de bloqueio" },
  { id: "normal" as const, label: "Normal", sub: "Equilibrio recomendado" },
  { id: "acelerado" as const, label: "Acelerado", sub: "Janelas curtas" },
];

const VARIABLES = [
  { snippet: "{{nome}}", sample: "Marina" },
  { snippet: "{{empresa}}", sample: "Clinica Vista" },
  { snippet: "{{telefone}}", sample: "(11) 98765-4321" },
];

function insertAtCaret(textarea: HTMLTextAreaElement, snippet: string) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const next = textarea.value.slice(0, start) + snippet + textarea.value.slice(end);
  textarea.value = next;
  const pos = start + snippet.length;
  textarea.setSelectionRange(pos, pos);
}

function previewBody(body: string) {
  return body
    .replaceAll("{{nome}}", "Marina")
    .replaceAll("{{empresa}}", "Clinica Vista")
    .replaceAll("{{telefone}}", "(11) 98765-4321");
}

const MAX_DRAFTS = 30;

function newDraftId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function DisparosMassaHub({ campaignItems }: { campaignItems: string[] }) {
  const { isLight } = usePanelAppearance();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [campaignName, setCampaignName] = useState("");
  const [audienceId, setAudienceId] = useState<(typeof AUDIENCE)[number]["id"]>("todos");
  const [schedule, setSchedule] = useState("");
  const [body, setBody] = useState(DEFAULT_MESSAGE);
  const [throughput, setThroughput] = useState<(typeof THROUGHPUT)[number]["id"]>("normal");
  const [drafts, setDrafts] = useState<DisparosDraft[]>([]);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);

  useEffect(() => {
    setDrafts(loadDisparosDrafts());
  }, []);

  const audience = useMemo(() => AUDIENCE.find((a) => a.id === audienceId)!, [audienceId]);
  const charCount = body.length;
  const preview = previewBody(body);

  const appendVariable = useCallback((snippet: string) => {
    const el = taRef.current;
    if (!el) {
      setBody((v) => (v.endsWith(" ") || v.length === 0 ? v + snippet : `${v} ${snippet}`));
      return;
    }
    el.focus();
    insertAtCaret(el, snippet);
    setBody(el.value);
  }, []);

  const commitDrafts = useCallback((buildNext: (prev: DisparosDraft[]) => DisparosDraft[]) => {
    setDrafts((prev) => {
      const next = buildNext(prev).slice(0, MAX_DRAFTS);
      persistDisparosDrafts(next);
      return next;
    });
  }, []);

  const handleSaveDraft = useCallback(() => {
    setSavingDraft(true);
    const stamp = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    const name = campaignName.trim() || `Rascunho ${stamp}`;
    const draft: DisparosDraft = {
      id: newDraftId(),
      name,
      audienceId,
      schedule,
      throughput,
      body,
      updatedAt: new Date().toISOString(),
    };
    commitDrafts((prev) => [draft, ...prev]);
    setDraftNotice("Rascunho salvo neste navegador (local).");
    window.setTimeout(() => setDraftNotice(null), 4500);
    window.setTimeout(() => setSavingDraft(false), 400);
  }, [audienceId, body, campaignName, commitDrafts, schedule, throughput]);

  const handleLoadDraft = useCallback((d: DisparosDraft) => {
    setCampaignName(d.name);
    setAudienceId(d.audienceId);
    setSchedule(d.schedule);
    setThroughput(d.throughput);
    setBody(d.body);
    setDraftNotice("Rascunho carregado no editor.");
    window.setTimeout(() => setDraftNotice(null), 3500);
  }, []);

  const handleDeleteDraft = useCallback(
    (id: string) => {
      commitDrafts((prev) => prev.filter((d) => d.id !== id));
      setDraftNotice("Rascunho removido.");
      window.setTimeout(() => setDraftNotice(null), 3000);
    },
    [commitDrafts],
  );

  const applySituationTemplate = useCallback((text: string, title: string) => {
    setBody(text);
    if (!campaignName.trim()) setCampaignName(`Campanha · ${title}`);
    setDraftNotice(`Modelo "${title}" aplicado ao editor.`);
    window.setTimeout(() => setDraftNotice(null), 3500);
  }, [campaignName]);

  const history = useMemo(() => {
    const delivered = [93, 87, 98, 91, 88];
    const statuses: Array<"concluido" | "agendado" | "em fila"> = ["concluido", "concluido", "agendado", "em fila", "concluido"];
    return campaignItems.map((name, i) => ({
      name,
      delivered: delivered[i % delivered.length],
      status: statuses[i % statuses.length],
      window: i % 2 === 0 ? "09h–18h" : "10h–20h",
    }));
  }, [campaignItems]);

  const statusLabel = (s: "concluido" | "agendado" | "em fila") => {
    if (s === "concluido") return "Concluido";
    if (s === "agendado") return "Agendado";
    return "Em fila";
  };

  return (
    <div className="space-y-6">
      <div
        className={cn(
          "relative overflow-hidden rounded-xl border p-6 sm:p-8",
          isLight
            ? "border-slate-200/90 bg-gradient-to-br from-surface-deep via-slate-50/90 to-emerald-50/40"
            : "border-line/80 bg-gradient-to-br from-surface-deep/80 via-surface-card/30 to-emerald-950/20",
        )}
      >
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(37,211,102,0.22), transparent 68%)" }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-20 left-1/3 h-56 w-56 rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(242,68,0,0.18), transparent 70%)" }}
          aria-hidden
        />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                className={cn(
                  isLight ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
                  "font-semibold tracking-wide",
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Radio className="size-3.5 animate-pulse" aria-hidden />
                  Canal WhatsApp Business
                </span>
              </Badge>
              <Badge className="border-primary/35 bg-primary/10 text-primary">Cloud API · demo</Badge>
            </div>
            <h3 className="text-balance text-2xl font-semibold tracking-tight text-content sm:text-3xl">
              Centro de disparo em massa
            </h3>
            <p className="max-w-xl text-pretty text-sm leading-relaxed text-content-secondary sm:text-base">
              Coordene audiencias, personalize com variaveis dinamicas, defina janela segura de envio e acompanhe a
              telemetria de entrega — tudo preparado para escalar conversas reais no WhatsApp.
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-card/60 px-4 py-2 text-xs text-content-secondary backdrop-blur-sm">
                <ShieldCheck className="size-4 shrink-0 text-emerald-500" aria-hidden />
                Conformidade: opt-in e politica de bloqueio simulados neste ambiente.
              </div>
            </div>
          </div>
          <div className="grid shrink-0 grid-cols-3 gap-2 sm:gap-3 lg:w-[min(100%,380px)]">
            {[
              { icon: Users, label: "Alcance", value: audience.reach, tone: "text-primary/85" },
              { icon: Activity, label: "Throughput", value: throughput === "suave" ? "12/s" : throughput === "normal" ? "28/s" : "45/s", tone: "text-primary" },
              {
                icon: MessageSquareMore,
                label: "Biblioteca",
                value: `${SITUATION_TEMPLATES.length} modelos`,
                tone: "text-emerald-400",
              },
            ].map(({ icon: Icon, label, value, tone }) => (
              <div
                key={label}
                className={cn(
                  "rounded-xl border p-3 text-center backdrop-blur-sm sm:p-4",
                  isLight ? "border-slate-200/80 bg-surface-deep/80" : "border-line/70 bg-surface-deep/50",
                )}
              >
                <Icon className={cn("mx-auto mb-2 size-5 opacity-90", tone)} aria-hidden />
                <div className="text-[10px] font-medium uppercase tracking-wider text-content-secondary">{label}</div>
                <div className="mt-1 truncate text-sm font-semibold text-content">{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-5">
          <div
            className={cn(
              "rounded-xl border p-5 sm:p-6",
              isLight ? "border-slate-200/80 bg-surface-deep/90" : "border-line bg-surface-deep/35",
            )}
          >
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-content">
              <Layers className="size-4 text-primary" aria-hidden />
              Missao da campanha
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-content-secondary">Nome interno</label>
                <Input
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  placeholder="Ex.: Reativacao Q2 · base fria"
                  className="rounded-xl"
                />
              </div>
              <div>
                <label className="mb-2 block text-xs font-medium text-content-secondary">Audiencia</label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {AUDIENCE.map((opt) => {
                    const active = opt.id === audienceId;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setAudienceId(opt.id)}
                        className={cn(
                          "rounded-xl border px-3 py-3 text-left text-sm transition-all",
                          active
                            ? "border-primary/60 bg-primary/10 "
                            : "border-line bg-surface-card/40 hover:border-primary/35 hover:bg-surface-elevated/30",
                        )}
                      >
                        <div className="font-semibold text-content">{opt.label}</div>
                        <div className="mt-0.5 text-[11px] text-content-secondary">{opt.hint}</div>
                        <div className="mt-2 font-mono text-xs text-primary">{opt.reach}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-content-secondary">
                    <CalendarClock className="size-3.5" aria-hidden />
                    Janela de disparo
                  </label>
                  <Input type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} className="rounded-xl" />
                  <p className="mt-1.5 text-[11px] text-content-secondary">Fuso America/Sao_Paulo · respeita horario comercial simulado.</p>
                </div>
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-content-secondary">
                    <Gauge className="size-3.5" aria-hidden />
                    Ritmo de envio
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {THROUGHPUT.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setThroughput(t.id)}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                          throughput === t.id
                            ? "border-primary bg-primary text-white"
                            : "border-line text-content-secondary hover:border-primary/40 hover:text-content",
                        )}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-content-secondary">
                    {THROUGHPUT.find((t) => t.id === throughput)?.sub}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div
            className={cn(
              "rounded-xl border p-5 sm:p-6",
              isLight ? "border-slate-200/80 bg-surface-deep/90" : "border-line bg-surface-deep/35",
            )}
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-content">
                <BookOpen className="size-4 text-emerald-400" aria-hidden />
                Modelos por situacao
              </div>
              <Badge className="text-[10px]">1 clique no editor</Badge>
            </div>
            <p className="mb-4 text-xs leading-relaxed text-content-secondary">
              Textos prontos para cenarios comuns — personalizam com{" "}
              <span className="font-mono text-[11px] text-primary">{"{{nome}}"}</span>,{" "}
              <span className="font-mono text-[11px] text-primary">{"{{empresa}}"}</span> e{" "}
              <span className="font-mono text-[11px] text-primary">{"{{telefone}}"}</span>.
            </p>
            <div className="flex gap-3 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {SITUATION_TEMPLATES.map((tpl) => {
                const Icon = tpl.Icon;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => applySituationTemplate(tpl.body, tpl.title)}
                    className={cn(
                      "flex w-[min(100%,220px)] shrink-0 flex-col gap-2 rounded-xl border p-4 text-left transition-all",
                      "hover:border-primary/45 hover:border-line",
                      isLight ? "border-slate-200/90 bg-slate-50/80" : "border-line bg-surface-card/50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Icon className={cn("size-6 shrink-0", tpl.accent)} aria-hidden />
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        Usar
                      </span>
                    </div>
                    <div>
                      <div className="font-semibold text-content">{tpl.title}</div>
                      <div className="mt-0.5 text-[11px] text-content-secondary">{tpl.subtitle}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div
            className={cn(
              "rounded-xl border p-5 sm:p-6",
              isLight ? "border-slate-200/80 bg-surface-deep/90" : "border-line bg-surface-deep/35",
            )}
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-content">
                <Sparkles className="size-4 text-amber-400" aria-hidden />
                Mensagem dinamica
              </div>
              <span className="font-mono text-[11px] text-content-secondary">
                {charCount} / 4096 <span className="text-content-secondary/70">caracteres</span>
              </span>
            </div>
            <p className="mb-3 text-xs text-content-secondary">Inserir variaveis no cursor:</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {VARIABLES.map((v) => (
                <button
                  key={v.snippet}
                  type="button"
                  onClick={() => appendVariable(v.snippet)}
                  className="rounded-full border border-line bg-surface-elevated/40 px-3 py-1 font-mono text-[11px] text-primary hover:border-primary/50 hover:bg-primary/10"
                >
                  {v.snippet}
                </button>
              ))}
            </div>
            <textarea
              ref={taRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={4096}
              rows={6}
              className={cn(
                "w-full resize-y rounded-xl border px-4 py-3 text-sm outline-none transition-colors focus:border-primary/50 focus:ring-2 focus:ring-primary/20",
                isLight ? "border-slate-200 bg-surface-card text-content" : "border-line bg-surface-card/50 text-content",
              )}
            />
            {draftNotice ? (
              <div
                className={cn(
                  "mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium",
                  isLight ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
                )}
                role="status"
              >
                <Check className="size-4 shrink-0 text-emerald-500" aria-hidden />
                {draftNotice}
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-3">
              <Button type="button" variant="gradient" className="gap-2 ">
                <Zap className="size-4" aria-hidden />
                Agendar disparo
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="gap-2"
                onClick={handleSaveDraft}
                isLoading={savingDraft}
              >
                <Send className="size-4" aria-hidden />
                Salvar rascunho
              </Button>
            </div>
            <div className="mt-6 border-t border-line pt-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-content-secondary">
                  Meus rascunhos ({drafts.length})
                </span>
                {drafts.length > 0 ? (
                  <span className="text-[10px] text-content-secondary">Armazenado localmente no navegador</span>
                ) : null}
              </div>
              {drafts.length === 0 ? (
                <p className="text-xs text-content-secondary">
                  Nenhum rascunho ainda. Preencha a campanha e clique em &quot;Salvar rascunho&quot; — os dados ficam
                  salvos neste dispositivo.
                </p>
              ) : (
                <ul className="max-h-[220px] space-y-2 overflow-y-auto pr-1">
                  {drafts.map((d) => {
                    const when = new Date(d.updatedAt).toLocaleString("pt-BR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    });
                    return (
                      <li
                        key={d.id}
                        className={cn(
                          "flex items-center gap-2 rounded-xl border px-3 py-2.5",
                          isLight ? "border-slate-200/90 bg-surface-card" : "border-line/80 bg-surface-card/40",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-content">{d.name}</div>
                          <div className="text-[10px] text-content-secondary">{when}</div>
                        </div>
                        <Button type="button" variant="ghost" size="sm" className="shrink-0 px-3" onClick={() => handleLoadDraft(d)}>
                          Carregar
                        </Button>
                        <button
                          type="button"
                          onClick={() => handleDeleteDraft(d.id)}
                          className={cn(
                            "grid size-10 shrink-0 place-items-center rounded-xl border border-transparent text-content-secondary transition-colors",
                            isLight ? "hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-600" : "hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300",
                          )}
                          aria-label={`Excluir rascunho ${d.name}`}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div
            className={cn(
              "rounded-xl border p-5 sm:p-6",
              isLight ? "border-slate-200/80 bg-surface-deep/90" : "border-line bg-surface-deep/35",
            )}
          >
            <div className="mb-4 text-sm font-semibold text-content">Pre-visualizacao ao vivo</div>
            <div
              className={cn(
                "mx-auto max-w-sm overflow-hidden rounded-[2rem] border ",
                isLight ? "border-slate-300 bg-slate-900 text-slate-50" : "border-slate-700 bg-slate-950 text-slate-100",
              )}
            >
              <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                <WhatsAppGlyph className="size-5 text-emerald-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">MyChatCRM · disparo</div>
                  <div className="text-[10px] text-emerald-300/90">online</div>
                </div>
                <span className="size-2 rounded-full bg-emerald-400 " aria-hidden />
              </div>
              <div className="space-y-2 bg-[linear-gradient(180deg,rgba(15,23,42,0.3),rgba(15,23,42,0.85))] px-3 py-4">
                <div className="ml-auto max-w-[92%] rounded-xl rounded-tr-sm bg-emerald-700/90 px-3 py-2 text-[13px] leading-snug text-white ">
                  {preview || "Digite sua mensagem…"}
                </div>
                <div className="text-center text-[10px] text-white/40">Hoje · simulacao</div>
              </div>
            </div>
          </div>

          <div
            className={cn(
              "rounded-xl border p-5 sm:p-6",
              isLight ? "border-slate-200/80 bg-surface-deep/90" : "border-line bg-surface-deep/35",
            )}
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-content">Historico de campanhas</span>
              <Badge className="text-[10px]">Telemetria demo</Badge>
            </div>
            <ul className="space-y-3">
              {history.map((row) => (
                <li
                  key={row.name}
                  className={cn(
                    "flex items-center gap-4 rounded-xl border px-4 py-3",
                    isLight ? "border-slate-200/80 bg-slate-50/80" : "border-line/80 bg-surface-card/40",
                  )}
                >
                  <div className="relative size-12 shrink-0">
                    <div
                      className="absolute inset-0 rounded-xl"
                      style={{
                        background: `conic-gradient(rgb(34 197 94) ${row.delivered * 3.6}deg, rgba(148,163,184,0.28) 0)`,
                      }}
                      aria-hidden
                    />
                    <div
                      className={cn(
                        "absolute inset-[3px] grid place-items-center rounded-[0.65rem] text-[11px] font-bold tabular-nums",
                        isLight ? "bg-surface-deep text-content" : "bg-slate-950 text-slate-100",
                      )}
                    >
                      {row.delivered}%
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-content">{row.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-content-secondary">
                      <span>{statusLabel(row.status)}</span>
                      <span className="text-content-secondary/50">·</span>
                      <span>Janela {row.window}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
