"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEventHandler,
  type FormEvent,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowDownUp,
  Bell,
  Building2,
  Calendar,
  Camera,
  ChevronDown,
  Clock,
  CreditCard,
  Filter,
  FolderPlus,
  ListMinus,
  ListPlus,
  KeyRound,
  Layers,
  Mail,
  Phone,
  Pencil,
  Plus,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Trash2,
  User,
  UserPlus,
  X,
} from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { Toggle } from "@/components/ui/Toggle";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { DataTable, type Column } from "@/components/ui/DataTable";
import type { ClientSession } from "@/lib/client-auth";
import { SALES_PLANS } from "@/lib/plans";
import { clientDemoReauthPassword } from "@/lib/client-demo-password";
import { filterLeadsForSession } from "@/lib/organization-hierarchy";
import { refreshTeamEmployeesFromApi } from "@/lib/team-employees-client-cache";
import {
  loadTeamEmployees,
  TEAM_EMPLOYEES_UPDATED_EVENT,
  type TeamEmployee,
} from "@/lib/team-employees-storage";
import {
  getDashboardDataset,
  type ClientLead,
  type DashboardDataset,
  type DashboardRouteKey,
} from "@/lib/dashboard-data";
import {
  applyCrmLeadFilters,
  EMPTY_CRM_LEAD_FILTERS,
  type CrmLeadAppliedFilters,
} from "@/lib/crm-lead-filters";
import { cn, formatBRL } from "@/lib/utils";
import { formatLeadCount, planMonthlyLeadAllowance } from "@/lib/dashboard-lead-usage";
import { useLeadUsageSnapshot } from "@/lib/use-lead-usage-snapshot";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import { ProfileAvatar, profileAvatarPresets, useDashboardProfileAvatar } from "./ProfileAvatar";
import { AgentsListSection } from "./agentes/AgentsHub";
import { OperacaoConversasHub } from "./conversas/OperacaoConversasHub";
import {
  appendCrmTimelineEvent,
  buildPipelineMoveItem,
  getLeadTimelineResolved,
  LEAD_EXTRAS_UPDATED_EVENT,
  loadLeadExtras,
} from "@/lib/crm-lead-extras";
import { computeLeadTemperature, type LeadTemperatureResult } from "@/lib/crm-lead-temperature";
import { formatIntegerPtBr } from "@/lib/format-number";
import { funnelColumnTitle, normalizeColunaInicialForFunnel } from "@/lib/crm-funnels";
import { getPlanMaxSalesFunnelsForSession, normalizeClientPlan } from "@/lib/plan-limits";
import { loadCrmLeadsSnapshot, persistCrmLeadsSnapshot } from "@/lib/crm-leads-storage";
import { LeadThermometerBar, LeadThermometerInline } from "./crm/LeadThermometer";
import { CrmAddLeadModal } from "./crm/CrmAddLeadModal";
import { CrmReorderStagesModal } from "./crm/CrmReorderStagesModal";
import { CrmInsightsBar } from "./crm/CrmInsightsBar";
import { CrmLeadWorkspaceModal } from "./crm/CrmLeadWorkspaceModal";
import { phoneToWhatsAppWebHref, WhatsAppGlyph } from "./crm/crm-phone";
import { useCrmFunnels } from "./CrmFunnelsContext";
import { DisparosMassaHub } from "./disparos/DisparosMassaHub";
import { AgendaHub } from "./agenda/AgendaHub";
import { LembretesHub } from "./lembretes/LembretesHub";
import { IntegracoesHub } from "./integrations/IntegracoesHub";
import { SuporteHub } from "./suporte/SuporteHub";
import { BillingOffersPopover } from "./BillingOffersPopover";
import { LeadDistributionHub } from "./lead-rules/LeadDistributionHub";
import { TeamEmployeesHub } from "./equipe/TeamEmployeesHub";
import { BotStatusToggle } from "./BotStatusToggle";
import { typography } from "@/lib/typography";

function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-xl border border-line bg-surface-card p-5 sm:p-6", className)}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className={cn(typography.heading.h4, "text-[17px] sm:text-xl")}>{title}</h2>
          {description ? (
            <p className="mt-1.5 text-[13px] leading-relaxed text-content-muted">{description}</p>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function MetricCard({
  label,
  value,
  helper,
  accent,
}: {
  label: string;
  value: string;
  helper: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-card p-4 transition-colors duration-200 hover:border-line">
      <p className={typography.ui.overline}>{label}</p>
      <p className={cn(typography.ui.kpi, "mt-2 text-2xl sm:text-3xl", accent)}>{value}</p>
      <p className={cn(typography.ui.caption, "mt-2 leading-snug")}>{helper}</p>
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.min(Math.max(value, 0), 100);
  return (
    <div
      className="relative h-2.5 overflow-hidden rounded-full bg-content-muted/20 ring-2 ring-inset ring-line/60"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="relative h-full rounded-full bg-gradient-to-r from-primary to-primary-hover shadow-sm shadow-primary/25 transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function HeatmapEmptyState() {
  const { isLight } = usePanelAppearance();
  return (
    <div
      className={cn(
        "rounded-xl border border-dashed border-line/80 bg-surface-deep/30 px-4 py-8 text-center text-[13px] leading-relaxed text-content-muted",
        isLight ? "bg-slate-50 text-slate-600" : null,
      )}
    >
      Sem dados de horários de pico para este período. Quando houver telemetria de conversas por dia e hora, o mapa aparece aqui.
    </div>
  );
}

function SimulatedBars({ items }: { items: { label: string; value: number; secondary?: number }[] }) {
  const { isLight } = usePanelAppearance();
  if (!items.length) {
    return (
      <div
        className={cn(
          "rounded-xl border border-dashed border-line/80 bg-surface-deep/30 px-4 py-8 text-center text-[13px] leading-relaxed text-content-muted",
          isLight ? "bg-slate-50 text-slate-600" : null,
        )}
      >
        Sem dados para o período selecionado.
      </div>
    );
  }
  return (
    <div className="space-y-3.5">
      {items.map((item) => (
        <div key={item.label} className="group">
          <div className="mb-1.5 flex items-center justify-between text-[13px]">
            <span className="font-medium text-content-secondary">{item.label}</span>
            <span className="font-semibold tabular-nums text-content">{item.value}%</span>
          </div>
          <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-surface-elevated/70 ring-1 ring-inset ring-line/30">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary via-primary to-primary-hover transition-all duration-500 ease-out"
              style={{ width: `${Math.min(item.value, 100)}%` }}
            />
            {item.secondary ? (
              <div
                className="absolute inset-y-0 rounded-full bg-white/15 transition-all duration-500 ease-out"
                style={{ left: `${Math.min(item.value, 100)}%`, width: `${Math.min(item.secondary, 100 - item.value)}%` }}
              />
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function toLocalISODate(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseLocalISODate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

function startOfLocalDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfLocalDay(date: Date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function addLocalDays(date: Date, deltaDays: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + deltaDays);
  return d;
}

function rangeForLastNDaysInclusive(days: number, anchor: Date) {
  const end = endOfLocalDay(anchor);
  const start = startOfLocalDay(addLocalDays(anchor, -(days - 1)));
  return { start, end, fromISO: toLocalISODate(start), toISO: toLocalISODate(end) };
}

function rangeForCurrentMonthToToday(anchor: Date) {
  const start = startOfLocalDay(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const end = endOfLocalDay(anchor);
  return { start, end, fromISO: toLocalISODate(start), toISO: toLocalISODate(end) };
}

function formatDashboardDateRangeLabel(fromISO: string, toISO: string) {
  const from = parseLocalISODate(fromISO);
  const to = parseLocalISODate(toISO);
  if (!from || !to) return `${fromISO} — ${toISO}`;

  const formatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  if (toLocalISODate(from) === toLocalISODate(to)) return formatter.format(from);
  return `${formatter.format(from)} — ${formatter.format(to)}`;
}

function resolveDashboardOverviewRangeISO(
  fromParam: string | null,
  toParam: string | null,
  fallback: { fromISO: string; toISO: string },
) {
  const parsedFrom = fromParam ? parseLocalISODate(fromParam) : null;
  const parsedTo = toParam ? parseLocalISODate(toParam) : null;

  if (parsedFrom && parsedTo) {
    const start = startOfLocalDay(parsedFrom);
    const end = endOfLocalDay(parsedTo);
    if (end.getTime() < start.getTime()) {
      return { fromISO: toLocalISODate(end), toISO: toLocalISODate(start) };
    }
    return { fromISO: toLocalISODate(start), toISO: toLocalISODate(end) };
  }

  return fallback;
}

type DashboardOverviewPreset = "today" | "last7" | "last30" | "month" | "custom";

export function DashboardOverviewDateFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pickerId = useId();
  const draftFromId = `${pickerId}-from`;
  const draftToId = `${pickerId}-to`;

  const fallbackRange = useMemo(() => rangeForLastNDaysInclusive(7, new Date()), []);

  const computed = useMemo(() => {
    return resolveDashboardOverviewRangeISO(searchParams?.get("from") ?? null, searchParams?.get("to") ?? null, {
      fromISO: fallbackRange.fromISO,
      toISO: fallbackRange.toISO,
    });
  }, [fallbackRange.fromISO, fallbackRange.toISO, searchParams]);

  const rangeLabel = useMemo(
    () => formatDashboardDateRangeLabel(computed.fromISO, computed.toISO),
    [computed.fromISO, computed.toISO],
  );

  const activePreset = useMemo((): DashboardOverviewPreset => {
    const anchor = new Date();
    const today = rangeForLastNDaysInclusive(1, anchor);
    const last7 = rangeForLastNDaysInclusive(7, anchor);
    const last30 = rangeForLastNDaysInclusive(30, anchor);
    const month = rangeForCurrentMonthToToday(anchor);

    const matches = (a: { fromISO: string; toISO: string }) => a.fromISO === computed.fromISO && a.toISO === computed.toISO;
    if (matches(today)) return "today";
    if (matches(last7)) return "last7";
    if (matches(last30)) return "last30";
    if (matches(month)) return "month";
    return "custom";
  }, [computed.fromISO, computed.toISO]);

  const [customFrom, setCustomFrom] = useState(computed.fromISO);
  const [customTo, setCustomTo] = useState(computed.toISO);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(computed.fromISO);
  const [draftTo, setDraftTo] = useState(computed.toISO);

  useEffect(() => {
    if (activePreset === "custom") return;
    setCustomFrom(computed.fromISO);
    setCustomTo(computed.toISO);
  }, [activePreset, computed.fromISO, computed.toISO]);

  useEffect(() => {
    if (!pickerOpen) return;
    setDraftFrom(customFrom);
    setDraftTo(customTo);
  }, [pickerOpen, customFrom, customTo]);

  const applyRange = useCallback(
    (fromISO: string, toISO: string) => {
      const next = new URLSearchParams(searchParams?.toString() ?? "");
      next.set("from", fromISO);
      next.set("to", toISO);
      const qs = next.toString();
      const base = pathname ?? "/";
      router.replace(qs ? `${base}?${qs}` : base, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const onPreset = (preset: Exclude<DashboardOverviewPreset, "custom">) => {
    const anchor = new Date();
    if (preset === "today") {
      const r = rangeForLastNDaysInclusive(1, anchor);
      applyRange(r.fromISO, r.toISO);
      return;
    }
    if (preset === "last7") {
      const r = rangeForLastNDaysInclusive(7, anchor);
      applyRange(r.fromISO, r.toISO);
      return;
    }
    if (preset === "last30") {
      const r = rangeForLastNDaysInclusive(30, anchor);
      applyRange(r.fromISO, r.toISO);
      return;
    }
    const r = rangeForCurrentMonthToToday(anchor);
    applyRange(r.fromISO, r.toISO);
  };

  const applyPresetAndClose = (preset: Exclude<DashboardOverviewPreset, "custom">) => {
    onPreset(preset);
    setPickerOpen(false);
  };

  const applyManualAndClose = () => {
    const fromParsed = parseLocalISODate(draftFrom);
    const toParsed = parseLocalISODate(draftTo);
    if (!fromParsed || !toParsed) return;

    const start = startOfLocalDay(fromParsed);
    const end = endOfLocalDay(toParsed);
    if (end.getTime() < start.getTime()) {
      applyRange(toLocalISODate(end), toLocalISODate(start));
    } else {
      applyRange(toLocalISODate(start), toLocalISODate(end));
    }
    setPickerOpen(false);
  };

  const triggerLabel = useMemo(() => {
    if (activePreset === "today") return "Hoje";
    if (activePreset === "last7") return "Ultimos 7 dias";
    if (activePreset === "last30") return "Ultimos 30 dias";
    if (activePreset === "month") return "Mes atual";
    return rangeLabel;
  }, [activePreset, rangeLabel]);

  const headerPeriodSurface = cn(
    "rounded-xl border border-line bg-surface-elevated/40 text-content-secondary",
    "transition duration-200 ease-out",
    "hover:bg-surface-elevated/60 hover:text-content hover:border-line",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
  );

  return (
    <>
      <button
        type="button"
        className={cn(
          headerPeriodSurface,
          "inline-flex min-h-[44px] max-w-[11rem] cursor-pointer items-center gap-2 px-3 py-2.5 sm:max-w-[13rem]",
        )}
        onClick={() => setPickerOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
        aria-label={`Periodo das metricas: ${triggerLabel}. Abrir para alterar.`}
      >
        <Calendar className="h-4 w-4 shrink-0 text-content-faint" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-left text-sm font-medium text-content-secondary">{triggerLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-content-muted opacity-80" strokeWidth={1.75} aria-hidden />
      </button>

      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Filtrar metricas por data"
        footer={
          <Button type="button" variant="secondary" onClick={() => setPickerOpen(false)}>
            Fechar
          </Button>
        }
      >
        <div className="space-y-5">
          <p className="text-xs leading-relaxed text-content-muted">
            Define o intervalo usado nos indicadores e graficos desta visao geral.
          </p>

          <div className="grid gap-2 sm:grid-cols-3">
            <Button type="button" variant="secondary" onClick={() => applyPresetAndClose("today")}>
              Hoje
            </Button>
            <Button type="button" variant="secondary" onClick={() => applyPresetAndClose("last7")}>
              7 dias
            </Button>
            <Button type="button" variant="secondary" onClick={() => applyPresetAndClose("last30")}>
              30 dias
            </Button>
          </div>

          <div className="rounded-xl border border-line bg-surface-deep/30 p-4">
            <p className="text-sm font-medium text-content">Datas personalizadas</p>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="grid flex-1 gap-1">
                <label className="text-[11px] font-medium text-content-muted" htmlFor={draftFromId}>
                  De
                </label>
                <input
                  id={draftFromId}
                  type="date"
                  value={draftFrom}
                  onChange={(e) => setDraftFrom(e.target.value)}
                  className="h-10 rounded-xl border border-line bg-surface-card px-3 text-sm text-content outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="grid flex-1 gap-1">
                <label className="text-[11px] font-medium text-content-muted" htmlFor={draftToId}>
                  Ate
                </label>
                <input
                  id={draftToId}
                  type="date"
                  value={draftTo}
                  onChange={(e) => setDraftTo(e.target.value)}
                  className="h-10 rounded-xl border border-line bg-surface-card px-3 text-sm text-content outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <Button type="button" onClick={applyManualAndClose}>
                Aplicar
              </Button>
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-content-faint">
            Para compartilhar o mesmo filtro, use na URL <span className="font-mono text-content-muted">from</span> e{" "}
            <span className="font-mono text-content-muted">to</span> em <span className="font-mono text-content-muted">YYYY-MM-DD</span>.
          </p>
        </div>
      </Modal>
    </>
  );
}

function OverviewPage({
  session,
  dataset,
  rangeLabel,
}: {
  session: ClientSession;
  dataset: ReturnType<typeof getDashboardDataset>;
  rangeLabel: string;
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const leadSnap = useLeadUsageSnapshot(session.tenantId, session.plan, session.operationalLimits);
  const baseLeads = planMonthlyLeadAllowance(session.plan, session.operationalLimits);
  const totalLeadCap = baseLeads + leadSnap.bonus;
  const usedLeads = Math.min(leadSnap.used, totalLeadCap);
  const usedShort = formatLeadCount(usedLeads);
  const capShort = formatLeadCount(totalLeadCap);
  const leadUsageProgressPct = totalLeadCap > 0 ? Math.min(100, (usedLeads / totalLeadCap) * 100) : 0;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-surface-card px-5 py-5 sm:px-7 sm:py-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className={cn("inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/[0.08] px-2.5 py-1 text-primary", typography.ui.overline)}>
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-primary/60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
              Visão geral
            </div>
            <h2 className="mt-3 font-display text-2xl font-bold tracking-tight text-content sm:text-[28px]">
              Olá,{" "}
              <span className="text-primary">
                {(session.displayName ?? "").trim().split(/\s+/).filter(Boolean)[0] || "Cliente"}
              </span>
              <span className="text-content">.</span>
            </h2>
            <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-content-muted">
              Aqui estão os resultados do <span className="font-semibold text-content-secondary">{rangeLabel}</span>. Ajuste o período no topo para comparar intervalos diferentes.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden flex-col items-end text-right sm:flex">
              <span className={typography.ui.overline}>Plano</span>
              <span className="mt-0.5 font-display text-sm font-bold tracking-tight text-content">{session.planLabel}</span>
            </div>
            <span className="hidden h-8 w-px bg-line/70 sm:block" aria-hidden />
            <div className="hidden flex-col items-end text-right sm:flex">
              <span className={typography.ui.overline}>Status</span>
              <span className="mt-0.5 inline-flex items-center gap-1.5 font-display text-sm font-bold tracking-tight text-success">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" aria-hidden />
                Online
              </span>
            </div>
          </div>
        </div>
      </section>

      <div
        className="flex flex-wrap items-start gap-3 rounded-xl border border-amber-500/35 bg-amber-500/[0.08] px-4 py-3 text-[13px] text-content-secondary"
        role="status"
      >
        <span className="mt-0.5 flex shrink-0 rounded-lg bg-amber-500/15 p-1.5 text-amber-500" aria-hidden>
          <AlertTriangle className="h-4 w-4" strokeWidth={2} />
        </span>
        <p className="min-w-0 flex-1 leading-relaxed">
          <span className="font-semibold text-content">Dica:</span> mantenha o WhatsApp conectado e acompanhe o limite mensal de leads abaixo para evitar interrupções no atendimento.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_0.9fr]">
        <Panel
          title="Resumo operacional"
          description="Principais resultados do período filtrado no topo — os gráficos abaixo usam o mesmo intervalo."
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {dataset.overviewMetrics.map((metric) => (
              <MetricCard key={metric.label} {...metric} />
            ))}
            <div className="rounded-xl border border-primary/25 bg-primary/[0.06] p-4 sm:col-span-2 sm:p-5 xl:col-span-1">
              <p className={cn("text-primary", typography.ui.overline)}>Leads atendidos (ciclo)</p>
              <p className={cn("mt-2", typography.ui.kpi)}>
                {usedShort}
                <span className="ml-1.5 text-sm font-medium text-content-muted">/ {capShort}</span>
              </p>
              <p className={cn("mt-2 leading-snug", typography.ui.caption)}>
                Contagem mensal do plano. Avisamos perto do limite para evitar pausas no bot.
              </p>
              <div className="mt-3">
                <ProgressBar value={leadUsageProgressPct} />
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Status do bot" description="Controle rapido do modo de atendimento.">
          <div className="space-y-4">
            <div className="rounded-xl border border-success/25 bg-success/[0.08] p-4">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2" aria-hidden>
                  <span className="absolute inset-0 animate-ping rounded-full bg-success/50" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                </span>
                <p className="font-display text-sm font-bold tracking-tight text-success">Online</p>
              </div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-content-muted">
                Respondendo automaticamente com delay humanizado de 2 segundos.
              </p>
            </div>
            <BotStatusToggle value="online" onChange={() => null} />
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel
          title="Conversas por dia"
          className="xl:col-span-2"
          description={`Distribuição diária no intervalo ${rangeLabel}.`}
        >
          <SimulatedBars
            items={dataset.conversationBars}
          />
        </Panel>
        <Panel title="Leads por status no funil" description={`Composição do funil no intervalo ${rangeLabel}.`}>
          <SimulatedBars items={dataset.funnelBars} />
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.9fr_0.9fr]">
        <Panel title="Horários de pico" description={`Volume por dia e faixa de 2 horas (${rangeLabel}).`}>
          <HeatmapEmptyState />
        </Panel>
        <Panel title="Conversas recentes">
          <ul className="space-y-2">
            {dataset.recentConversations.length === 0 ? (
              <li className="rounded-xl border border-dashed border-line/80 bg-surface-deep/30 px-4 py-6 text-center text-[13px] text-content-muted">
                Nenhuma conversa recente neste período.
              </li>
            ) : null}
            {dataset.recentConversations.map(([name, status]) => {
              const initials = name
                .split(" ")
                .map((part) => part.charAt(0))
                .slice(0, 2)
                .join("")
                .toUpperCase();
              return (
                <li
                  key={name}
                  className="group flex items-center gap-3 rounded-xl border border-line/70 bg-surface-card p-3 transition-colors hover:border-line"
                >
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/[0.08] font-display text-[11px] font-bold tracking-tight text-primary"
                  >
                    {initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-semibold tracking-tight text-content">{name}</span>
                      <Badge className="capitalize">{status}</Badge>
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-content-faint">Última interação há 12 minutos</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
        <Panel title="Agenda e alertas">
          <div className="space-y-5">
            <div>
              <p className={typography.ui.overline}>Próximos 3 agendamentos</p>
              <ul className="mt-2 space-y-1.5">
                {dataset.agendaItems.length === 0 ? (
                  <li className="rounded-lg border border-dashed border-line/70 px-3 py-3 text-[12.5px] text-content-muted">
                    Nenhum agendamento listado para este período.
                  </li>
                ) : null}
                {dataset.agendaItems.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2 rounded-lg border border-transparent bg-surface-deep/40 px-3 py-2 text-[12.5px] text-content-secondary transition-all hover:border-line/60 hover:bg-surface-elevated/40"
                  >
                    <span aria-hidden className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span className="min-w-0 flex-1">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className={typography.ui.overline}>Alertas</p>
              <ul className="mt-2 space-y-1.5">
                {dataset.alerts.length === 0 ? (
                  <li className="rounded-lg border border-dashed border-line/70 px-3 py-3 text-[12.5px] text-content-muted">
                    Sem alertas ativos.
                  </li>
                ) : null}
                {dataset.alerts.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[12.5px] text-content-secondary"
                  >
                    <span aria-hidden className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                    <span className="min-w-0 flex-1">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Panel>
      </div>

      <div className="flex flex-wrap justify-end border-t border-line pt-6">
        <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => setExportOpen(true)}>
          Exportações
        </Button>
      </div>

      <Modal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Exportações"
        footer={
          <>
            <Button variant="secondary" type="button" onClick={() => setExportOpen(false)}>
              Fechar
            </Button>
            <Button type="button" onClick={() => setExportOpen(false)}>
              Exportar pacote
            </Button>
          </>
        }
      >
        <p className="text-sm text-content-secondary">
          Período alinhado ao filtro do topo:{" "}
          <span className="font-medium text-content">{rangeLabel}</span>.
        </p>
        <div className="mt-4 space-y-3">
          {dataset.reportRows.map(([name, detail, format]) => (
            <div
              key={name}
              className="flex flex-col gap-3 rounded-xl border border-line bg-surface-card p-4 lg:flex-row lg:items-center lg:justify-between"
            >
              <div>
                <p className="text-sm font-medium text-content">{name}</p>
                <p className="mt-1 text-xs text-content-faint">{detail}</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge className="border-line bg-surface-elevated/50 text-content-secondary">{format}</Badge>
                <Button size="sm" type="button">
                  Exportar
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}


const CRM_KANBAN_COL_PREFIX = "crm-kanban:";
/** Texto exato que o utilizador deve escrever para confirmar apagar um funil. */
const DELETE_FUNNEL_CONFIRM_TEXT = "QUERO APAGAR";

/** Reescreve a ordem dos leads numa coluna do funil (`funilId` + `status`) mantendo o resto da lista na mesma ordem. */
function reorderLeadsForFunnelColumn(
  prev: ClientLead[],
  funilId: string,
  status: string,
  orderedIds: string[],
  leadById: Map<string, ClientLead>,
): ClientLead[] {
  const out: ClientLead[] = [];
  let placed = false;
  for (const l of prev) {
    if (l.funilId !== funilId || l.status !== status) {
      out.push(l);
      continue;
    }
    if (!placed) {
      for (const id of orderedIds) {
        const node = leadById.get(id);
        if (node) out.push(node);
      }
      placed = true;
      continue;
    }
  }
  if (!placed && orderedIds.length) {
    for (const id of orderedIds) {
      const node = leadById.get(id);
      if (node) out.push(node);
    }
  }
  return out;
}

function crmLeadAccentSeed(lead: ClientLead) {
  return `${lead.agenteAtendendo} ${lead.agenteEntrada} ${lead.origem} ${lead.tag}`;
}

function crmLeadCardAccentGradient(seed: string) {
  const t = seed.toLowerCase();
  if (t.includes("imovel") || t.includes("imóvel") || t.includes("duda")) return "from-violet-500 via-fuchsia-500 to-pink-400";
  if (t.includes("veículo") || t.includes("veiculo") || t.includes("max")) return "from-emerald-500 to-teal-400";
  if (t.includes("beleza") || t.includes("luma") || t.includes("estética") || t.includes("estetica"))
    return "from-amber-500 to-orange-500";
  if (t.includes("consultoria") || t.includes("axel")) return "from-[#1a3552] to-[#0e1d2f]";
  if (t.includes("comercial") || t.includes("clara")) return "from-primary via-primary-hover to-amber-500";
  if (t.includes("premium")) return "from-violet-500 via-fuchsia-500 to-pink-400";
  if (t.includes("inbound") || t.includes("quente")) return "from-primary via-primary-hover to-amber-500";
  if (t.includes("whatsapp")) return "from-emerald-500 to-teal-400";
  if (t.includes("b2b")) return "from-[#1a3552] to-[#0e1d2f]";
  if (t.includes("campanha")) return "from-amber-500 to-orange-500";
  return "from-primary via-primary-hover to-[#0e1d2f]";
}

function CrmKanbanColumn({
  columnId,
  title,
  leadCount,
  sortableIds,
  children,
}: {
  columnId: string;
  title: string;
  leadCount: number;
  sortableIds: string[];
  children: ReactNode;
}) {
  const { isLight } = usePanelAppearance();
  const id = `${CRM_KANBAN_COL_PREFIX}${columnId}`;
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "shrink-0 grow-0 rounded-xl border border-line bg-surface-card p-3 transition-[background-color,border-color]",
        /** Largura responsiva: ~5 colunas visíveis na área útil; scroll horizontal se houver mais etapas. */
        "w-[clamp(10.5rem,calc((100%-4rem)/5),19rem)]",
        isOver && "border-primary/50 bg-primary/[0.06]",
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2 px-0.5">
        <p className="min-w-0 truncate text-sm font-semibold tracking-tight text-content">{title}</p>
        <span
          className={cn(
            "inline-flex min-w-8 shrink-0 items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
            isLight
              ? "border border-slate-200/80 bg-surface-deep text-content"
              : "border border-line/60 bg-surface-elevated/50 text-content",
          )}
        >
          {leadCount}
        </span>
      </div>
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <div className="min-h-[4.5rem] space-y-3">{children}</div>
      </SortableContext>
    </div>
  );
}

function CrmKanbanLeadCard({
  lead,
  temperature,
  onOpen,
  lastDragEndedAtRef,
}: {
  lead: ClientLead;
  temperature: LeadTemperatureResult;
  onOpen: (lead: ClientLead) => void;
  lastDragEndedAtRef: MutableRefObject<number>;
}) {
  const { isLight } = usePanelAppearance();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lead.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 40 : undefined,
  };
  const waWebHref = phoneToWhatsAppWebHref(lead.telefone);
  const accentSeed = crmLeadAccentSeed(lead);
  const accentBar = crmLeadCardAccentGradient(accentSeed);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative cursor-grab overflow-hidden rounded-xl border border-line bg-surface-card text-left outline-none active:cursor-grabbing",
        "transition-[border-color,background-color] duration-200 ease-out",
        "hover:border-primary/40",
        "focus-visible:ring-2 focus-visible:ring-primary/30",
        isDragging && "z-40 cursor-grabbing opacity-[0.96] ring-2 ring-primary/35",
      )}
      {...listeners}
      {...attributes}
      onClick={() => {
        if (Date.now() - lastDragEndedAtRef.current < 280) return;
        onOpen(lead);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(lead);
        }
      }}
    >
      <div className={cn("h-1 w-full shrink-0 bg-gradient-to-r", accentBar)} aria-hidden />
      <div className="relative p-3.5 pt-3">
        <div className="relative min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 flex-1 text-sm font-semibold leading-snug tracking-tight text-content">{lead.nome}</p>
            <span
              className={cn(
                "max-w-[min(11rem,46%)] shrink-0 truncate rounded-lg px-2 py-0.5 text-left text-[10px] font-semibold leading-tight tracking-tight",
                isLight ? "bg-primary/12 text-orange-800 ring-1 ring-primary/15" : "bg-primary/20 text-primary ring-1 ring-primary/25",
              )}
              title={`Agente IA a atender: ${lead.agenteAtendendo}`}
            >
              {lead.agenteAtendendo}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-1 text-xs text-content-muted">
            <Building2 className="h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={2} aria-hidden />
            <span className="min-w-0 truncate">{lead.empresa}</span>
          </div>
          <p className="mt-1 truncate text-[11px] leading-tight text-content-faint">{lead.origem}</p>
          <div className="mt-2.5">
            <LeadThermometerBar result={temperature} />
          </div>
        </div>

        <div className="relative mt-3 flex items-end justify-between gap-2 border-t border-line/50 pt-3">
          <div>
            <p className={typography.ui.overline}>Valor</p>
            <p className="mt-0.5 text-base font-bold tabular-nums tracking-tight text-content">{formatBRL(lead.valor)}</p>
          </div>
          <div className="min-w-0 text-right">
            <div className="flex items-center justify-end gap-1 text-[11px] text-content-muted">
              <Clock className="h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={2} aria-hidden />
              <span className="truncate">{lead.ultimoContato}</span>
            </div>
            <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-content-faint">
              <User className="h-3 w-3 shrink-0 opacity-70" strokeWidth={2} aria-hidden />
              <span className="truncate">{lead.responsavel}</span>
            </div>
          </div>
        </div>

        <div className="relative mt-3 flex min-w-0 items-center gap-2 rounded-xl border border-line/50 bg-surface-elevated/[0.06] px-2.5 py-2">
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-content-secondary">{lead.telefone}</span>
          <a
            href={waWebHref}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition",
              isLight
                ? "border-emerald-200/80 bg-emerald-50/80 text-emerald-700 hover:bg-emerald-100"
                : "border-emerald-500/25 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/35",
            )}
            aria-label={`Abrir WhatsApp Web com ${lead.nome}`}
            title="Conversar no WhatsApp Web"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <WhatsAppGlyph className="h-[18px] w-[18px]" />
          </a>
        </div>
      </div>
    </div>
  );
}

function CrmPage({
  dataset,
  session,
}: {
  dataset: ReturnType<typeof getDashboardDataset>;
  session: ClientSession;
}) {
  const { isLight } = usePanelAppearance();
  const { funnels, addFunnel, deleteFunnel, updateFunnel, appendFunnelColumn, removeFunnelColumn } = useCrmFunnels();
  const [view, setView] = useState<"kanban" | "lista">("kanban");
  const [pipelineFunilId, setPipelineFunilId] = useState<string>("");
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<ClientLead | null>(null);
  const [search, setSearch] = useState("");
  const [teamEmployees, setTeamEmployees] = useState<TeamEmployee[]>([]);
  // Initialize with server data to avoid SSR/hydration mismatch.
  // The useEffect below loads persisted localStorage data after mount.
  const [leads, setLeads] = useState<ClientLead[]>(() =>
    dataset.leads.map((l) => ({ ...l })),
  );
  const [newFunnelOpen, setNewFunnelOpen] = useState(false);
  const [newFunnelNome, setNewFunnelNome] = useState("");
  const [newFunnelErr, setNewFunnelErr] = useState("");
  const [deleteFunnelOpen, setDeleteFunnelOpen] = useState(false);
  const [deleteFunnelPhrase, setDeleteFunnelPhrase] = useState("");
  const [deleteFunnelLeadsMode, setDeleteFunnelLeadsMode] = useState<"migrate" | "remove">("migrate");
  const [deleteFunnelMigrateToId, setDeleteFunnelMigrateToId] = useState("");
  const [removeColOpen, setRemoveColOpen] = useState(false);
  const [removeColId, setRemoveColId] = useState("");
  const [renameColOpen, setRenameColOpen] = useState(false);
  const [renameColId, setRenameColId] = useState("");
  const [renameColTitle, setRenameColTitle] = useState("");
  const [renameColErr, setRenameColErr] = useState("");
  const [reorderStagesOpen, setReorderStagesOpen] = useState(false);
  const [crmFiltersOpen, setCrmFiltersOpen] = useState(false);
  const [crmShowMoreFilters, setCrmShowMoreFilters] = useState(false);
  const [crmAppliedFilters, setCrmAppliedFilters] = useState<CrmLeadAppliedFilters>(() => ({
    ...EMPTY_CRM_LEAD_FILTERS,
  }));
  const [crmDraftFilters, setCrmDraftFilters] = useState<CrmLeadAppliedFilters>(() => ({
    ...EMPTY_CRM_LEAD_FILTERS,
  }));

  useEffect(() => {
    setLeads(loadCrmLeadsSnapshot(dataset.tenantId, dataset.leads.map((l) => ({ ...l }))));
    // Intencional: baseline do dataset ao mudar tenant; snapshot local continua se existir.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dataset.leads omitido de propósito
  }, [dataset.tenantId]);

  useEffect(() => {
    void refreshTeamEmployeesFromApi(dataset.tenantId).then(() => setTeamEmployees(loadTeamEmployees(dataset.tenantId)));
  }, [dataset.tenantId]);

  useEffect(() => {
    const on = () => {
      void refreshTeamEmployeesFromApi(dataset.tenantId).then(() => setTeamEmployees(loadTeamEmployees(dataset.tenantId)));
    };
    window.addEventListener(TEAM_EMPLOYEES_UPDATED_EVENT, on);
    return () => window.removeEventListener(TEAM_EMPLOYEES_UPDATED_EVENT, on);
  }, [dataset.tenantId]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      persistCrmLeadsSnapshot(dataset.tenantId, leads);
    }, 400);
    return () => window.clearTimeout(id);
  }, [dataset.tenantId, leads]);

  useEffect(() => {
    if (!funnels.length) return;
    setPipelineFunilId((prev) => (prev && funnels.some((f) => f.id === prev) ? prev : funnels[0]!.id));
  }, [funnels]);

  const activeFunnel = useMemo(
    () => funnels.find((f) => f.id === pipelineFunilId) ?? funnels[0],
    [funnels, pipelineFunilId],
  );

  useEffect(() => {
    setSelectedLead((prev) => {
      if (!prev) return prev;
      return leads.find((l) => l.id === prev.id) ?? null;
    });
  }, [leads]);

  useEffect(() => {
    setCrmAppliedFilters({ ...EMPTY_CRM_LEAD_FILTERS });
    setCrmDraftFilters({ ...EMPTY_CRM_LEAD_FILTERS });
    setCrmShowMoreFilters(false);
  }, [activeFunnel?.id]);

  const lastKanbanDragEndedAtRef = useRef(0);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const markKanbanDragUi = useCallback(() => {
    lastKanbanDragEndedAtRef.current = Date.now();
  }, []);

  const onKanbanDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || !activeFunnel) return;
      const activeId = String(active.id);
      const overId = String(over.id);
      if (activeId === overId) return;

      const fid = activeFunnel.id;
      const allowed = activeFunnel.columns.map((c) => c.id);

      setLeads((prev) => {
        const activeLead = prev.find((l) => l.id === activeId);
        if (!activeLead || activeLead.funilId !== fid) return prev;

        if (overId.startsWith(CRM_KANBAN_COL_PREFIX)) {
          const targetStatus = overId.slice(CRM_KANBAN_COL_PREFIX.length);
          if (!allowed.includes(targetStatus)) return prev;
          if (activeLead.status === targetStatus) return prev;

          queueMicrotask(() => {
            appendCrmTimelineEvent({
              leadId: activeLead.id,
              lead: { ...activeLead, status: targetStatus },
              funnel: activeFunnel,
              item: buildPipelineMoveItem(activeLead.id, activeLead.status, targetStatus, activeFunnel),
            });
          });

          const moved = { ...activeLead, status: targetStatus };
          const rest = prev.filter((l) => l.id !== activeId);
          const byId = new Map(rest.map((l) => [l.id, l]));
          byId.set(moved.id, moved);
          const targetIds = rest.filter((l) => l.funilId === fid && l.status === targetStatus).map((l) => l.id);
          const newIds = [...targetIds, moved.id];
          return reorderLeadsForFunnelColumn(rest, fid, targetStatus, newIds, byId);
        }

        const overLead = prev.find((l) => l.id === overId);
        if (!overLead || overLead.funilId !== fid) return prev;
        const targetStatus = overLead.status;
        if (!allowed.includes(targetStatus)) return prev;

        if (activeLead.status === targetStatus) {
          const colIds = prev.filter((l) => l.funilId === fid && l.status === targetStatus).map((l) => l.id);
          const oldIdx = colIds.indexOf(activeId);
          const newIdx = colIds.indexOf(overId);
          if (oldIdx < 0 || newIdx < 0) return prev;
          const newIds = arrayMove(colIds, oldIdx, newIdx);
          return reorderLeadsForFunnelColumn(prev, fid, targetStatus, newIds, new Map(prev.map((l) => [l.id, l])));
        }

        if (activeLead.status !== targetStatus) {
          queueMicrotask(() => {
            appendCrmTimelineEvent({
              leadId: activeLead.id,
              lead: { ...activeLead, status: targetStatus },
              funnel: activeFunnel,
              item: buildPipelineMoveItem(activeLead.id, activeLead.status, targetStatus, activeFunnel),
            });
          });
        }

        const moved = { ...activeLead, status: targetStatus };
        const rest = prev.filter((l) => l.id !== activeId);
        const byId = new Map(rest.map((l) => [l.id, l]));
        byId.set(moved.id, moved);
        const targetIds = rest.filter((l) => l.funilId === fid && l.status === targetStatus).map((l) => l.id);
        const insertAt = targetIds.indexOf(overId);
        if (insertAt < 0) return prev;
        const newIds = [...targetIds.slice(0, insertAt), moved.id, ...targetIds.slice(insertAt)];
        return reorderLeadsForFunnelColumn(rest, fid, targetStatus, newIds, byId);
      });
    },
    [activeFunnel],
  );

  const searchFiltered = useMemo(
    () =>
      leads.filter((lead) =>
        `${lead.nome} ${lead.empresa} ${lead.tag} ${lead.agenteEntrada} ${lead.agenteAtendendo} ${lead.origem}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [leads, search],
  );

  const scopeFiltered = useMemo(
    () => filterLeadsForSession(session, teamEmployees, searchFiltered),
    [session, teamEmployees, searchFiltered],
  );

  const pipelineBase = useMemo(
    () => (activeFunnel ? scopeFiltered.filter((lead) => lead.funilId === activeFunnel.id) : []),
    [scopeFiltered, activeFunnel],
  );

  const crmFilterOptions = useMemo(() => {
    const responsaveis = new Set<string>();
    const origens = new Set<string>();
    const tags = new Set<string>();
    const agentesIa = new Set<string>();
    for (const lead of pipelineBase) {
      if (lead.responsavel.trim()) responsaveis.add(lead.responsavel);
      if (lead.origem.trim()) origens.add(lead.origem);
      if (lead.tag.trim()) tags.add(lead.tag);
      for (const t of lead.tags) if (t.trim()) tags.add(t);
      if (lead.agenteAtendendo.trim()) agentesIa.add(lead.agenteAtendendo);
    }
    return {
      responsaveis: [...responsaveis].sort((a, b) => a.localeCompare(b, "pt-BR")),
      origens: [...origens].sort((a, b) => a.localeCompare(b, "pt-BR")),
      tags: [...tags].sort((a, b) => a.localeCompare(b, "pt-BR")),
      agentesIa: [...agentesIa].sort((a, b) => a.localeCompare(b, "pt-BR")),
    };
  }, [pipelineBase]);

  const pipelineLeads = useMemo(
    () => applyCrmLeadFilters(pipelineBase, crmAppliedFilters),
    [pipelineBase, crmAppliedFilters],
  );

  const [leadTempTick, setLeadTempTick] = useState(0);
  useEffect(() => {
    const fn = () => setLeadTempTick((n) => n + 1);
    window.addEventListener(LEAD_EXTRAS_UPDATED_EVENT, fn);
    return () => window.removeEventListener(LEAD_EXTRAS_UPDATED_EVENT, fn);
  }, []);

  const temperatureByLeadId = useMemo(() => {
    void leadTempTick;
    const store = loadLeadExtras();
    const map: Record<string, LeadTemperatureResult> = {};
    for (const l of pipelineLeads) {
      const fd = funnels.find((f) => f.id === l.funilId) ?? activeFunnel;
      map[l.id] = computeLeadTemperature(l, getLeadTimelineResolved(store, l, fd), fd);
    }
    return map;
  }, [pipelineLeads, funnels, activeFunnel, leadTempTick]);

  const columns = useMemo((): Column<ClientLead>[] => {
    const tempOf = (row: ClientLead) => temperatureByLeadId[row.id]!;
    return [
      {
        key: "termo",
        header: "Temp.",
        className: "w-[6.5rem]",
        render: (row) => <LeadThermometerInline result={tempOf(row)} />,
      },
      {
        key: "nome",
        header: "Lead",
        render: (row) => (
          <span className="font-medium text-content">{row.nome}</span>
        ),
      },
      { key: "empresa", header: "Empresa", render: (row) => row.empresa },
      { key: "origem", header: "Origem", render: (row) => row.origem },
      {
        key: "status",
        header: "Etapa",
        render: (row) => funnelColumnTitle(activeFunnel, row.status),
      },
      { key: "agenteAtendendo", header: "Agente IA", render: (row) => row.agenteAtendendo },
      { key: "responsavel", header: "Responsavel", render: (row) => row.responsavel },
      { key: "valor", header: "Valor", render: (row) => formatBRL(row.valor) },
    ];
  }, [temperatureByLeadId, activeFunnel]);

  const toggleCrmFiltersPanel = useCallback(() => {
    setCrmFiltersOpen((open) => {
      if (!open) setCrmDraftFilters({ ...crmAppliedFilters });
      return !open;
    });
  }, [crmAppliedFilters]);

  const applyCrmDraftFilters = useCallback(() => {
    setCrmAppliedFilters({ ...crmDraftFilters });
  }, [crmDraftFilters]);

  const clearCrmFilters = useCallback(() => {
    setCrmDraftFilters({ ...EMPTY_CRM_LEAD_FILTERS });
    setCrmAppliedFilters({ ...EMPTY_CRM_LEAD_FILTERS });
  }, []);

  const openRemoveColumnModal = useCallback(() => {
    if (!activeFunnel || activeFunnel.columns.length <= 2) return;
    const last = activeFunnel.columns[activeFunnel.columns.length - 1]!;
    setRemoveColId(last.id);
    setRemoveColOpen(true);
  }, [activeFunnel]);

  const openRenameColumnModal = useCallback(() => {
    if (!activeFunnel?.columns.length) return;
    const first = activeFunnel.columns[0]!;
    setRenameColId(first.id);
    setRenameColTitle(first.title);
    setRenameColErr("");
    setRenameColOpen(true);
  }, [activeFunnel]);

  const closeRenameColumnModal = useCallback(() => {
    setRenameColOpen(false);
    setRenameColId("");
    setRenameColTitle("");
    setRenameColErr("");
  }, []);

  const confirmRenameColumn = useCallback(() => {
    if (!activeFunnel || !renameColId) return;
    const trimmed = renameColTitle.trim();
    if (!trimmed) {
      setRenameColErr("Indique um nome para a etapa.");
      return;
    }
    updateFunnel(activeFunnel.id, {
      columns: activeFunnel.columns.map((c) => (c.id === renameColId ? { ...c, title: trimmed } : c)),
    });
    closeRenameColumnModal();
  }, [activeFunnel, closeRenameColumnModal, renameColId, renameColTitle, updateFunnel]);

  const confirmRemoveColumn = useCallback(() => {
    if (!activeFunnel || !removeColId || activeFunnel.columns.length <= 2) return;
    const fallback = activeFunnel.columns.find((c) => c.id !== removeColId)?.id;
    if (!fallback) return;
    const fid = activeFunnel.id;
    setLeads((prev) =>
      prev.map((l) => (l.funilId === fid && l.status === removeColId ? { ...l, status: fallback } : l)),
    );
    removeFunnelColumn(fid, removeColId);
    setRemoveColOpen(false);
    setRemoveColId("");
  }, [activeFunnel, removeColId, removeFunnelColumn]);

  const closeDeleteFunnelModal = useCallback(() => {
    setDeleteFunnelOpen(false);
    setDeleteFunnelPhrase("");
    setDeleteFunnelLeadsMode("migrate");
    setDeleteFunnelMigrateToId("");
  }, []);

  const confirmDeleteFunnel = useCallback(() => {
    if (deleteFunnelPhrase.trim() !== DELETE_FUNNEL_CONFIRM_TEXT) return;
    if (funnels.length <= 1 || !activeFunnel) return;
    const sourceId = activeFunnel.id;

    if (deleteFunnelLeadsMode === "remove") {
      setLeads((prev) => prev.filter((l) => l.funilId !== sourceId));
    } else {
      const targetFunnel = funnels.find((f) => f.id === deleteFunnelMigrateToId && f.id !== sourceId);
      if (!targetFunnel?.columns.length) return;
      setLeads((prev) =>
        prev.map((l) => {
          if (l.funilId !== sourceId) return l;
          return {
            ...l,
            funilId: targetFunnel.id,
            status: normalizeColunaInicialForFunnel(l.status, targetFunnel),
          };
        }),
      );
    }

    deleteFunnel(sourceId);
    closeDeleteFunnelModal();
  }, [
    activeFunnel,
    closeDeleteFunnelModal,
    deleteFunnel,
    deleteFunnelLeadsMode,
    deleteFunnelMigrateToId,
    deleteFunnelPhrase,
    funnels,
  ]);

  const deleteFunnelMigrationTargets = useMemo(
    () => (activeFunnel ? funnels.filter((f) => f.id !== activeFunnel.id) : []),
    [activeFunnel, funnels],
  );

  const canConfirmDeleteFunnel =
    deleteFunnelPhrase.trim() === DELETE_FUNNEL_CONFIRM_TEXT &&
    (deleteFunnelLeadsMode === "remove" ||
      (deleteFunnelLeadsMode === "migrate" &&
        !!deleteFunnelMigrateToId &&
        deleteFunnelMigrationTargets.some((f) => f.id === deleteFunnelMigrateToId)));

  const planNormCrm = normalizeClientPlan(session.plan);
  const maxSalesFunnels = getPlanMaxSalesFunnelsForSession(session);

  const submitNewFunnel = useCallback(() => {
    setNewFunnelErr("");
    const trimmed = newFunnelNome.trim();
    if (!trimmed) {
      setNewFunnelErr("Indique um nome para o funil.");
      return;
    }
    if (funnels.length >= maxSalesFunnels) {
      setNewFunnelErr(
        `Limite do plano: até ${maxSalesFunnels} funis de vendas. Apague ou combine funis existentes, ou faça upgrade em /planos.`,
      );
      return;
    }
    const created = addFunnel(newFunnelNome);
    if (!created) {
      setNewFunnelErr(
        `Não foi possível criar o funil (teto: ${maxSalesFunnels}). Confira o nome ou o número de funis existentes.`,
      );
      return;
    }
    setPipelineFunilId(created.id);
    setNewFunnelNome("");
    setNewFunnelOpen(false);
  }, [addFunnel, newFunnelNome, funnels.length, maxSalesFunnels]);

  const crmSectionCard = cn("min-w-0 rounded-xl border border-line bg-surface-card p-4 sm:p-5");

  const storedLeadCount = leads.length;

  return (
    <div className="space-y-6">
      <div
        className={cn(
          "flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm leading-relaxed sm:flex-row sm:items-center sm:justify-between",
          isLight ? "border-slate-200 bg-surface-deep text-content" : "border-line bg-surface-deep/30 text-content-secondary",
        )}
      >
        <p>
          <span className="font-semibold text-content">Leads no CRM Kanban</span> sem teto mensal por plano (cadastro e integrações).
          <span className="mx-1 text-content-faint" aria-hidden>
            ·
          </span>
          <span className="font-semibold text-content">Funis de vendas:</span> até{" "}
          <span className="font-semibold text-content">{formatIntegerPtBr(maxSalesFunnels)}</span> neste plano — nesta demo há{" "}
          <span className="font-semibold text-content">{funnels.length}</span> funil(is) e{" "}
          <span className="font-semibold text-content">{formatIntegerPtBr(storedLeadCount)}</span> leads no armazenamento local.
        </p>
        <Link
          href="/planos"
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl border border-primary/40 bg-primary/10 px-4 text-sm font-semibold text-primary transition hover:bg-primary/15"
        >
          Ver planos
        </Link>
      </div>
      <Panel
        title="CRM Kanban"
        description="Um funil ativo, vista CRM Kanban ou em lista, ficha 360º do lead e o mesmo pipeline em «Funil e follow-up» nos agentes. Integrações em breve com backend ativo."
        actions={
          <div
            className={cn(
              "inline-flex shrink-0 rounded-xl border border-line p-1",
              "bg-surface-elevated/40",
            )}
            role="group"
            aria-label="Vista do pipeline"
          >
            <button
              type="button"
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                view === "kanban"
                  ? "bg-primary text-white"
                  : "text-content-muted hover:bg-surface-elevated/60 hover:text-content",
              )}
              onClick={() => setView("kanban")}
            >
              CRM Kanban
            </button>
            <button
              type="button"
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                view === "lista"
                  ? "bg-primary text-white"
                  : "text-content-muted hover:bg-surface-elevated/60 hover:text-content",
              )}
              onClick={() => setView("lista")}
            >
              Lista
            </button>
          </div>
        }
      >
        <div className="space-y-5">
          {/* 1 — Filtros e ações sobre leads */}
          <section className={crmSectionCard} aria-labelledby="crm-sec-leads-heading">
            <h3 id="crm-sec-leads-heading" className={cn("mb-3", typography.ui.overline)}>
              Leads neste funil
            </h3>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-12 lg:items-end">
              <div className="min-w-0 sm:col-span-2 lg:col-span-5">
                <label className="text-xs text-content-faint" htmlFor="crm-pipeline-busca">
                  Buscar
                </label>
                <Input
                  id="crm-pipeline-busca"
                  className="mt-1"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Nome, empresa, tag ou origem"
                />
              </div>
              <div className="min-w-0 lg:col-span-3">
                <label className="text-xs text-content-faint" htmlFor="crm-pipeline-tags">
                  Tags
                </label>
                <Select id="crm-pipeline-tags" className="mt-1" defaultValue="todos">
                  <option value="todos">Todas</option>
                  <option value="inbound">Inbound</option>
                  <option value="premium">Premium</option>
                </Select>
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-4 sm:flex-row sm:items-end sm:justify-end lg:justify-end">
                <p className="text-sm tabular-nums text-content-muted sm:mr-auto sm:pt-2">
                  {pipelineLeads.length} {pipelineLeads.length === 1 ? "lead" : "leads"} visíveis
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full shrink-0 gap-1.5 sm:w-auto"
                  type="button"
                  onClick={() => setAddLeadOpen(true)}
                >
                  <Plus className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden />
                  Novo lead
                </Button>
              </div>
            </div>
          </section>

          {/* 2 — Métricas rápidas */}
          {activeFunnel ? (
            <section aria-labelledby="crm-sec-metricas-heading">
              <h3 id="crm-sec-metricas-heading" className="sr-only">
                Métricas do funil
              </h3>
              <CrmInsightsBar
                embedded
                leads={pipelineLeads}
                stageCount={activeFunnel.columns.length}
                funnelName={activeFunnel.nome}
                firstStageId={activeFunnel.columns[0]?.id ?? ""}
              />
            </section>
          ) : null}

          {/* 3 — Funil e etapas (por cima do quadro) */}
          <section className={crmSectionCard} aria-labelledby="crm-sec-funil-heading">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-line/60 pb-3">
              <div className="min-w-0">
                <h3 id="crm-sec-funil-heading" className={typography.ui.overline}>
                  Funil e etapas
                </h3>
                {activeFunnel ? (
                  <p className="mt-1 truncate text-base font-semibold text-content" title={activeFunnel.nome}>
                    {activeFunnel.nome}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-content-muted">Selecione um funil</p>
                )}
              </div>
              {activeFunnel ? (
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    title="Adicionar coluna ao fim do pipeline"
                    onClick={() => appendFunnelColumn(activeFunnel.id)}
                  >
                    <ListPlus className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                    Nova etapa
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    title="Alterar o nome de uma etapa do CRM Kanban"
                    onClick={openRenameColumnModal}
                  >
                    <Pencil className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                    Renomear etapa
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    title="Remover uma coluna (mínimo 2 etapas)"
                    disabled={activeFunnel.columns.length <= 2}
                    onClick={openRemoveColumnModal}
                  >
                    <ListMinus className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                    Remover etapa
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    title="Mudar a ordem das colunas no CRM Kanban"
                    disabled={activeFunnel.columns.length < 2}
                    onClick={() => setReorderStagesOpen(true)}
                  >
                    <ArrowDownUp className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                    Ordenar etapas
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-4">
              <div className="min-w-0 flex-1">
                <label className="text-xs text-content-faint" htmlFor="crm-pipeline-funil">
                  Trocar funil
                </label>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Select
                    id="crm-pipeline-funil"
                    className="min-w-0 flex-1 basis-[min(100%,14rem)]"
                    value={pipelineFunilId}
                    onChange={(event) => setPipelineFunilId(event.target.value)}
                  >
                    {funnels.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nome}
                      </option>
                    ))}
                  </Select>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="shrink-0 gap-1.5"
                    title={
                      funnels.length >= maxSalesFunnels
                        ? `Limite do plano: ${maxSalesFunnels} funis`
                        : "Criar novo funil"
                    }
                    disabled={funnels.length >= maxSalesFunnels}
                    onClick={() => {
                      setNewFunnelErr("");
                      setNewFunnelNome("");
                      setNewFunnelOpen(true);
                    }}
                  >
                    <FolderPlus className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                    <span className="hidden sm:inline">Novo funil</span>
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="shrink-0 gap-1.5 text-rose-500 hover:bg-rose-500/10"
                    title="Apagar funil selecionado"
                    disabled={funnels.length <= 1}
                    onClick={() => {
                      setDeleteFunnelPhrase("");
                      setDeleteFunnelLeadsMode("migrate");
                      const firstOther = funnels.find((f) => f.id !== activeFunnel?.id);
                      setDeleteFunnelMigrateToId(firstOther?.id ?? "");
                      setDeleteFunnelOpen(true);
                    }}
                  >
                    <Trash2 className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                    <span className="hidden sm:inline">Apagar</span>
                  </Button>
                </div>
              </div>
              {activeFunnel ? (
                <p className="text-xs leading-relaxed text-content-muted lg:max-w-[min(100%,22rem)] lg:self-end lg:pb-1 lg:text-right">
                  {activeFunnel.columns.length} etapas · «Ordenar etapas» muda a ordem das colunas. Arraste cartões no quadro
                  ou abra a ficha 360º.
                </p>
              ) : null}
            </div>
          </section>

          {/* 4 — Área de trabalho CRM Kanban / Lista */}
          <section className="min-w-0" aria-labelledby="crm-sec-vista-heading">
            <div className="mb-3 space-y-3 border-b border-line/50 pb-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h3
                  id="crm-sec-vista-heading"
                  className="flex flex-wrap items-center gap-2.5"
                  aria-label={`${view === "kanban" ? "Atendimentos" : "Tabela de leads"}, ${pipelineLeads.length} ${pipelineLeads.length === 1 ? "lead" : "leads"} visíveis`}
                >
                  <span className="text-base font-semibold tracking-tight text-content sm:text-lg">
                    {view === "kanban" ? "Atendimentos" : "Tabela de leads"}
                  </span>
                  <span
                    className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-xl border border-line bg-surface-elevated/50 px-2.5 text-lg font-bold tabular-nums leading-none text-content transition-colors"
                    title={`${pipelineLeads.length} ${pipelineLeads.length === 1 ? "lead" : "leads"}`}
                  >
                    {pipelineLeads.length}
                  </span>
                </h3>
                <div className="flex max-w-full flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
                  <p className="text-xs text-content-muted sm:max-w-[20rem] sm:text-right">
                    {view === "kanban"
                      ? "Arraste entre colunas ou reordene na vertical dentro da mesma etapa."
                      : "Clique numa linha para abrir a ficha 360º."}
                  </p>
                  <button
                    type="button"
                    onClick={toggleCrmFiltersPanel}
                    aria-expanded={crmFiltersOpen}
                    aria-controls="crm-leads-filters-panel"
                    className={cn(
                      "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition",
                      isLight
                        ? "border-primary text-primary hover:bg-primary/[0.08]"
                        : "border-primary/50 text-content-secondary hover:bg-primary/10 hover:text-content",
                    )}
                  >
                    <Filter className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                    {crmFiltersOpen ? "Ocultar filtros" : "Mostrar filtros"}
                    <ChevronDown
                      className={cn("h-4 w-4 shrink-0 transition", crmFiltersOpen && "rotate-180")}
                      aria-hidden
                    />
                  </button>
                </div>
              </div>

              {crmFiltersOpen && activeFunnel ? (
                <div
                  id="crm-leads-filters-panel"
                  className={cn(
                    "rounded-xl border px-3 py-3 sm:px-4 sm:py-3",
                    isLight
                      ? "border-slate-200/80 bg-surface-deep"
                      : "border-line/80 bg-surface-deep/50",
                  )}
                >
                  <p className="mb-2.5 text-[11px] leading-snug text-content-muted sm:hidden">
                    Ajuste os critérios e toque em «Aplicar filtros» para atualizar o quadro.
                  </p>

                  <div className="space-y-2.5">
                    {/* Linha 1: equipe + sem atendente + cliente */}
                    <div className="flex flex-wrap items-end gap-2 sm:gap-3">
                      <div className="w-[min(100%,11.5rem)] shrink-0">
                        <label
                          className={cn(typography.ui.overline, "mb-0.5 block text-content-faint")}
                          htmlFor="crm-filt-atendente"
                        >
                          Atendente
                        </label>
                        <Select
                          id="crm-filt-atendente"
                          className="min-h-9 rounded-lg py-1.5 text-sm"
                          value={crmDraftFilters.atendente}
                          onChange={(e) =>
                            setCrmDraftFilters((d) => ({ ...d, atendente: e.target.value, semAtendente: false }))
                          }
                        >
                          <option value="">Todos</option>
                          {crmFilterOptions.responsaveis.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div
                        className={cn(
                          "flex h-9 shrink-0 items-center gap-2 rounded-lg border px-2.5",
                          isLight ? "border-slate-200/90 bg-slate-50/80" : "border-line bg-surface-deep/80",
                        )}
                        title="Mostrar apenas leads sem responsável definido"
                      >
                        <span className="hidden text-[11px] text-content-muted sm:inline">Sem atend.</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={crmDraftFilters.semAtendente}
                          id="crm-filt-sem-atendente"
                          onClick={() =>
                            setCrmDraftFilters((d) => ({
                              ...d,
                              semAtendente: !d.semAtendente,
                              atendente: !d.semAtendente ? "" : d.atendente,
                            }))
                          }
                          className={cn(
                            "relative h-5 w-9 shrink-0 rounded-full border transition",
                            crmDraftFilters.semAtendente
                              ? "border-primary/40 bg-primary/25"
                              : "border-line bg-surface-deep",
                          )}
                          aria-label="Filtrar apenas leads sem atendente"
                        >
                          <span
                            className={cn(
                              "absolute top-0.5 h-4 w-4 rounded-full bg-content shadow transition",
                              crmDraftFilters.semAtendente ? "left-4" : "left-0.5",
                            )}
                          />
                        </button>
                      </div>
                      <div className="min-w-0 flex-1 basis-[min(100%,16rem)]">
                        <label
                          className={cn(typography.ui.overline, "mb-0.5 block text-content-faint")}
                          htmlFor="crm-filt-cliente"
                        >
                          Cliente
                        </label>
                        <div className="relative">
                          <Search
                            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-faint"
                            aria-hidden
                          />
                          <Input
                            id="crm-filt-cliente"
                            className="min-h-9 rounded-lg py-1.5 pl-9 text-sm"
                            value={crmDraftFilters.clienteText}
                            onChange={(e) => setCrmDraftFilters((d) => ({ ...d, clienteText: e.target.value }))}
                            placeholder="Nome, e-mail, telefone…"
                            autoComplete="off"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Linha 2: origem, tags, validade, termômetro, mídia */}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 lg:gap-x-3">
                      <div className="min-w-0">
                        <label
                          className={cn(typography.ui.overline, "mb-0.5 block text-content-faint")}
                          htmlFor="crm-filt-tipo-midia"
                        >
                          Tipo de mídia
                        </label>
                        <Input
                          id="crm-filt-tipo-midia"
                          className="min-h-9 rounded-lg py-1.5 text-sm"
                          value={crmDraftFilters.tipoMidia}
                          onChange={(e) => setCrmDraftFilters((d) => ({ ...d, tipoMidia: e.target.value }))}
                          placeholder="Etiqueta…"
                          list="crm-filt-tipo-midia-list"
                          autoComplete="off"
                        />
                        <datalist id="crm-filt-tipo-midia-list">
                          {crmFilterOptions.tags.map((t) => (
                            <option key={t} value={t} />
                          ))}
                        </datalist>
                      </div>
                      <div className="min-w-0">
                        <label
                          className={cn(typography.ui.overline, "mb-0.5 block text-content-faint")}
                          htmlFor="crm-filt-marketing"
                        >
                          Marketing
                        </label>
                        <Select
                          id="crm-filt-marketing"
                          className="min-h-9 rounded-lg py-1.5 text-sm"
                          value={crmDraftFilters.marketing}
                          onChange={(e) => setCrmDraftFilters((d) => ({ ...d, marketing: e.target.value }))}
                        >
                          <option value="">Todas as origens</option>
                          {crmFilterOptions.origens.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="min-w-0">
                        <label
                          className={cn(typography.ui.overline, "mb-0.5 block text-content-faint")}
                          htmlFor="crm-filt-tags"
                        >
                          Tags
                        </label>
                        <div className="relative">
                          <Search
                            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-faint"
                            aria-hidden
                          />
                          <Input
                            id="crm-filt-tags"
                            className="min-h-9 rounded-lg py-1.5 pl-9 text-sm"
                            value={crmDraftFilters.tagAtendimento}
                            onChange={(e) => setCrmDraftFilters((d) => ({ ...d, tagAtendimento: e.target.value }))}
                            placeholder="Buscar…"
                            autoComplete="off"
                          />
                        </div>
                      </div>
                      <div className="min-w-0">
                        <label
                          className={cn(typography.ui.overline, "mb-0.5 block text-content-faint")}
                          htmlFor="crm-filt-validade"
                        >
                          Validade
                        </label>
                        <Select
                          id="crm-filt-validade"
                          className="min-h-9 rounded-lg py-1.5 text-sm"
                          value={crmDraftFilters.validade}
                          onChange={(e) =>
                            setCrmDraftFilters((d) => ({
                              ...d,
                              validade: e.target.value as CrmLeadAppliedFilters["validade"],
                            }))
                          }
                        >
                          <option value="todos">Todas</option>
                          <option value="com_proxima">Com próxima ação</option>
                          <option value="sem_proxima">Sem próxima ação</option>
                        </Select>
                      </div>
                      <div className="min-w-0 sm:col-span-1 lg:col-span-1">
                        <label
                          className={cn(typography.ui.overline, "mb-0.5 block text-content-faint")}
                          htmlFor="crm-filt-termometro"
                        >
                          Termômetro
                        </label>
                        <Select
                          id="crm-filt-termometro"
                          className="min-h-9 rounded-lg py-1.5 text-sm"
                          value={crmDraftFilters.termometro}
                          onChange={(e) =>
                            setCrmDraftFilters((d) => ({
                              ...d,
                              termometro: e.target.value as CrmLeadAppliedFilters["termometro"],
                            }))
                          }
                        >
                          <option value="todos">Todos</option>
                          <option value="quente">Quente</option>
                          <option value="morno">Morno</option>
                          <option value="frio">Frio</option>
                        </Select>
                      </div>
                    </div>

                    {/* Etapas: uma linha com scroll */}
                    <div className="min-w-0">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className={cn(typography.ui.overline, "text-content-faint")}>
                          Etapas do funil
                        </span>
                        <span className="text-[10px] text-content-muted" title="Sem seleção = todas as etapas visíveis">
                          {crmDraftFilters.kanbanStages.length
                            ? `${crmDraftFilters.kanbanStages.length} selecionada(s)`
                            : "Todas"}
                        </span>
                      </div>
                      <div
                        className={cn(
                          "flex flex-nowrap gap-1 overflow-x-auto overscroll-x-contain rounded-lg border px-2 py-1.5 [-ms-overflow-style:none] [scrollbar-width:none] touch-pan-x [&::-webkit-scrollbar]:hidden",
                          isLight ? "border-slate-200/80 bg-slate-50/60" : "border-line/80 bg-surface-deep/40",
                        )}
                        title="Sem caixa marcada = todas. Marque uma ou mais etapas para filtrar."
                      >
                        {activeFunnel.columns.map((col) => {
                          const checked = crmDraftFilters.kanbanStages.includes(col.id);
                          return (
                            <label
                              key={col.id}
                              className={cn(
                                "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition",
                                checked
                                  ? "border-primary/45 bg-primary/12 text-content"
                                  : isLight
                                    ? "border-transparent bg-white/80 text-content-muted hover:border-slate-200"
                                    : "border-transparent bg-surface-elevated/30 text-content-muted hover:border-line",
                              )}
                            >
                              <input
                                type="checkbox"
                                className="h-3 w-3 rounded border-line text-primary focus:ring-primary/25"
                                checked={checked}
                                onChange={() =>
                                  setCrmDraftFilters((d) => {
                                    const has = d.kanbanStages.includes(col.id);
                                    const kanbanStages = has
                                      ? d.kanbanStages.filter((x) => x !== col.id)
                                      : [...d.kanbanStages, col.id];
                                    return { ...d, kanbanStages };
                                  })
                                }
                              />
                              {col.title}
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {crmShowMoreFilters ? (
                      <div className="max-w-md">
                        <label
                          className={cn(typography.ui.overline, "mb-0.5 block text-content-faint")}
                          htmlFor="crm-filt-agente-ia"
                        >
                          Agente IA
                        </label>
                        <Select
                          id="crm-filt-agente-ia"
                          className="min-h-9 rounded-lg py-1.5 text-sm"
                          value={crmDraftFilters.agenteIa}
                          onChange={(e) => setCrmDraftFilters((d) => ({ ...d, agenteIa: e.target.value }))}
                        >
                          <option value="">Todos</option>
                          {crmFilterOptions.agentesIa.map((a) => (
                            <option key={a} value={a}>
                              {a}
                            </option>
                          ))}
                        </Select>
                      </div>
                    ) : null}

                    <div
                      className={cn(
                        "rounded-lg border px-2.5 py-2 sm:flex sm:flex-wrap sm:items-end sm:gap-3",
                        isLight
                          ? "border-amber-200/60 bg-amber-50/70"
                          : "border-amber-900/35 bg-amber-950/20",
                      )}
                    >
                      <div className={cn("mb-2 text-amber-400/90 sm:mb-0 sm:mr-1 sm:self-center sm:pt-1", typography.ui.overline)}>
                        Datas
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
                        <div className="min-w-0 sm:max-w-[11rem]">
                          <label
                            className={cn(typography.ui.overline, "mb-0.5 block text-content-faint")}
                            htmlFor="crm-filt-data-campo"
                          >
                            Campo
                          </label>
                          <Select
                            id="crm-filt-data-campo"
                            className="min-h-9 rounded-lg py-1.5 text-sm"
                            value={crmDraftFilters.dataConsiderar}
                            disabled
                          >
                            <option value="entrada">Entrada no CRM Kanban</option>
                          </Select>
                        </div>
                        <div className="min-w-0">
                          <label
                            className={cn(typography.ui.overline, "mb-0.5 block text-content-faint")}
                            htmlFor="crm-filt-periodo-de"
                          >
                            De
                          </label>
                          <Input
                            id="crm-filt-periodo-de"
                            type="date"
                            className="min-h-9 rounded-lg py-1.5 text-sm"
                            value={crmDraftFilters.periodoDe}
                            onChange={(e) => setCrmDraftFilters((d) => ({ ...d, periodoDe: e.target.value }))}
                          />
                        </div>
                        <div className="min-w-0">
                          <label
                            className={cn(typography.ui.overline, "mb-0.5 block text-content-faint")}
                            htmlFor="crm-filt-periodo-ate"
                          >
                            Até
                          </label>
                          <Input
                            id="crm-filt-periodo-ate"
                            type="date"
                            className="min-h-9 rounded-lg py-1.5 text-sm"
                            value={crmDraftFilters.periodoAte}
                            onChange={(e) => setCrmDraftFilters((d) => ({ ...d, periodoAte: e.target.value }))}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center justify-end gap-1.5 border-t border-line/50 pt-2.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 min-h-0 gap-1 rounded-lg px-3 py-1.5 text-xs"
                      onClick={() => setCrmShowMoreFilters((m) => !m)}
                      aria-expanded={crmShowMoreFilters}
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                      Mais filtros
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-9 min-h-0 gap-1 rounded-lg px-3 py-1.5 text-xs"
                      onClick={clearCrmFilters}
                    >
                      <X className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                      Limpar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-9 min-h-0 gap-1 rounded-lg px-4 py-1.5 text-xs font-semibold"
                      onClick={applyCrmDraftFilters}
                    >
                      <Filter className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                      Aplicar
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
            {view === "kanban" ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragEnd={(e) => {
                  markKanbanDragUi();
                  onKanbanDragEnd(e);
                }}
                onDragCancel={markKanbanDragUi}
                autoScroll={{ acceleration: 14, interval: 5 }}
              >
                <div
                  className="flex w-full min-w-0 flex-nowrap gap-4 overflow-x-auto overflow-y-visible pb-3 [-webkit-overflow-scrolling:touch] touch-pan-x"
                  aria-label="Colunas do funil — deslize para o lado para ver todas as etapas"
                >
                  {(activeFunnel?.columns ?? []).map((col) => {
                    const columnLeads = pipelineLeads.filter((lead) => lead.status === col.id);
                    return (
                      <CrmKanbanColumn
                        key={col.id}
                        columnId={col.id}
                        title={col.title}
                        leadCount={columnLeads.length}
                        sortableIds={columnLeads.map((l) => l.id)}
                      >
                        {columnLeads.map((lead) => (
                          <CrmKanbanLeadCard
                            key={lead.id}
                            lead={lead}
                            temperature={temperatureByLeadId[lead.id]!}
                            onOpen={setSelectedLead}
                            lastDragEndedAtRef={lastKanbanDragEndedAtRef}
                          />
                        ))}
                      </CrmKanbanColumn>
                    );
                  })}
                </div>
              </DndContext>
            ) : (
              <div className="min-w-0 overflow-x-auto touch-pan-x">
                <DataTable columns={columns} data={pipelineLeads} rowKey={(row) => row.id} onRowClick={setSelectedLead} />
              </div>
            )}
          </section>
        </div>
      </Panel>

      <Modal
        open={newFunnelOpen}
        onClose={() => {
          setNewFunnelOpen(false);
          setNewFunnelNome("");
          setNewFunnelErr("");
        }}
        title="Novo funil"
        className="max-w-md"
        footer={
          <>
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                setNewFunnelOpen(false);
                setNewFunnelNome("");
                setNewFunnelErr("");
              }}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={submitNewFunnel}>
              Criar funil
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-content-muted">
            O funil nasce com as mesmas etapas do modelo global. Depois pode usar «Nova etapa», «Renomear etapa», «Remover
            etapa» e «Ordenar etapas».
          </p>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-content-faint" htmlFor="crm-novo-funil-nome">
              Nome do funil
            </label>
            <Input
              id="crm-novo-funil-nome"
              value={newFunnelNome}
              onChange={(e) => setNewFunnelNome(e.target.value)}
              placeholder="Ex.: Inbound B2B · Campanha Q2"
              className="mt-1.5"
              autoComplete="off"
            />
          </div>
          {newFunnelErr ? <p className="text-sm text-rose-500">{newFunnelErr}</p> : null}
        </div>
      </Modal>

      <Modal
        open={deleteFunnelOpen && !!activeFunnel && funnels.length > 1}
        onClose={closeDeleteFunnelModal}
        title="Apagar funil"
        className="max-w-lg"
        footer={
          <>
            <Button variant="secondary" type="button" onClick={closeDeleteFunnelModal}>
              Cancelar
            </Button>
            <Button variant="danger" type="button" disabled={!canConfirmDeleteFunnel} onClick={confirmDeleteFunnel}>
              Confirmar e apagar
            </Button>
          </>
        }
      >
        {activeFunnel ? (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-content-muted">
              O funil <span className="font-semibold text-content">{activeFunnel.nome}</span> deixa de existir. Escolha o
              que acontece aos leads que estão só neste funil. Esta ação não pode ser desfeita.
            </p>

            <fieldset className="min-w-0 space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wide text-content-faint">Leads deste funil</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setDeleteFunnelLeadsMode("migrate")}
                  className={cn(
                    "rounded-xl border p-3 text-left text-sm transition",
                    deleteFunnelLeadsMode === "migrate"
                      ? "border-primary bg-primary/8 ring-2 ring-primary/25"
                      : "border-line bg-surface-deep/20 hover:border-line",
                  )}
                >
                  <span className="font-semibold text-content">Mover para outro funil</span>
                  <p className="mt-1 text-xs leading-snug text-content-muted">
                    Os leads passam para o funil que escolher; a etapa é alinhada às colunas desse funil quando possível.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteFunnelLeadsMode("remove")}
                  className={cn(
                    "rounded-xl border p-3 text-left text-sm transition",
                    deleteFunnelLeadsMode === "remove"
                      ? "border-rose-500/50 bg-rose-500/[0.08] ring-2 ring-rose-500/20"
                      : "border-line bg-surface-deep/20 hover:border-line",
                  )}
                >
                  <span className="font-semibold text-content">Apagar leads</span>
                  <p className="mt-1 text-xs leading-snug text-content-muted">
                    Remove do CRM Kanban todos os leads associados apenas a este funil.
                  </p>
                </button>
              </div>
            </fieldset>

            {deleteFunnelLeadsMode === "migrate" ? (
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-content-faint" htmlFor="crm-delete-funil-target">
                  Funil de destino
                </label>
                <Select
                  id="crm-delete-funil-target"
                  className="mt-1.5"
                  value={deleteFunnelMigrateToId}
                  onChange={(e) => setDeleteFunnelMigrateToId(e.target.value)}
                >
                  {deleteFunnelMigrationTargets.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <p className="rounded-lg border border-rose-500/20 bg-rose-500/[0.05] px-3 py-2 text-xs text-content-muted">
                Os leads deste funil serão eliminados da lista. Confirme só se tiver a certeza.
              </p>
            )}

            <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.07] p-3">
              <p className="text-sm font-medium text-content">
                Para confirmar, escreva exatamente{" "}
                <span className="rounded bg-surface-deep/80 px-1.5 py-0.5 font-mono text-xs text-rose-400">
                  {DELETE_FUNNEL_CONFIRM_TEXT}
                </span>{" "}
                no campo abaixo e carregue em «Confirmar e apagar».
              </p>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-content-faint" htmlFor="crm-delete-funil-confirm">
                Confirmação por texto
              </label>
              <Input
                id="crm-delete-funil-confirm"
                value={deleteFunnelPhrase}
                onChange={(e) => setDeleteFunnelPhrase(e.target.value)}
                placeholder={DELETE_FUNNEL_CONFIRM_TEXT}
                className="mt-1.5 font-mono text-sm"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={deleteFunnelPhrase.length > 0 && deleteFunnelPhrase.trim() !== DELETE_FUNNEL_CONFIRM_TEXT}
              />
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={renameColOpen && !!activeFunnel && activeFunnel.columns.length > 0}
        onClose={closeRenameColumnModal}
        title="Renomear etapa"
        className="max-w-md"
        footer={
          <>
            <Button variant="secondary" type="button" onClick={closeRenameColumnModal}>
              Cancelar
            </Button>
            <Button type="button" onClick={confirmRenameColumn} disabled={!renameColTitle.trim()}>
              Guardar nome
            </Button>
          </>
        }
      >
        {activeFunnel ? (
          <div className="space-y-4">
            <p className="text-sm text-content-muted">
              O id interno da coluna mantém-se; só muda o título no CRM Kanban e na lista. Leads nesta etapa não são
              alterados.
            </p>
            <div>
              <label className="text-xs text-content-faint" htmlFor="crm-rename-col-select">
                Etapa
              </label>
              <Select
                id="crm-rename-col-select"
                className="mt-1"
                value={renameColId}
                onChange={(e) => {
                  const id = e.target.value;
                  setRenameColId(id);
                  const col = activeFunnel.columns.find((c) => c.id === id);
                  setRenameColTitle(col?.title ?? "");
                  setRenameColErr("");
                }}
              >
                {activeFunnel.columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-content-faint" htmlFor="crm-rename-col-title">
                Novo nome
              </label>
              <Input
                id="crm-rename-col-title"
                value={renameColTitle}
                onChange={(e) => {
                  setRenameColTitle(e.target.value);
                  setRenameColErr("");
                }}
                placeholder="Nome visível no CRM Kanban"
                className="mt-1.5"
                autoComplete="off"
              />
            </div>
            {renameColErr ? <p className="text-sm text-rose-500">{renameColErr}</p> : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={removeColOpen && !!activeFunnel && activeFunnel.columns.length > 2}
        onClose={() => {
          setRemoveColOpen(false);
          setRemoveColId("");
        }}
        title="Remover etapa"
        className="max-w-md"
        footer={
          <>
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                setRemoveColOpen(false);
                setRemoveColId("");
              }}
            >
              Cancelar
            </Button>
            <Button variant="danger" type="button" onClick={confirmRemoveColumn} disabled={!removeColId}>
              Remover etapa
            </Button>
          </>
        }
      >
        {activeFunnel ? (
          <div className="space-y-4">
            <p className="text-sm text-content-muted">
              Leads nesta etapa passam para outra coluna do mesmo funil. É obrigatório manter pelo menos duas etapas.
            </p>
            <div>
              <label className="text-xs text-content-faint" htmlFor="crm-remove-col-select">
                Etapa a remover
              </label>
              <Select
                id="crm-remove-col-select"
                className="mt-1"
                value={removeColId}
                onChange={(e) => setRemoveColId(e.target.value)}
              >
                {activeFunnel.columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        ) : null}
      </Modal>

      <CrmReorderStagesModal
        open={reorderStagesOpen && !!activeFunnel && activeFunnel.columns.length > 0}
        onClose={() => setReorderStagesOpen(false)}
        columns={activeFunnel?.columns ?? []}
        onApply={(next) => {
          if (activeFunnel) updateFunnel(activeFunnel.id, { columns: next });
        }}
      />

      {selectedLead ? (
        <CrmLeadWorkspaceModal
          lead={selectedLead}
          funnel={activeFunnel}
          allFunnels={funnels}
          onClose={() => setSelectedLead(null)}
          onUpdateLead={(next) => setLeads((prev) => prev.map((l) => (l.id === next.id ? next : l)))}
        />
      ) : null}
      <CrmAddLeadModal
        open={addLeadOpen}
        onClose={() => setAddLeadOpen(false)}
        funilId={activeFunnel?.id ?? pipelineFunilId}
        firstStageId={activeFunnel?.columns[0]?.id ?? "novo"}
        ownerEmployeeId={session.employeeId}
        responsavelLabel={
          session.organizationRole === "owner" || !session.employeeId ? "Equipe" : session.displayName
        }
        onCreate={(lead) => setLeads((prev) => [...prev, lead])}
      />
    </div>
  );
}

type ClientChatbotNotifRow = { id: string; label: string; description: string };

/** Preferencias de alerta do assistente interno (demo: estado em memoria por sessao da pagina). */
const CLIENT_CHATBOT_NOTIFICATION_ROWS: ClientChatbotNotifRow[] = [
  {
    id: "novo_lead",
    label: "Novo lead no CRM Kanban",
    description: "Aviso imediato quando entrar um contacto novo no funil.",
  },
  {
    id: "msg_sem_resposta",
    label: "Mensagem sem resposta",
    description: "Quando uma conversa ultrapassa o tempo definido para primeira resposta ou follow-up.",
  },
  {
    id: "bot_offline",
    label: "Assistente ou bot com problema",
    description: "Quando o chatbot, fila ou automacao ficar indisponivel ou com erro repetido.",
  },
  {
    id: "limite_leads_baixo",
    label: "Limite de leads perto do fim",
    description: "Antes de atingir a cota mensal de leads atendidos ou o extra contratado — evita bloquear atendimento e disparos.",
  },
  {
    id: "pagamento_fatura",
    label: "Pagamento e faturas",
    description: "Confirmacao de pagamento, falha de cobranca, nota fiscal disponivel ou cartao a expirar.",
  },
  {
    id: "agenda_novo",
    label: "Agenda e reunioes",
    description: "Novo evento, alteracao de horario, convite aceite ou lembrete X minutos antes.",
  },
  {
    id: "lead_etapa_critica",
    label: "Lead em etapa critica",
    description: "Quando o cartao entra em etapa de decisao, ganho, perda ou estagna ha muito tempo.",
  },
  {
    id: "disparo_resultado",
    label: "Disparo em massa",
    description: "Campanha concluida, pausada, taxa de entrega baixa ou bloqueios de canal.",
  },
  {
    id: "resumo_periodico",
    label: "Resumo periodico",
    description: "Digest diario ou semanal com leads, conversas e metricas que mais importam para si.",
  },
  {
    id: "integracao_falhou",
    label: "Integracao com aviso",
    description: "Google Agenda, CRM externo, e-mail ou WhatsApp API com credencial a expirar ou ligacao caída.",
  },
  {
    id: "tarefa_followup",
    label: "Tarefas e lembretes",
    description: "Tarefa a vencer, atrasada ou lembrete recorrente que criou no CRM Kanban ou na agenda.",
  },
  {
    id: "equipa_comentario",
    label: "Atividade da equipa",
    description: "Novo comentario, mencao ou atribuicao num lead ou oportunidade.",
  },
  {
    id: "whatsapp_qualidade",
    label: "Saude do canal WhatsApp",
    description: "Alertas de qualidade ou limites da Meta (templates, numero, opt-in).",
  },
  {
    id: "limite_plano",
    label: "Limites do plano",
    description: "Ao aproximar-se do teto de numeros, agentes, armazenamento ou recursos do pacote.",
  },
  {
    id: "suporte_ticket",
    label: "Suporte e atualizacoes",
    description: "Resposta do suporte, mudanca de estado do ticket ou aviso de manutencao programada.",
  },
  {
    id: "seguranca_login",
    label: "Seguranca da conta",
    description: "Novo dispositivo, palavra-passe alterada ou tentativa de acesso suspeita.",
  },
];

function defaultChatbotNotifPrefs(): Record<string, boolean> {
  return Object.fromEntries(CLIENT_CHATBOT_NOTIFICATION_ROWS.map((row) => [row.id, true]));
}

/** Icones Lucide por aba — alinhado ao menu lateral (monocromatico, minimal). */
const CONFIG_TAB_ICON: Record<string, LucideIcon> = {
  "Minha Conta": User,
  "Plano e Cobranca": CreditCard,
  Notificacoes: Bell,
  Seguranca: Shield,
};

const planosCtaClassName =
  "inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-gradient-primary px-4 text-center text-sm font-medium text-white transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card sm:w-auto";

function PlanLeadsBilling({ session }: { session: ClientSession }) {
  const [offerMode, setOfferMode] = useState<"plans" | "extraLeads" | null>(null);
  const plansOfferTriggerRef = useRef<HTMLButtonElement>(null);
  const extraLeadsOfferTriggerRef = useRef<HTMLButtonElement>(null);

  const leadSnap = useLeadUsageSnapshot(session.tenantId, session.plan, session.operationalLimits);

  const planLeadsBase = planMonthlyLeadAllowance(session.plan, session.operationalLimits);
  const totalLeadCap = planLeadsBase + leadSnap.bonus;
  const usedClamped = Math.min(leadSnap.used, totalLeadCap);
  const remainingLeads = Math.max(0, totalLeadCap - usedClamped);
  const pctRemaining = totalLeadCap > 0 ? Math.min(100, (remainingLeads / totalLeadCap) * 100) : 100;

  return (
    <div className="rounded-xl border border-line bg-surface-card p-4 md:p-5">
      <h3 className="text-sm font-semibold text-content">Leads atendidos neste ciclo</h3>
      <p className="mt-1 text-xs text-content-muted">Mesmo contador da barra na lateral e do resumo operacional.</p>
      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface-deep/30 px-3 py-2">
          <dt className={typography.ui.overline}>Restantes</dt>
          <dd className="mt-0.5 text-lg font-semibold tabular-nums text-primary">{formatLeadCount(remainingLeads)}</dd>
        </div>
        <div className="rounded-xl border border-line bg-surface-deep/30 px-3 py-2">
          <dt className={typography.ui.overline}>Limite do ciclo</dt>
          <dd className="mt-0.5 font-medium tabular-nums text-content">{formatLeadCount(totalLeadCap)}</dd>
        </div>
        <div className="sm:col-span-2 rounded-xl border border-line bg-surface-deep/30 px-3 py-2">
          <dt className={typography.ui.overline}>Consumo estimado</dt>
          <dd className="mt-0.5 tabular-nums text-content-secondary">{formatLeadCount(usedClamped)}</dd>
        </div>
      </dl>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-deep ring-1 ring-inset ring-line/40">
        <div className="h-full rounded-full bg-gradient-primary transition-[width] duration-300 ease-out" style={{ width: `${pctRemaining}%` }} />
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          ref={plansOfferTriggerRef}
          aria-expanded={offerMode === "plans"}
          aria-haspopup="dialog"
          onClick={() => setOfferMode((m) => (m === "plans" ? null : "plans"))}
          className={cn(
            "inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl border-2 border-primary/40 bg-surface-deep/25 px-4 text-sm font-medium text-primary transition hover:border-primary/70 hover:bg-primary/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card",
            offerMode === "plans" && "border-primary bg-primary/[0.12] ring-1 ring-primary/25",
          )}
        >
          <Layers className="h-4 w-4 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
          Alterar plano
        </button>
        <button
          type="button"
          ref={extraLeadsOfferTriggerRef}
          aria-expanded={offerMode === "extraLeads"}
          aria-haspopup="dialog"
          onClick={() => setOfferMode((m) => (m === "extraLeads" ? null : "extraLeads"))}
          className={cn(
            "inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-primary px-4 text-sm font-medium text-white transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card",
            offerMode === "extraLeads" && "ring-2 ring-white/35 ring-offset-2 ring-offset-surface-card",
          )}
        >
          <UserPlus className="h-4 w-4 shrink-0 opacity-95" strokeWidth={2} aria-hidden />
          Aumentar limite de leads
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-content-faint">
        Ofertas no balão seguem a mesma grelha comercial de <span className="font-medium text-content-muted">/planos</span> e checkout de demonstração.
      </p>
      <BillingOffersPopover
        mode={offerMode}
        session={session}
        plansTriggerRef={plansOfferTriggerRef}
        extraLeadsTriggerRef={extraLeadsOfferTriggerRef}
        onClose={() => setOfferMode(null)}
      />
    </div>
  );
}

function ConfiguracoesPage({ session }: { session: ClientSession }) {
  const tabs = ["Minha Conta", "Plano e Cobranca", "Notificacoes", "Seguranca"];
  const [activeTab, setActiveTab] = useState(tabs[0]);
  const notificationToggleId = useId();
  const profileUploadId = useId();
  const emailFormBaseId = useId();
  const pwdFormBaseId = useId();
  const phoneFormBaseId = useId();
  const nameFormBaseId = useId();
  const emailPopRef = useRef<HTMLDivElement>(null);
  const passwordPopRef = useRef<HTMLDivElement>(null);
  const phonePopRef = useRef<HTMLDivElement>(null);
  const namePopRef = useRef<HTMLDivElement>(null);
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>(defaultChatbotNotifPrefs);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [emailPopoverOpen, setEmailPopoverOpen] = useState(false);
  const [passwordPopoverOpen, setPasswordPopoverOpen] = useState(false);
  const [emailNew, setEmailNew] = useState("");
  const [emailNew2, setEmailNew2] = useState("");
  const [emailCurrentPass, setEmailCurrentPass] = useState("");
  const [pwdCurrent, setPwdCurrent] = useState("");
  const [pwdNew, setPwdNew] = useState("");
  const [pwdNew2, setPwdNew2] = useState("");
  const [phonePopoverOpen, setPhonePopoverOpen] = useState(false);
  const [phoneNew, setPhoneNew] = useState("");
  const [phoneNew2, setPhoneNew2] = useState("");
  const [phoneCurrentPass, setPhoneCurrentPass] = useState("");
  const [displayPhone, setDisplayPhone] = useState("(62) 99999-1111");
  const [displayName, setDisplayName] = useState(session.displayName);
  const [namePopoverOpen, setNamePopoverOpen] = useState(false);
  const [nameNew, setNameNew] = useState("");
  const [nameCurrentPass, setNameCurrentPass] = useState("");
  const [accountMsg, setAccountMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const { avatar, setInitialsAvatar, setPresetAvatar, setUploadedAvatar } = useDashboardProfileAvatar(session.initials, displayName);

  useEffect(() => {
    if (!emailPopoverOpen && !passwordPopoverOpen && !phonePopoverOpen && !namePopoverOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (emailPopoverOpen && !emailPopRef.current?.contains(t)) setEmailPopoverOpen(false);
      if (passwordPopoverOpen && !passwordPopRef.current?.contains(t)) setPasswordPopoverOpen(false);
      if (phonePopoverOpen && !phonePopRef.current?.contains(t)) setPhonePopoverOpen(false);
      if (namePopoverOpen && !namePopRef.current?.contains(t)) setNamePopoverOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [emailPopoverOpen, passwordPopoverOpen, phonePopoverOpen, namePopoverOpen]);

  const openEmailPopover = () => {
    setPasswordPopoverOpen(false);
    setPhonePopoverOpen(false);
    setNamePopoverOpen(false);
    setEmailNew("");
    setEmailNew2("");
    setEmailCurrentPass("");
    setAccountMsg(null);
    setEmailPopoverOpen(true);
  };

  const openPasswordPopover = () => {
    setEmailPopoverOpen(false);
    setPhonePopoverOpen(false);
    setNamePopoverOpen(false);
    setPwdCurrent("");
    setPwdNew("");
    setPwdNew2("");
    setAccountMsg(null);
    setPasswordPopoverOpen(true);
  };

  const openPhonePopover = () => {
    setEmailPopoverOpen(false);
    setPasswordPopoverOpen(false);
    setNamePopoverOpen(false);
    setPhoneNew("");
    setPhoneNew2("");
    setPhoneCurrentPass("");
    setAccountMsg(null);
    setPhonePopoverOpen(true);
  };

  const openNamePopover = () => {
    setEmailPopoverOpen(false);
    setPasswordPopoverOpen(false);
    setPhonePopoverOpen(false);
    setNameNew(displayName);
    setNameCurrentPass("");
    setAccountMsg(null);
    setNamePopoverOpen(true);
  };

  const submitNameChange = (e: FormEvent) => {
    e.preventDefault();
    if (!nameCurrentPass.trim()) {
      setAccountMsg({ type: "err", text: "Digite a senha atual para alterar o nome." });
      return;
    }
    if (nameCurrentPass !== clientDemoReauthPassword()) {
      setAccountMsg({ type: "err", text: "Senha atual incorreta." });
      return;
    }
    const next = nameNew.trim().replace(/\s+/g, " ");
    if (next.length < 2) {
      setAccountMsg({ type: "err", text: "Use pelo menos 2 caracteres no nome." });
      return;
    }
    if (next === displayName.trim()) {
      setAccountMsg({ type: "err", text: "O nome e igual ao atual." });
      return;
    }
    setDisplayName(next);
    setAccountMsg({ type: "ok", text: "Nome atualizado (simulacao). Em producao sincroniza com a sessao e permissoes." });
    setNamePopoverOpen(false);
    setNameNew("");
    setNameCurrentPass("");
  };

  const onlyPhoneDigits = (s: string) => s.replace(/\D/g, "");

  const submitPhoneChange = (e: FormEvent) => {
    e.preventDefault();
    if (!phoneCurrentPass.trim()) {
      setAccountMsg({ type: "err", text: "Digite a senha atual para alterar o telemovel." });
      return;
    }
    if (phoneCurrentPass !== clientDemoReauthPassword()) {
      setAccountMsg({ type: "err", text: "Senha atual incorreta." });
      return;
    }
    const a = phoneNew.trim();
    const b = phoneNew2.trim();
    if (!a) {
      setAccountMsg({ type: "err", text: "Indique o novo numero." });
      return;
    }
    if (a !== b) {
      setAccountMsg({ type: "err", text: "Os numeros novos nao coincidem." });
      return;
    }
    if (onlyPhoneDigits(a).length < 10) {
      setAccountMsg({ type: "err", text: "Use pelo menos 10 digitos (com DDD)." });
      return;
    }
    if (onlyPhoneDigits(a) === onlyPhoneDigits(displayPhone)) {
      setAccountMsg({ type: "err", text: "O numero novo e igual ao atual." });
      return;
    }
    setDisplayPhone(a);
    setAccountMsg({ type: "ok", text: "Telemovel atualizado (simulacao). Em producao validamos SMS ou chamada de confirmacao." });
    setPhonePopoverOpen(false);
    setPhoneNew("");
    setPhoneNew2("");
    setPhoneCurrentPass("");
  };

  const submitEmailChange = (e: FormEvent) => {
    e.preventDefault();
    if (!emailCurrentPass.trim()) {
      setAccountMsg({ type: "err", text: "Digite a senha atual para alterar o e-mail." });
      return;
    }
    if (emailCurrentPass !== clientDemoReauthPassword()) {
      setAccountMsg({ type: "err", text: "Senha atual incorreta." });
      return;
    }
    const next = emailNew.trim().toLowerCase();
    if (!next || !next.includes("@")) {
      setAccountMsg({ type: "err", text: "Indique um e-mail novo valido." });
      return;
    }
    if (next !== emailNew2.trim().toLowerCase()) {
      setAccountMsg({ type: "err", text: "Os e-mails novos nao coincidem." });
      return;
    }
    if (next === session.email.toLowerCase()) {
      setAccountMsg({ type: "err", text: "O e-mail novo e igual ao atual." });
      return;
    }
    setAccountMsg({ type: "ok", text: "Pedido de alteracao de e-mail registado (simulacao). Em producao enviamos link de confirmacao." });
    setEmailPopoverOpen(false);
    setEmailNew("");
    setEmailNew2("");
    setEmailCurrentPass("");
  };

  const submitPasswordChange = (e: FormEvent) => {
    e.preventDefault();
    if (!pwdCurrent.trim()) {
      setAccountMsg({ type: "err", text: "Digite a senha atual para definir uma nova." });
      return;
    }
    if (pwdCurrent !== clientDemoReauthPassword()) {
      setAccountMsg({ type: "err", text: "Senha atual incorreta." });
      return;
    }
    if (pwdNew.length < 6) {
      setAccountMsg({ type: "err", text: "A nova senha deve ter pelo menos 6 caracteres." });
      return;
    }
    if (pwdNew !== pwdNew2) {
      setAccountMsg({ type: "err", text: "A confirmacao da nova senha nao coincide." });
      return;
    }
    if (pwdNew === pwdCurrent) {
      setAccountMsg({ type: "err", text: "A nova senha deve ser diferente da atual." });
      return;
    }
    setAccountMsg({ type: "ok", text: "Senha atualizada (simulacao). Em producao isto reflete na base de dados." });
    setPasswordPopoverOpen(false);
    setPwdCurrent("");
    setPwdNew("");
    setPwdNew2("");
  };

  const onUploadAvatar: ChangeEventHandler<HTMLInputElement> = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setProfileError("Escolha um arquivo de imagem valido.");
      event.currentTarget.value = "";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setProfileError("A imagem precisa ter no maximo 2MB.");
      event.currentTarget.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        setProfileError("Nao foi possivel carregar a imagem.");
        return;
      }
      setUploadedAvatar(result);
      setProfileError(null);
    };
    reader.onerror = () => setProfileError("Falha ao ler a imagem. Tente novamente.");
    reader.readAsDataURL(file);
    event.currentTarget.value = "";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const TabIcon = CONFIG_TAB_ICON[tab] ?? Settings;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              aria-label={tab}
              className={cn(
                "inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-4 text-sm font-medium",
                activeTab === tab ? "border-primary/30 bg-primary/15 text-primary" : "border-line bg-surface-elevated/50 text-content-secondary",
              )}
            >
              <TabIcon className="h-[18px] w-[18px] shrink-0 stroke-[1.75] opacity-90" aria-hidden />
              <span>{tab}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => {
            setProfileError(null);
            setProfileModalOpen(true);
          }}
          aria-label="Foto e avatar"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-surface-elevated/50 px-4 text-sm font-medium text-content-secondary transition hover:bg-surface-elevated hover:text-content"
        >
          <Camera className="h-[18px] w-[18px] shrink-0 stroke-[1.75] opacity-90" aria-hidden />
          <span>Foto e avatar</span>
        </button>
      </div>

      <Panel title={activeTab}>
        {activeTab === "Minha Conta" ? (
          <div className="space-y-6">
            {accountMsg ? (
              <div
                className={cn(
                  "rounded-xl border px-4 py-3 text-sm",
                  accountMsg.type === "ok"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                    : "border-amber-500/35 bg-amber-500/10 text-amber-200",
                )}
                role="status"
              >
                {accountMsg.text}
              </div>
            ) : null}

            <div className="rounded-xl border border-line bg-surface-card p-4 md:p-5">
              <h3 className="text-sm font-semibold text-content">Nome, telemovel, e-mail e senha</h3>
              <p className="mt-1 text-xs leading-relaxed text-content-muted">
                Tudo nesta caixa e tratado como dado sensivel: cada alteracao pede um passo extra e a <span className="font-medium text-content">senha atual</span>.
              </p>
              {process.env.NEXT_PUBLIC_SHOW_DEMO_LOGIN_HELP === "1" ? (
                <p className="mt-2 text-[11px] text-content-faint">
                  Demo: use a mesma senha de reautenticação configurada para o ambiente (ver{" "}
                  <span className="font-mono text-content-secondary">NEXT_PUBLIC_DEMO_REAUTH_PASSWORD</span> ou o
                  valor por defeito em desenvolvimento).
                </p>
              ) : null}

              <div className="mt-5 space-y-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className={typography.ui.overline}>Nome exibido</p>
                    <p className="mt-1 text-sm font-medium text-content">{displayName}</p>
                  </div>
                  <div className="relative shrink-0" ref={namePopRef}>
                    <Button type="button" variant="secondary" className="min-h-[44px] gap-2" onClick={openNamePopover}>
                      <User className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                      Alterar nome
                    </Button>
                    {namePopoverOpen ? (
                      <form
                        onSubmit={submitNameChange}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={`${nameFormBaseId}-title`}
                        className="absolute left-0 right-0 top-full z-50 mt-2 w-[min(calc(100vw-2rem),22rem)] rounded-xl border border-line bg-surface-card p-4 sm:left-auto sm:right-0"
                      >
                        <p id={`${nameFormBaseId}-title`} className="text-xs font-semibold text-content">
                          Confirmar troca de nome
                        </p>
                        <div className="mt-3 space-y-3">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-content-muted" htmlFor={`${nameFormBaseId}-new`}>
                              Novo nome exibido
                            </label>
                            <Input
                              id={`${nameFormBaseId}-new`}
                              type="text"
                              value={nameNew}
                              onChange={(ev) => setNameNew(ev.target.value)}
                              autoComplete="name"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-content-muted" htmlFor={`${nameFormBaseId}-cur`}>
                              Senha atual
                            </label>
                            <Input
                              id={`${nameFormBaseId}-cur`}
                              type="password"
                              value={nameCurrentPass}
                              onChange={(ev) => setNameCurrentPass(ev.target.value)}
                              autoComplete="current-password"
                            />
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap justify-end gap-2">
                          <Button type="button" variant="ghost" size="sm" onClick={() => setNamePopoverOpen(false)}>
                            Cancelar
                          </Button>
                          <Button type="submit" size="sm">
                            Guardar
                          </Button>
                        </div>
                      </form>
                    ) : null}
                  </div>
                </div>

                <div className="border-t border-line pt-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className={typography.ui.overline}>Telemovel</p>
                      <p className="mt-1 text-sm font-medium text-content">{displayPhone}</p>
                    </div>
                    <div className="relative shrink-0" ref={phonePopRef}>
                      <Button type="button" variant="secondary" className="min-h-[44px] gap-2" onClick={openPhonePopover}>
                        <Phone className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                        Alterar telemovel
                      </Button>
                      {phonePopoverOpen ? (
                        <form
                          onSubmit={submitPhoneChange}
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby={`${phoneFormBaseId}-title`}
                          className="absolute left-0 right-0 top-full z-50 mt-2 w-[min(calc(100vw-2rem),22rem)] rounded-xl border border-line bg-surface-card p-4 sm:left-auto sm:right-0"
                        >
                          <p id={`${phoneFormBaseId}-title`} className="text-xs font-semibold text-content">
                            Confirmar troca de telemovel
                          </p>
                          <div className="mt-3 space-y-3">
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-content-muted" htmlFor={`${phoneFormBaseId}-new`}>
                                Novo numero
                              </label>
                              <Input
                                id={`${phoneFormBaseId}-new`}
                                type="tel"
                                value={phoneNew}
                                onChange={(ev) => setPhoneNew(ev.target.value)}
                                placeholder="(00) 00000-0000"
                                autoComplete="tel"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-content-muted" htmlFor={`${phoneFormBaseId}-new2`}>
                                Repetir novo numero
                              </label>
                              <Input
                                id={`${phoneFormBaseId}-new2`}
                                type="tel"
                                value={phoneNew2}
                                onChange={(ev) => setPhoneNew2(ev.target.value)}
                                autoComplete="tel"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-content-muted" htmlFor={`${phoneFormBaseId}-cur`}>
                                Senha atual
                              </label>
                              <Input
                                id={`${phoneFormBaseId}-cur`}
                                type="password"
                                value={phoneCurrentPass}
                                onChange={(ev) => setPhoneCurrentPass(ev.target.value)}
                                autoComplete="current-password"
                              />
                            </div>
                          </div>
                          <div className="mt-4 flex flex-wrap justify-end gap-2">
                            <Button type="button" variant="ghost" size="sm" onClick={() => setPhonePopoverOpen(false)}>
                              Cancelar
                            </Button>
                            <Button type="submit" size="sm">
                              Guardar
                            </Button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="border-t border-line pt-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className={typography.ui.overline}>E-mail de acesso</p>
                      <p className="mt-1 break-all text-sm font-medium text-content">{session.email}</p>
                    </div>
                    <div className="relative shrink-0" ref={emailPopRef}>
                      <Button type="button" variant="secondary" className="min-h-[44px] gap-2" onClick={openEmailPopover}>
                        <Mail className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                        Alterar e-mail
                      </Button>
                      {emailPopoverOpen ? (
                        <form
                          onSubmit={submitEmailChange}
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby={`${emailFormBaseId}-title`}
                          className="absolute left-0 right-0 top-full z-50 mt-2 w-[min(calc(100vw-2rem),22rem)] rounded-xl border border-line bg-surface-card p-4 sm:left-auto sm:right-0"
                        >
                          <p id={`${emailFormBaseId}-title`} className="text-xs font-semibold text-content">
                            Confirmar troca de e-mail
                          </p>
                          <div className="mt-3 space-y-3">
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-content-muted" htmlFor={`${emailFormBaseId}-new`}>
                                E-mail novo
                              </label>
                              <Input
                                id={`${emailFormBaseId}-new`}
                                type="email"
                                value={emailNew}
                                onChange={(ev) => setEmailNew(ev.target.value)}
                                autoComplete="off"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-content-muted" htmlFor={`${emailFormBaseId}-new2`}>
                                Repetir e-mail novo
                              </label>
                              <Input
                                id={`${emailFormBaseId}-new2`}
                                type="email"
                                value={emailNew2}
                                onChange={(ev) => setEmailNew2(ev.target.value)}
                                autoComplete="off"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-content-muted" htmlFor={`${emailFormBaseId}-cur`}>
                                Senha atual
                              </label>
                              <Input
                                id={`${emailFormBaseId}-cur`}
                                type="password"
                                value={emailCurrentPass}
                                onChange={(ev) => setEmailCurrentPass(ev.target.value)}
                                autoComplete="current-password"
                              />
                            </div>
                          </div>
                          <div className="mt-4 flex flex-wrap justify-end gap-2">
                            <Button type="button" variant="ghost" size="sm" onClick={() => setEmailPopoverOpen(false)}>
                              Cancelar
                            </Button>
                            <Button type="submit" size="sm">
                              Guardar pedido
                            </Button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="border-t border-line pt-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className={typography.ui.overline}>Senha</p>
                      <p className="mt-1 text-sm text-content-muted">••••••••</p>
                      <p className="mt-1 text-[11px] text-content-faint">A última alteração não está disponível neste painel.</p>
                    </div>
                    <div className="relative shrink-0" ref={passwordPopRef}>
                      <Button type="button" variant="secondary" className="min-h-[44px] gap-2" onClick={openPasswordPopover}>
                        <KeyRound className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                        Alterar senha
                      </Button>
                      {passwordPopoverOpen ? (
                        <form
                          onSubmit={submitPasswordChange}
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby={`${pwdFormBaseId}-title`}
                          className="absolute left-0 right-0 top-full z-50 mt-2 w-[min(calc(100vw-2rem),22rem)] rounded-xl border border-line bg-surface-card p-4 sm:left-auto sm:right-0"
                        >
                          <p id={`${pwdFormBaseId}-title`} className="text-xs font-semibold text-content">
                            Definir nova senha
                          </p>
                          <div className="mt-3 space-y-3">
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-content-muted" htmlFor={`${pwdFormBaseId}-cur`}>
                                Senha atual
                              </label>
                              <Input
                                id={`${pwdFormBaseId}-cur`}
                                type="password"
                                value={pwdCurrent}
                                onChange={(ev) => setPwdCurrent(ev.target.value)}
                                autoComplete="current-password"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-content-muted" htmlFor={`${pwdFormBaseId}-new`}>
                                Nova senha
                              </label>
                              <Input
                                id={`${pwdFormBaseId}-new`}
                                type="password"
                                value={pwdNew}
                                onChange={(ev) => setPwdNew(ev.target.value)}
                                autoComplete="new-password"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-content-muted" htmlFor={`${pwdFormBaseId}-new2`}>
                                Confirmar nova senha
                              </label>
                              <Input
                                id={`${pwdFormBaseId}-new2`}
                                type="password"
                                value={pwdNew2}
                                onChange={(ev) => setPwdNew2(ev.target.value)}
                                autoComplete="new-password"
                              />
                            </div>
                          </div>
                          <div className="mt-4 flex flex-wrap justify-end gap-2">
                            <Button type="button" variant="ghost" size="sm" onClick={() => setPasswordPopoverOpen(false)}>
                              Cancelar
                            </Button>
                            <Button type="submit" size="sm">
                              Atualizar senha
                            </Button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        {activeTab === "Plano e Cobranca" ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-primary/20 bg-primary/10 p-4">
              <p className="text-sm text-primary">Plano atual: {session.planLabel}</p>
              <p className="mt-1 text-xs text-content-faint">
                Renovação em 23/05/2026 · Valor mensal:{" "}
                {(() => {
                  const slug = normalizeClientPlan(session.plan);
                  const sp = SALES_PLANS.find((p) => p.slug === slug);
                  if (sp?.priceMonthly != null) return formatBRL(sp.priceMonthly);
                  return "sob consulta (Enterprise)";
                })()}
              </p>
              {normalizeClientPlan(session.plan) !== "enterprise" ? (
                <Link href="/planos" className={cn(planosCtaClassName, "mt-3")}>
                  {normalizeClientPlan(session.plan) === "solo"
                    ? "Ver planos com equipa"
                    : normalizeClientPlan(session.plan) === "equipa"
                      ? "Subir para Escala"
                      : "Explorar Enterprise"}
                </Link>
              ) : (
                <Link href="/planos#especialista" className={cn(planosCtaClassName, "mt-3")}>
                  Agendar reunião comercial
                </Link>
              )}
            </div>
            <PlanLeadsBilling session={session} />
          </div>
        ) : null}
        {activeTab === "Notificacoes" ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-primary/25 bg-primary/[0.07] p-4 text-sm text-content-secondary">
              <p className="font-semibold text-content">Alertas do chatbot interno MyChatCRM</p>
              <p className="mt-2 leading-relaxed">
                E aqui que escolhe o que o <span className="font-medium text-content">assistente interno</span> deve avisar: limite de leads a esgotar, novos leads, agenda,
                disparos, integracoes, seguranca e tudo o que estiver listado abaixo. O mesmo aviso pode aparecer no{" "}
                <span className="font-medium text-content">centro de notificacoes do painel</span>, por e-mail e por WhatsApp — conforme as suas integracoes e
                preferencias de canal (em producao o motor junta tudo numa unica fila inteligivel).
              </p>
              <p className="mt-2 text-xs text-content-faint">
                Demonstracao: os interruptores mudam nesta sessao; persistencia por conta vira com backend.
              </p>
            </div>
            <div className="space-y-3">
              {CLIENT_CHATBOT_NOTIFICATION_ROWS.map((row) => (
                <div key={row.id} className="rounded-xl border border-line bg-surface-card p-3">
                  <Toggle
                    id={`${notificationToggleId}-notif-${row.id}`}
                    checked={notifPrefs[row.id] ?? true}
                    onChange={(next) => setNotifPrefs((prev) => ({ ...prev, [row.id]: next }))}
                    label={row.label}
                    description={row.description}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {activeTab === "Seguranca" ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-surface-card p-4 text-sm text-content-secondary">
              <p className="font-medium text-content">Sessoes ativas</p>
              <ul className="mt-2 space-y-2">
                <li>Chrome macOS · 187.32.20.11 · Agora</li>
                <li>Safari iPhone · 191.55.14.8 · Ontem</li>
              </ul>
            </div>
            <div className="rounded-xl border border-line bg-surface-card p-4 text-sm text-content-secondary">
              <p className="font-medium text-content">Log de acessos</p>
              <ul className="mt-2 space-y-2">
                <li>16/04 09:11 · Chrome · Goiânia</li>
                <li>15/04 18:45 · Safari · Goiânia</li>
              </ul>
            </div>
          </div>
        ) : null}
      </Panel>
      <Modal
        open={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        title="Personalizar perfil"
        footer={
          <>
            <Button variant="secondary" onClick={setInitialsAvatar}>
              Usar iniciais
            </Button>
            <Button onClick={() => setProfileModalOpen(false)}>Concluir</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-surface-deep p-4">
            <p className={typography.ui.overline}>Avatar atual</p>
            <div className="mt-3 flex items-center gap-3">
              <ProfileAvatar avatar={avatar} size={56} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-content">{displayName}</p>
                <p className="text-xs text-content-muted">Foto propria ou avatar da plataforma</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-surface-elevated/30 p-4">
            <p className="text-sm font-semibold text-content">1) Enviar sua foto</p>
            <p className="mt-1 text-xs text-content-muted">Formatos de imagem, ate 2MB.</p>
            <input
              id={profileUploadId}
              type="file"
              accept="image/*"
              onChange={onUploadAvatar}
              className="sr-only"
            />
            <label
              htmlFor={profileUploadId}
              className="mt-3 inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-line px-4 text-sm font-medium text-content-secondary transition hover:bg-surface-elevated hover:text-content"
            >
              Escolher foto
            </label>
            {profileError ? <p className="mt-2 text-xs text-error">{profileError}</p> : null}
          </div>

          <div className="rounded-xl border border-line bg-surface-elevated/30 p-4">
            <p className="text-sm font-semibold text-content">2) Ou escolha um avatar</p>
            <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
              {profileAvatarPresets.map((preset) => {
                const PresetIcon = preset.Icon;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setPresetAvatar(preset.id);
                      setProfileError(null);
                    }}
                    className="group flex flex-col items-center gap-1 rounded-xl border border-line/80 bg-surface-base/60 p-2 transition hover:border-primary/35 hover:bg-surface-elevated/50"
                    aria-label={`Selecionar avatar ${preset.label}`}
                  >
                    <div className={cn("flex h-11 w-11 items-center justify-center rounded-full", preset.className)}>
                      <PresetIcon className="h-5 w-5 text-white/95" strokeWidth={1.85} aria-hidden />
                    </div>
                    <span className="text-[10px] text-content-muted group-hover:text-content">{preset.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function OverviewRouteSuspenseFallback() {
  return (
    <div className="space-y-6" aria-busy={true} aria-label="A carregar relatório">
      <div className="h-36 animate-pulse rounded-xl bg-surface-card/70 ring-1 ring-line/40" />
      <div className="h-14 animate-pulse rounded-xl bg-surface-card/50" />
      <div className="grid gap-4 xl:grid-cols-[1.6fr_0.9fr]">
        <div className="h-80 animate-pulse rounded-xl bg-surface-card/50" />
        <div className="h-80 animate-pulse rounded-xl bg-surface-card/50" />
      </div>
    </div>
  );
}

function DashboardOverviewRoute({
  session,
  dataset,
}: {
  session: ClientSession;
  dataset: DashboardDataset;
}) {
  const searchParams = useSearchParams();
  const fallbackRange = useMemo(() => rangeForLastNDaysInclusive(7, new Date()), []);

  const rangeISO = useMemo(() => {
    return resolveDashboardOverviewRangeISO(searchParams?.get("from") ?? null, searchParams?.get("to") ?? null, {
      fromISO: fallbackRange.fromISO,
      toISO: fallbackRange.toISO,
    });
  }, [fallbackRange.fromISO, fallbackRange.toISO, searchParams]);

  const rangeLabel = useMemo(
    () => formatDashboardDateRangeLabel(rangeISO.fromISO, rangeISO.toISO),
    [rangeISO.fromISO, rangeISO.toISO],
  );

  return <OverviewPage session={session} dataset={dataset} rangeLabel={rangeLabel} />;
}

export function DashboardWorkspace({
  routeKey,
  session,
  serverDataset,
}: {
  routeKey: DashboardRouteKey;
  session: ClientSession;
  serverDataset?: DashboardDataset;
}) {
  const computedDataset = useMemo(() => getDashboardDataset(session), [session]);
  const dataset = serverDataset ?? computedDataset;

  useEffect(() => {
    void refreshTeamEmployeesFromApi(session.tenantId);
  }, [session.tenantId]);

  const content = useMemo(() => {
    switch (routeKey) {
      case "overview":
        return (
          <Suspense fallback={<OverviewRouteSuspenseFallback />}>
            <DashboardOverviewRoute session={session} dataset={dataset} />
          </Suspense>
        );
      case "agentes":
        return <AgentsListSection session={session} />;
      case "conversas":
        return <OperacaoConversasHub session={session} leads={dataset.leads} />;
      case "integracoes-leads":
        return <LeadDistributionHub session={session} />;
      case "colaboradores":
        return <TeamEmployeesHub session={session} />;
      case "crm":
        return <CrmPage dataset={dataset} session={session} />;
      case "agenda":
        return <AgendaHub />;
      case "disparos":
        return (
          <Panel
            title="Disparos WhatsApp em massa"
            description="Segmentacao, mensagem dinamica, janela de envio e telemetria de campanhas."
            className="overflow-hidden"
          >
            <DisparosMassaHub campaignItems={dataset.campaignItems} />
          </Panel>
        );
      case "lembretes":
        return (
          <Panel
            title="Central de lembretes"
            description="Unifica agenda, CRM Kanban, disparos, tarefas e alertas — atualiza em tempo real com o que o cliente faz no painel."
          >
            <LembretesHub dataset={dataset} />
          </Panel>
        );
      case "integracoes":
        return (
          <Panel
            title="Integracoes"
            description="Ligue o WhatsApp e as ferramentas externas em poucos passos — tudo guardado neste navegador ate existir API com OAuth."
          >
            <IntegracoesHub tenantId={session.tenantId} />
          </Panel>
        );
      case "configuracoes":
        return <ConfiguracoesPage session={session} />;
      case "suporte":
        return (
          <Panel
            title="Centro de ajuda"
            description="Mini cursos, perguntas frequentes e abertura de ticket — resolva dúvidas sem sair do painel."
          >
            <SuporteHub supportTickets={dataset.supportTickets} />
          </Panel>
        );
      default:
        return <DashboardOverviewRoute session={session} dataset={dataset} />;
    }
  }, [routeKey, session, dataset]);

  return <div>{content}</div>;
}
