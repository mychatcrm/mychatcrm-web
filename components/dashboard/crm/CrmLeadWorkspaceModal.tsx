"use client";

import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeftRight,
  Bot,
  Building2,
  CalendarClock,
  ClipboardList,
  FileText,
  Flag,
  ChevronDown,
  Footprints,
  Globe,
  Hash,
  Mail,
  Megaphone,
  MessageCircle,
  Phone,
  Sparkles,
  StickyNote,
  ListTodo,
  User,
  UserPlus,
  UserRound,
} from "lucide-react";
import type { ClientLead } from "@/lib/dashboard-data";
import { funnelColumnTitle, type CrmFunnel } from "@/lib/crm-funnels";
import {
  LEAD_EXTRAS_UPDATED_EVENT,
  loadLeadExtras,
  saveLeadExtras,
  type CrmLeadExtrasStore,
  type CrmLeadTask,
} from "@/lib/crm-lead-extras";
import { computeLeadTemperature } from "@/lib/crm-lead-temperature";
import { CrmRegistrarFollowUpModal } from "./CrmRegistrarFollowUpModal";
import { LeadThermometerInline, LeadThermometerPanel } from "./LeadThermometer";
import { formatBRL } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { typography } from "@/lib/typography";
import { phoneToWhatsAppWebHref, WhatsAppGlyph } from "./crm-phone";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";

type Tab = "informacoes" | "historico" | "tarefas" | "ia";

type LeadConversationMessage = {
  id: string;
  direction: "inbound" | "outbound";
  kind: string;
  content: string;
  media_url?: string | null;
  agent_id?: string | null;
  created_at: string;
};

type LeadConversationSummary = {
  summary: string;
  customer_intent?: string | null;
  lead_temperature?: string | null;
  suggested_next_action?: string | null;
  created_at?: string | null;
};

const tabs: { id: Tab; label: string; icon: typeof MessageCircle }[] = [
  { id: "informacoes", label: "Informações", icon: MessageCircle },
  { id: "historico", label: "Histórico de Interações", icon: CalendarClock },
  { id: "tarefas", label: "Tarefas", icon: ListTodo },
  { id: "ia", label: "Insights IA", icon: Sparkles },
];

function newId(prefix: string) {
  return `${prefix}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 10) : String(Date.now())}`;
}

function leadInitials(nome: string) {
  const parts = nome.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0]![0];
    const b = parts[parts.length - 1]![0];
    return `${a}${b}`.toUpperCase();
  }
  return nome.slice(0, 2).toUpperCase() || "—";
}

function formatEntrada(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return iso;
  return new Date(y, mo - 1, d).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", hour12: false });
}

function mergeOrigemDisplay(lead: ClientLead): {
  midia: string;
  campanha: string;
  pagina: string;
  formulario: string;
  tipoCliente: string;
} {
  const om = lead.origemMarketing;
  if (om) {
    return {
      midia: om.midia?.trim() || "—",
      campanha: om.campanha?.trim() || "—",
      pagina: om.pagina?.trim() || "—",
      formulario: om.formulario?.trim() || "—",
      tipoCliente: om.tipoCliente?.trim() ?? "",
    };
  }
  const o = lead.origem.toLowerCase();
  const midia =
    o.includes("whatsapp") ? "WhatsApp" :
    o.includes("meta") || o.includes("facebook") || o.includes("instagram") ? "Meta / redes sociais" :
    o.includes("google") ? "Google" :
    o.includes("site") || o.includes("form") ? "Site" :
    o.includes("indicação") || o.includes("indicacao") ? "Indicação / offline" :
    lead.origem;
  return {
    midia,
    campanha: "—",
    pagina: "—",
    formulario: "—",
    tipoCliente: "",
  };
}

function OrigemCampo({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Megaphone;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center gap-2 text-content-muted">
        <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
        <span className={cn(typography.ui.overline, "text-content")}>{label}</span>
      </div>
      <p className="break-words text-sm font-semibold leading-snug text-content">{value}</p>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  valueClassName,
  title,
}: {
  icon: typeof Phone;
  label: string;
  value: ReactNode;
  valueClassName?: string;
  title?: string;
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-line/80 bg-surface-base/40 px-3 py-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-deep text-content-muted">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className={typography.ui.overline}>{label}</p>
        <p className={cn("mt-0.5 text-sm font-medium text-content", valueClassName)} title={title}>
          {value}
        </p>
      </div>
    </div>
  );
}

export function CrmLeadWorkspaceModal({
  lead,
  funnel,
  allFunnels = [],
  onClose,
  onUpdateLead,
}: {
  lead: ClientLead;
  funnel: CrmFunnel | undefined;
  /** Todos os funis (transferência de lead entre funis no follow-up). */
  allFunnels?: readonly CrmFunnel[];
  onClose: () => void;
  onUpdateLead?: (next: ClientLead) => void;
}) {
  const { isLight } = usePanelAppearance();
  const baseId = useId();
  const [tab, setTab] = useState<Tab>("informacoes");
  const [store, setStore] = useState<CrmLeadExtrasStore>(() => loadLeadExtras());
  const [taskDraft, setTaskDraft] = useState("");
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [conversationMessages, setConversationMessages] = useState<LeadConversationMessage[]>([]);
  const [conversationSummary, setConversationSummary] = useState<LeadConversationSummary | null>(null);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState("");

  useEffect(() => {
    setStore(loadLeadExtras());
    setTab("informacoes");
    setConversationMessages([]);
    setConversationSummary(null);
    setConversationError("");
  }, [lead.id]);

  useEffect(() => {
    let cancelled = false;
    setConversationLoading(true);
    setConversationError("");
    fetch(`/api/client/crm/leads/${encodeURIComponent(lead.id)}/conversation-history`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as {
          messages?: LeadConversationMessage[];
          summary?: LeadConversationSummary | null;
          error?: string;
        };
        if (!response.ok) throw new Error(data.error || "Erro ao carregar histórico.");
        if (cancelled) return;
        setConversationMessages(Array.isArray(data.messages) ? data.messages : []);
        setConversationSummary(data.summary ?? null);
      })
      .catch((error) => {
        if (cancelled) return;
        setConversationMessages([]);
        setConversationSummary(null);
        setConversationError(error instanceof Error ? error.message : "Erro ao carregar histórico.");
      })
      .finally(() => {
        if (!cancelled) setConversationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lead.id]);

  useEffect(() => {
    const sync = () => setStore(loadLeadExtras());
    window.addEventListener(LEAD_EXTRAS_UPDATED_EVENT, sync);
    return () => window.removeEventListener(LEAD_EXTRAS_UPDATED_EVENT, sync);
  }, []);

  const persist = useCallback((next: CrmLeadExtrasStore) => {
    setStore(next);
    saveLeadExtras(next);
  }, []);

  const funnelDoLead = useMemo(
    () => allFunnels.find((f) => f.id === lead.funilId) ?? funnel,
    [allFunnels, lead.funilId, funnel],
  );

  const origemView = useMemo(() => mergeOrigemDisplay(lead), [lead]);

  const timeline = useMemo(() => store.timeline[lead.id] ?? [], [lead.id, store.timeline]);

  const temperatura = useMemo(
    () => computeLeadTemperature(lead, timeline, funnelDoLead),
    [lead, timeline, funnelDoLead],
  );

  const tasks = store.tasks[lead.id] ?? [];

  const stageLabel = funnel ? funnelColumnTitle(funnel, lead.status) : "—";
  const waHref = phoneToWhatsAppWebHref(lead.telefone);

  const toggleTask = (taskId: string) => {
    const list = (store.tasks[lead.id] ?? []).map((t) => (t.id === taskId ? { ...t, done: !t.done } : t));
    persist({ ...store, tasks: { ...store.tasks, [lead.id]: list } });
  };

  const addTask = () => {
    if (!taskDraft.trim()) return;
    const row: CrmLeadTask = { id: newId("task"), title: taskDraft.trim(), done: false };
    persist({
      ...store,
      tasks: { ...store.tasks, [lead.id]: [...(store.tasks[lead.id] ?? []), row] },
    });
    setTaskDraft("");
  };

  const titleHero = (
    <div className="rounded-xl border border-line/90 bg-gradient-to-br from-primary/[0.09] via-surface-deep/50 to-surface-card p-3 sm:p-4">
      <div className="flex min-w-0 gap-2 sm:gap-3">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-sm font-bold tracking-tight text-primary ring-1 ring-primary/25"
          aria-hidden
        >
          {leadInitials(lead.nome)}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className={cn(typography.ui.overline, "text-primary")}>Ficha do lead</p>
            <p className="mt-0.5 truncate text-lg font-semibold leading-tight text-content">{lead.nome}</p>
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-content-muted">
              <Building2 className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
              {lead.empresa}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className="border-primary/35 bg-primary/12 text-[11px] font-semibold text-primary" title={lead.agenteAtendendo}>
              IA · {lead.agenteAtendendo}
            </Badge>
            {lead.agenteAtendendo !== lead.agenteEntrada ? (
              <Badge
                className="max-w-[min(100%,12rem)] truncate border-line bg-surface-elevated/80 text-[11px] text-content-secondary"
                title={lead.agenteEntrada}
              >
                Entrada · {lead.agenteEntrada}
              </Badge>
            ) : null}
            <Badge className={cn("border-emerald-500/35 bg-emerald-500/10 text-[11px] font-semibold", isLight ? "text-emerald-700" : "text-emerald-400")}>
              {stageLabel}
            </Badge>
            <Badge className="border-line/90 bg-transparent text-[11px] text-content-secondary">
              {lead.tag}
            </Badge>
          </div>
          <div className="grid gap-2 pt-0.5 sm:grid-cols-3">
            <div className="rounded-lg bg-surface-base/60 px-2.5 py-1.5 ring-1 ring-line/60">
              <p className="text-[10px] font-medium uppercase tracking-wide text-content-faint">Valor</p>
              <p className="text-sm font-semibold tabular-nums text-content">{formatBRL(lead.valor)}</p>
            </div>
            <div className="rounded-lg bg-surface-base/60 px-2.5 py-1.5 ring-1 ring-line/60">
              <p className="text-[10px] font-medium uppercase tracking-wide text-content-faint">Origem</p>
              <p className="truncate text-sm font-medium text-content">{lead.origem}</p>
            </div>
            <div className="rounded-lg bg-surface-base/60 px-2.5 py-1.5 ring-1 ring-line/60">
              <p className="text-[10px] font-medium uppercase tracking-wide text-content-faint">Entrada no CRM Kanban</p>
              <p className="text-sm font-medium text-content">{formatEntrada(lead.dataEntradaISO)}</p>
            </div>
          </div>
          <div className="flex flex-col gap-1 border-t border-line/70 pt-3 text-xs text-content-muted sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <span className="inline-flex items-center gap-1.5 min-w-0">
              <UserRound className="h-3.5 w-3.5 shrink-0 text-content-faint" aria-hidden />
              <span className="truncate">
                <span className="text-content-faint">Responsável:</span>{" "}
                <span className="font-medium text-content-secondary">{lead.responsavel}</span>
              </span>
            </span>
            <span className="inline-flex min-w-0 items-start gap-1.5 sm:text-right">
              <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-content-faint" aria-hidden />
              <span className="min-w-0 break-words">
                <span className="text-content-faint">Próxima ação:</span>{" "}
                <span className="font-medium text-content-secondary">{lead.proximaAcao}</span>
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
    <Modal
      open
      onClose={onClose}
      title={lead.nome}
      titleContent={titleHero}
      className="max-w-[min(56rem,calc(100vw-1.25rem))]"
      footer={
        <>
          <Button variant="secondary" type="button" className="w-full min-w-0 sm:w-auto" onClick={onClose}>
            Fechar
          </Button>
          <Button
            type="button"
            className="w-full min-w-0 gap-2 bg-emerald-600 text-white hover:bg-emerald-500 sm:w-auto"
            onClick={() => window.open(waHref, "_blank", "noopener,noreferrer")}
          >
            <WhatsAppGlyph className="h-4 w-4 shrink-0" />
            <span className="truncate">Abrir no WhatsApp Web</span>
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-content-muted">
            Último contacto: <span className="font-medium text-content-secondary">{lead.ultimoContato}</span>
          </p>
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 sm:w-auto"
          >
            <WhatsAppGlyph className="h-5 w-5" />
            Conversar agora
          </a>
        </div>

        <nav
          className="flex min-w-0 gap-0.5 overflow-x-auto rounded-xl border border-line/90 bg-surface-deep/50 p-1 [-webkit-overflow-scrolling:touch] touch-pan-x"
          aria-label="Secções do lead"
        >
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "inline-flex min-h-[40px] shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition",
                  active
                    ? "bg-surface-card text-content ring-1 ring-line/80"
                    : "text-content-muted hover:bg-surface-card/40 hover:text-content",
                )}
              >
                <Icon className={cn("h-4 w-4", active ? "text-primary" : "opacity-70")} aria-hidden />
                {t.label}
              </button>
            );
          })}
        </nav>

        {tab === "informacoes" ? (
          <div className="space-y-4">
            <LeadThermometerPanel result={temperatura} />
            <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-line/90 bg-surface-deep/30 p-4 ring-1 ring-inset ring-line/25">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-content">Contacto</h3>
                <span className="rounded-md bg-surface-base/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-content-faint">
                  Ficha 360º
                </span>
              </div>
              <div className="space-y-2">
                <InfoRow icon={Phone} label="Telefone" value={lead.telefone} />
                <InfoRow icon={Mail} label="E-mail" value={lead.email} valueClassName="truncate" title={lead.email} />
                <InfoRow
                  icon={Bot}
                  label="Agente IA a atender"
                  value={lead.agenteAtendendo}
                  valueClassName="truncate"
                  title={lead.agenteAtendendo}
                />
                <InfoRow
                  icon={Hash}
                  label="Agente de entrada"
                  value={lead.agenteEntrada}
                  valueClassName="truncate"
                  title={lead.agenteEntrada}
                />
                <InfoRow
                  icon={Building2}
                  label="Funil"
                  value={allFunnels.find((f) => f.id === lead.funilId)?.nome ?? funnel?.nome ?? "—"}
                />
              </div>
            </div>
            <div className="space-y-4 rounded-xl border border-line/90 bg-surface-deep/30 p-4 ring-1 ring-inset ring-line/25">
              <div className="flex items-start gap-2.5 border-b border-line/70 pb-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-base text-content-muted ring-1 ring-line/80">
                  <User className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-content">Origem</h3>
                  <p className="mt-0.5 text-xs text-content-muted">
                    Classificação no CRM Kanban: <span className="font-medium text-content-secondary">{lead.origem}</span>
                  </p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <OrigemCampo icon={Megaphone} label="Mídia" value={origemView.midia} />
                <OrigemCampo icon={Flag} label="Campanha" value={origemView.campanha} />
                <OrigemCampo icon={Globe} label="Página" value={origemView.pagina} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <OrigemCampo icon={FileText} label="Formulário" value={origemView.formulario} />
                <div className="min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 text-content-muted">
                    <Footprints className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                    <span className={cn(typography.ui.overline, "text-content")}>Tipo de cliente</span>
                  </div>
                  <div
                    className="flex min-h-[44px] w-full cursor-default items-center gap-2 rounded-xl border border-line bg-surface-base/50 px-3 py-2 text-sm text-content"
                    aria-label="Tipo de cliente (edição em breve)"
                  >
                    <span className={cn("min-w-0 flex-1 truncate", origemView.tipoCliente ? "font-semibold" : "text-content-faint")}>
                      {origemView.tipoCliente || "Tipo de cliente"}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-content-faint" aria-hidden />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <p className={typography.ui.overline}>Tags</p>
                <div className="flex min-h-[44px] flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-base/50 px-3 py-2">
                  {lead.tags.map((tag) => (
                    <Badge key={tag} className="border-line/80 bg-surface-card px-2.5 py-0.5 text-xs font-medium">
                      {tag}
                    </Badge>
                  ))}
                  <span className="text-xs text-content-faint">+ Adicionar tags… (em breve)</span>
                </div>
                <p className="text-xs leading-relaxed text-content-muted">
                  Em produção, mídia, campanha, página e formulário vêm das integrações (Meta, Google, site). As tags
                  alimentam segmentação e o histórico de interações.
                </p>
              </div>
            </div>
            </div>
          </div>
        ) : null}

        {tab === "historico" ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start">
                <LeadThermometerInline result={temperatura} className="sm:pt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-content">Histórico de Interações</p>
                  <p className="mt-1 text-xs leading-relaxed text-content-muted">
                    Registo cronológico de cadastros, contactos, movimentações no funil e follow-ups. O termómetro
                    reflecte automaticamente este histórico (e demais sinais do lead).
                  </p>
                </div>
              </div>
              <Button type="button" className="w-full shrink-0 sm:w-auto" onClick={() => setFollowUpOpen(true)}>
                Registrar Follow-Up
              </Button>
            </div>
            {conversationSummary ? (
              <div className="rounded-xl border border-primary/25 bg-primary/[0.06] p-4 ring-1 ring-primary/10">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <Sparkles className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-content">Resumo para handoff humano</p>
                    <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-content-secondary">
                      {conversationSummary.summary}
                    </p>
                    <div className="mt-3 grid gap-2 text-xs text-content-muted sm:grid-cols-3">
                      <span>Temperatura: <strong className="text-content-secondary">{conversationSummary.lead_temperature ?? "—"}</strong></span>
                      <span>Intenção: <strong className="text-content-secondary">{conversationSummary.customer_intent ?? "—"}</strong></span>
                      <span>Próxima ação: <strong className="text-content-secondary">{conversationSummary.suggested_next_action ?? "—"}</strong></span>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="rounded-xl border border-line/90 bg-surface-deep/25 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-content">Conversas WhatsApp</p>
                  <p className="mt-1 text-xs text-content-muted">
                    Histórico real salvo em `whatsapp_messages`, usado também pelo agente de IA.
                  </p>
                </div>
                {conversationLoading ? <span className="text-xs text-content-faint">Carregando…</span> : null}
              </div>
              {conversationError ? (
                <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  {conversationError}
                </p>
              ) : null}
              {!conversationLoading && conversationMessages.length === 0 && !conversationError ? (
                <p className="mt-4 rounded-xl border border-dashed border-line/80 bg-surface-card/40 px-4 py-8 text-center text-sm text-content-muted">
                  Nenhuma mensagem WhatsApp encontrada para este lead ainda.
                </p>
              ) : null}
              {conversationMessages.length > 0 ? (
                <ul className="mt-4 max-h-[360px] space-y-2 overflow-y-auto pr-1">
                  {conversationMessages.map((message) => {
                    const outbound = message.direction === "outbound";
                    return (
                      <li key={message.id} className={cn("flex", outbound ? "justify-end" : "justify-start")}>
                        <div
                          className={cn(
                            "max-w-[82%] rounded-2xl border px-3 py-2 text-sm shadow-sm",
                            outbound
                              ? "border-primary/30 bg-primary/12 text-content"
                              : "border-line bg-surface-card text-content-secondary",
                          )}
                        >
                          <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-content-faint">
                            <span>{outbound ? (message.agent_id === "human" ? "Atendente" : "Agente IA") : "Cliente"}</span>
                            <span>•</span>
                            <span>{message.kind}</span>
                            <span>•</span>
                            <span>{formatDateTime(message.created_at)}</span>
                          </div>
                          <p className="whitespace-pre-line leading-relaxed">{message.content}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
            <div className="relative min-w-0 pr-1">
              {timeline.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line/80 bg-surface-deep/25 px-4 py-10 text-center text-sm text-content-muted">
                  Ainda não há eventos no histórico. Movimentações no funil, follow-ups e notas passam a aparecer aqui
                  quando os registar no painel ou quando existir integração com canais externos.
                </div>
              ) : (
                <>
                  <div
                    className="absolute bottom-2 left-[15px] top-2 w-px bg-gradient-to-b from-line via-line to-transparent"
                    aria-hidden
                  />
                  <ul className="relative space-y-3">
                    {timeline.map((item) => (
                      <li key={item.id} className="relative flex gap-3 pl-1">
                        <span className="relative z-[1] mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-card text-content-secondary">
                          {item.tipo === "whatsapp" ? (
                            <MessageCircle className="h-4 w-4" />
                          ) : item.tipo === "email" ? (
                            <Mail className="h-4 w-4" />
                          ) : item.tipo === "nota" ? (
                            <StickyNote className="h-4 w-4" />
                          ) : item.tipo === "entrada" ? (
                            <UserPlus className="h-4 w-4" />
                          ) : item.tipo === "pipeline" ? (
                            <ArrowLeftRight className="h-4 w-4" />
                          ) : item.tipo === "followup" ? (
                            <ClipboardList className="h-4 w-4" />
                          ) : (
                            <Bot className="h-4 w-4" />
                          )}
                        </span>
                        <div
                          className={cn(
                            "min-w-0 flex-1 rounded-xl border bg-surface-card/90 p-3",
                            item.tipo === "entrada"
                              ? "border-primary/35 ring-1 ring-primary/10"
                              : item.tipo === "followup"
                                ? "border-primary/25 ring-1 ring-primary/5"
                                : "border-line/90",
                          )}
                        >
                          <p className={typography.ui.overline}>{item.at}</p>
                          {item.titulo ? (
                            <p className="mt-1 text-sm font-semibold text-content">{item.titulo}</p>
                          ) : null}
                          <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-content-secondary">
                            {item.texto}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        ) : null}

        {tab === "tarefas" ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 rounded-xl border border-line/80 bg-surface-deep/25 p-3">
              <Input
                id={`${baseId}-task`}
                value={taskDraft}
                onChange={(e) => setTaskDraft(e.target.value)}
                placeholder="Nova tarefa (ex.: Ligar para confirmar demo)"
                className="min-w-0 flex-1 border-line/80"
              />
              <Button type="button" onClick={addTask}>
                Adicionar
              </Button>
            </div>
            <ul className="space-y-2">
              {tasks.length === 0 ? (
                <li className="rounded-xl border border-dashed border-line/90 bg-surface-deep/20 px-4 py-8 text-center">
                  <ListTodo className="mx-auto mb-2 h-8 w-8 text-content-faint opacity-60" aria-hidden />
                  <p className="text-sm font-medium text-content-secondary">Sem tarefas ainda</p>
                  <p className="mt-1 text-xs text-content-muted">
                    Crie follow-ups manuais ou configure automações ao mudar de etapa no funil.
                  </p>
                </li>
              ) : (
                tasks.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center gap-3 rounded-xl border border-line/90 bg-surface-deep/35 px-3 py-2.5 transition hover:border-line"
                  >
                    <input
                      type="checkbox"
                      checked={t.done}
                      onChange={() => toggleTask(t.id)}
                      className="h-4 w-4 rounded border-line text-primary focus:ring-primary/30"
                      aria-label={t.done ? "Marcar tarefa como pendente" : "Marcar tarefa como concluída"}
                    />
                    <span className={cn("flex-1 text-sm", t.done && "text-content-faint line-through")}>{t.title}</span>
                  </li>
                ))
              )}
            </ul>
          </div>
        ) : null}

        {tab === "ia" ? (
          <div className="relative overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-br from-primary/[0.08] via-surface-deep/40 to-primary/[0.04] p-5 ring-1 ring-primary/10">
            <Sparkles className="pointer-events-none absolute -right-2 -top-2 h-24 w-24 text-primary/10" aria-hidden />
            <div className="relative flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/25">
                <Sparkles className="h-5 w-5" aria-hidden />
              </span>
              <div className="space-y-2 text-sm text-content-secondary">
                <p className="text-base font-semibold text-content">Prioridade sugerida (demo)</p>
                <p className="leading-relaxed">
                  Com base no valor ({formatBRL(lead.valor)}), etapa «{stageLabel}» e último contacto, este lead
                  enquadra-se como <strong className="text-content">média-alta prioridade</strong> para contacto humano nas
                  próximas 24h.
                </p>
                <p className="leading-relaxed">
                  <strong className="text-content">Sugestão:</strong> {lead.proximaAcao}. Quando a IA estiver ligada ao
                  histórico real (WhatsApp + CRM), o score e as sugestões serão recalculados automaticamente.
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
    <CrmRegistrarFollowUpModal
      open={followUpOpen}
      onClose={() => setFollowUpOpen(false)}
      lead={lead}
      funnel={funnel}
      allFunnels={allFunnels}
      onSaved={(next) => onUpdateLead?.(next)}
    />
    </>
  );
}
