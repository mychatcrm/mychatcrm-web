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
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Bell,
  Calendar,
  Camera,
  ChevronDown,
  CreditCard,
  KeyRound,
  Layers,
  Mail,
  Phone,
  Settings,
  Shield,
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
import { refreshTeamEmployeesFromApi } from "@/lib/team-employees-client-cache";
import {
  getDashboardDataset,
  type DashboardDataset,
  type DashboardRouteKey,
} from "@/lib/dashboard-data";
import { cn, formatBRL } from "@/lib/utils";
import { formatLeadCount, planMonthlyLeadAllowance } from "@/lib/dashboard-lead-usage";
import { useLeadUsageSnapshot } from "@/lib/use-lead-usage-snapshot";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import { ProfileAvatar, profileAvatarPresets, useDashboardProfileAvatar } from "./ProfileAvatar";
import { AgentsListSection } from "./agentes/AgentsHub";
import { OperacaoConversasHub } from "./conversas/OperacaoConversasHub";
import { normalizeClientPlan } from "@/lib/plan-limits";
import { fetchActiveOfferDetailFromApi, fetchActiveOffersFromApi, type ActiveOfferDetail, type ActiveOfferSummary } from "@/lib/crm-active-offers-client";
import { DisparosMassaHub } from "./disparos/DisparosMassaHub";
import { AgendaHub } from "./agenda/AgendaHub";
import { LembretesHub } from "./lembretes/LembretesHub";
import { IntegracoesHub } from "./integrations/IntegracoesHub";
import { SuporteHub } from "./suporte/SuporteHub";
import { BillingOffersPopover } from "./BillingOffersPopover";
import { IntegracoesLeadsHub } from "./lead-rules/IntegracoesLeadsHub";
import { TeamEmployeesHub } from "./equipe/TeamEmployeesHub";
import { BotStatusToggle } from "./BotStatusToggle";
import { DashboardOverviewV2 } from "./overview/DashboardOverviewV2";
import { AtendimentoV2 } from "./conversas/AtendimentoV2";
import { CrmKanbanV2 } from "./crm/CrmKanbanV2";
import { CrmPage } from "./crm/CrmPage";
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
    <section className={cn("panel-surface-card min-w-0 rounded-xl border border-line bg-surface-card p-5 sm:p-6", className)}>
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
    <div className="panel-surface-card panel-kpi-card rounded-xl border border-line bg-surface-card p-4 transition-colors duration-200 hover:border-line">
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
        className="relative h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
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
              className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all duration-500 ease-out"
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
          "inline-flex min-h-9 max-w-[8.75rem] cursor-pointer items-center gap-1.5 px-2 py-1.5 sm:min-h-[44px] sm:max-w-[13rem] sm:gap-2 sm:px-3 sm:py-2.5",
        )}
        onClick={() => setPickerOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
        aria-label={`Periodo das metricas: ${triggerLabel}. Abrir para alterar.`}
      >
        <Calendar className="h-4 w-4 shrink-0 text-content-faint" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-left text-xs font-medium text-content-secondary sm:text-sm">{triggerLabel}</span>
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
  "inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-primary px-4 text-center text-sm font-medium text-white transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card sm:w-auto";

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
        <div className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out" style={{ width: `${pctRemaining}%` }} />
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
            "inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-white transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card",
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

function formatActiveOfferDate(value: string | null) {
  if (!value) return "Data não informada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data não informada";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function ActiveOffersPage() {
  const searchParams = useSearchParams();
  const initialOfferId = searchParams.get("offer");
  const [offers, setOffers] = useState<ActiveOfferSummary[]>([]);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(initialOfferId);
  const [selectedOffer, setSelectedOffer] = useState<ActiveOfferDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchActiveOffersFromApi()
      .then((rows) => {
        if (cancelled) return;
        setOffers(rows);
        setSelectedOfferId((prev) => prev || rows[0]?.id || null);
      })
      .catch(() => {
        if (!cancelled) setError("Não foi possível carregar as ofertas ativas.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedOfferId) {
      setSelectedOffer(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void fetchActiveOfferDetailFromApi(selectedOfferId)
      .then((offer) => {
        if (!cancelled) setSelectedOffer(offer);
      })
      .catch(() => {
        if (!cancelled) setSelectedOffer(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedOfferId]);

  return (
    <Panel
      title="Ofertas ativas"
      description="Agrupe leads selecionados do CRM em uma ação comercial ativa, sem alterar conversas ou mensagens do WhatsApp."
    >
      {error ? (
        <div className="mb-4 rounded-xl border border-rose-500/25 bg-rose-500/[0.08] px-4 py-3 text-sm text-rose-500">
          {error}
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
        <div className="space-y-3">
          {loading ? (
            Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-xl border border-line bg-surface-elevated/40" />
            ))
          ) : offers.length ? (
            offers.map((offer) => (
              <button
                key={offer.id}
                type="button"
                className={cn(
                  "w-full rounded-xl border p-4 text-left transition",
                  selectedOfferId === offer.id
                    ? "border-primary/45 bg-primary/[0.08]"
                    : "border-line bg-surface-card hover:border-primary/30",
                )}
                onClick={() => setSelectedOfferId(offer.id)}
              >
                <p className="font-semibold text-content">{offer.title}</p>
                <p className="mt-1 text-xs text-content-muted">{formatActiveOfferDate(offer.createdAt)}</p>
                <p className="mt-3 text-sm text-content-muted">
                  {offer.leadCount} {offer.leadCount === 1 ? "lead vinculado" : "leads vinculados"}
                </p>
              </button>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-line bg-surface-card p-5 text-sm text-content-muted">
              Nenhuma oferta ativa criada ainda. Selecione leads no CRM e use “Ações em lote”.
            </div>
          )}
        </div>
        <div className="rounded-xl border border-line bg-surface-card p-4">
          {detailLoading ? (
            <div className="space-y-3">
              <div className="h-6 w-64 animate-pulse rounded bg-surface-elevated" />
              <div className="h-20 animate-pulse rounded-xl bg-surface-elevated/60" />
              <div className="h-20 animate-pulse rounded-xl bg-surface-elevated/60" />
            </div>
          ) : selectedOffer ? (
            <div>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-content">{selectedOffer.title}</h3>
                  <p className="mt-1 text-sm text-content-muted">
                    Criada em {formatActiveOfferDate(selectedOffer.createdAt)} · status {selectedOffer.status}
                  </p>
                </div>
                <span className="rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
                  {selectedOffer.leadCount} leads
                </span>
              </div>
              <div className="mt-5 space-y-3">
                {selectedOffer.leads.map((lead) => (
                  <div key={lead.id} className="rounded-xl border border-line bg-surface-elevated/35 p-3">
                    <p className="font-medium text-content">{lead.nome}</p>
                    <p className="mt-1 text-sm text-content-muted">
                      {lead.telefone} · {lead.origem} · {lead.status}
                    </p>
                  </div>
                ))}
                {!selectedOffer.leads.length ? (
                  <p className="rounded-xl border border-dashed border-line p-4 text-sm text-content-muted">
                    Esta oferta ainda não tem leads vinculados.
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-sm text-content-muted">Selecione uma oferta ativa para ver os leads vinculados.</p>
          )}
        </div>
      </div>
    </Panel>
  );
}

type AccountContactSettings = {
  personalPhone: string | null;
  systemNotificationPhone: string | null;
  canManageSystemNotificationPhone: boolean;
};

function formatAccountPhone(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "Não informado";
  const br = digits.startsWith("55") ? digits.slice(2) : digits;
  if (br.length === 11) return `(${br.slice(0, 2)}) ${br.slice(2, 7)}-${br.slice(7)}`;
  if (br.length === 10) return `(${br.slice(0, 2)}) ${br.slice(2, 6)}-${br.slice(6)}`;
  return `+${digits}`;
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
  const [phoneVerificationCode, setPhoneVerificationCode] = useState("");
  const [phoneVerificationCodeError, setPhoneVerificationCodeError] = useState<string | null>(null);
  const [phoneVerificationPending, setPhoneVerificationPending] = useState<{ phone: string; expiresAt: string } | null>(null);
  const [displayPhone, setDisplayPhone] = useState<string | null>(null);
  const [systemNotificationPhone, setSystemNotificationPhone] = useState("");
  const [systemNotificationPhoneDraft, setSystemNotificationPhoneDraft] = useState("");
  const [systemNotificationCode, setSystemNotificationCode] = useState("");
  const [systemNotificationCodeError, setSystemNotificationCodeError] = useState<string | null>(null);
  const [systemNotificationPending, setSystemNotificationPending] = useState<{ phone: string; expiresAt: string } | null>(null);
  const [canManageSystemNotificationPhone, setCanManageSystemNotificationPhone] = useState(false);
  const [contactSettingsLoading, setContactSettingsLoading] = useState(true);
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [notificationPhoneSaving, setNotificationPhoneSaving] = useState(false);
  const [displayName, setDisplayName] = useState(session.displayName);
  const [namePopoverOpen, setNamePopoverOpen] = useState(false);
  const [nameNew, setNameNew] = useState("");
  const [nameCurrentPass, setNameCurrentPass] = useState("");
  const [accountMsg, setAccountMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const { avatar, setInitialsAvatar, setPresetAvatar, setUploadedAvatar } = useDashboardProfileAvatar(session.initials, displayName);

  useEffect(() => {
    let active = true;
    setContactSettingsLoading(true);
    fetch("/api/client/account/contact", { cache: "no-store", credentials: "include" })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as AccountContactSettings | { error?: string } | null;
        if (!active) return;
        if (!res.ok || !data || ("error" in data && data.error)) {
          setAccountMsg({
            type: "err",
            text: (data && "error" in data && data.error) || "Não foi possível carregar os telefones da conta.",
          });
          return;
        }
        const settings = data as AccountContactSettings;
        setDisplayPhone(settings.personalPhone);
        setSystemNotificationPhone(settings.systemNotificationPhone ?? "");
        setSystemNotificationPhoneDraft(settings.systemNotificationPhone ? formatAccountPhone(settings.systemNotificationPhone) : "");
        setCanManageSystemNotificationPhone(Boolean(settings.canManageSystemNotificationPhone));
      })
      .catch(() => {
        if (!active) return;
        setAccountMsg({ type: "err", text: "Não foi possível carregar os telefones da conta." });
      })
      .finally(() => {
        if (active) setContactSettingsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

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
    setPhoneVerificationCode("");
    setPhoneVerificationPending(null);
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

  const onlyPhoneDigits = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");

  const submitPhoneVerificationRequest = async () => {
    if (phoneSaving) return;
    if (!phoneCurrentPass.trim()) {
      setAccountMsg({ type: "err", text: "Digite a senha atual para alterar o telemovel." });
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

    setPhoneSaving(true);
    try {
      const res = await fetch("/api/client/account/contact", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "request_phone_verification",
          phoneType: "personal",
          phone: a,
          currentPassword: phoneCurrentPass,
        }),
      });
      const data = (await res.json().catch(() => null)) as { phone?: string | null; expiresAt?: string; error?: string } | null;
      if (!res.ok) {
        setAccountMsg({ type: "err", text: data?.error || "Não foi possível enviar o código de verificação." });
        return;
      }
      setPhoneVerificationPending({ phone: data?.phone ?? a, expiresAt: data?.expiresAt ?? "" });
      setPhoneVerificationCode("");
      setPhoneVerificationCodeError(null);
      setAccountMsg({ type: "ok", text: "Código enviado pelo agente do sistema para o novo telefone." });
    } catch {
      setAccountMsg({ type: "err", text: "Não foi possível enviar o código de verificação." });
    } finally {
      setPhoneSaving(false);
    }
  };

  const submitPhoneVerificationConfirm = async () => {
    if (phoneSaving) return;
    setPhoneSaving(true);
    try {
      const res = await fetch("/api/client/account/contact", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "confirm_phone_verification",
          phoneType: "personal",
          code: phoneVerificationCode,
        }),
      });
      const data = (await res.json().catch(() => null)) as { personalPhone?: string | null; error?: string } | null;
      if (!res.ok) {
        const message = data?.error || "Não foi possível confirmar o telefone pessoal.";
        setPhoneVerificationCodeError(message);
        setAccountMsg({ type: "err", text: message });
        return;
      }
      setDisplayPhone(data?.personalPhone ?? phoneVerificationPending?.phone ?? null);
      setAccountMsg({ type: "ok", text: "Telefone pessoal confirmado e atualizado com segurança." });
      setPhonePopoverOpen(false);
      setPhoneNew("");
      setPhoneNew2("");
      setPhoneCurrentPass("");
      setPhoneVerificationCode("");
      setPhoneVerificationCodeError(null);
      setPhoneVerificationPending(null);
    } catch {
      setAccountMsg({ type: "err", text: "Não foi possível confirmar o telefone pessoal." });
    } finally {
      setPhoneSaving(false);
    }
  };

  const submitPhoneChange = async (e: FormEvent) => {
    e.preventDefault();
    if (phoneVerificationPending) {
      await submitPhoneVerificationConfirm();
      return;
    }
    await submitPhoneVerificationRequest();
  };

  const submitSystemNotificationPhone = async (e: FormEvent) => {
    e.preventDefault();
    if (notificationPhoneSaving || !canManageSystemNotificationPhone) return;

    setNotificationPhoneSaving(true);
    try {
      if (systemNotificationPending) {
        const res = await fetch("/api/client/account/contact", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            action: "confirm_phone_verification",
            phoneType: "system_notification",
            code: systemNotificationCode,
          }),
        });
        const data = (await res.json().catch(() => null)) as { systemNotificationPhone?: string | null; error?: string } | null;
        if (!res.ok) {
          const message = data?.error || "Não foi possível confirmar o telefone de notificações.";
          setSystemNotificationCodeError(message);
          setAccountMsg({ type: "err", text: message });
          return;
        }
        const next = data?.systemNotificationPhone ?? systemNotificationPending.phone;
        setSystemNotificationPhone(next);
        setSystemNotificationPhoneDraft(next ? formatAccountPhone(next) : "");
        setSystemNotificationCode("");
        setSystemNotificationCodeError(null);
        setSystemNotificationPending(null);
        setAccountMsg({ type: "ok", text: "Telefone de notificações confirmado e atualizado." });
        return;
      }

      const res = await fetch("/api/client/account/contact", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "request_phone_verification",
          phoneType: "system_notification",
          phone: systemNotificationPhoneDraft,
        }),
      });
      const data = (await res.json().catch(() => null)) as { phone?: string | null; expiresAt?: string; error?: string } | null;
      if (!res.ok) {
        setAccountMsg({ type: "err", text: data?.error || "Não foi possível enviar o código de verificação." });
        return;
      }
      setSystemNotificationPending({ phone: data?.phone ?? systemNotificationPhoneDraft, expiresAt: data?.expiresAt ?? "" });
      setSystemNotificationCode("");
      setSystemNotificationCodeError(null);
      setAccountMsg({ type: "ok", text: "Código enviado pelo agente do sistema para o telefone de notificações." });
    } catch {
      setAccountMsg({ type: "err", text: "Não foi possível processar o telefone de notificações." });
    } finally {
      setNotificationPhoneSaving(false);
    }
  };

  const clearSystemNotificationPhone = async () => {
    if (notificationPhoneSaving || !canManageSystemNotificationPhone) return;
    setNotificationPhoneSaving(true);
    try {
      const res = await fetch("/api/client/account/contact", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ systemNotificationPhone: "" }),
      });
      const data = (await res.json().catch(() => null)) as { systemNotificationPhone?: string | null; error?: string } | null;
      if (!res.ok) {
        setAccountMsg({ type: "err", text: data?.error || "Não foi possível limpar o telefone de notificações." });
        return;
      }
      setSystemNotificationPhone("");
      setSystemNotificationPhoneDraft("");
      setSystemNotificationCode("");
      setSystemNotificationCodeError(null);
      setSystemNotificationPending(null);
      setAccountMsg({ type: "ok", text: "Telefone de notificações removido." });
    } catch {
      setAccountMsg({ type: "err", text: "Não foi possível limpar o telefone de notificações." });
    } finally {
      setNotificationPhoneSaving(false);
    }
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
                      <p className="mt-1 text-sm font-medium text-content">
                        {contactSettingsLoading ? "Carregando..." : formatAccountPhone(displayPhone)}
                      </p>
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
                                onChange={(ev) => {
                                  setPhoneNew(ev.target.value);
                                  setPhoneVerificationPending(null);
                                  setPhoneVerificationCode("");
                                  setPhoneVerificationCodeError(null);
                                }}
                                placeholder="(00) 00000-0000"
                                autoComplete="tel"
                                disabled={Boolean(phoneVerificationPending)}
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
                                onChange={(ev) => {
                                  setPhoneNew2(ev.target.value);
                                  setPhoneVerificationPending(null);
                                  setPhoneVerificationCode("");
                                  setPhoneVerificationCodeError(null);
                                }}
                                autoComplete="tel"
                                disabled={Boolean(phoneVerificationPending)}
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
                                disabled={Boolean(phoneVerificationPending)}
                              />
                            </div>
                            {phoneVerificationPending ? (
                              <div className="rounded-lg border border-primary/20 bg-primary/10 p-3">
                                <p className="text-[11px] leading-relaxed text-content-muted">
                                  Enviamos um código para{" "}
                                  <span className="font-medium text-content">{formatAccountPhone(phoneVerificationPending.phone)}</span>.
                                  Digite abaixo para confirmar a troca.
                                </p>
                                <label className="mt-3 block text-xs font-medium text-content-muted" htmlFor={`${phoneFormBaseId}-code`}>
                                  Código recebido
                                </label>
                                <Input
                                  id={`${phoneFormBaseId}-code`}
                                  className={`mt-1 ${phoneVerificationCodeError ? "border-red-500 bg-red-500/10 text-red-700 focus-visible:ring-red-500 dark:text-red-100" : ""}`}
                                  inputMode="numeric"
                                  autoComplete="one-time-code"
                                  value={phoneVerificationCode}
                                  onChange={(ev) => {
                                    setPhoneVerificationCode(ev.target.value.replace(/\D/g, "").slice(0, 6));
                                    setPhoneVerificationCodeError(null);
                                  }}
                                  placeholder="000000"
                                  aria-invalid={Boolean(phoneVerificationCodeError)}
                                  aria-describedby={phoneVerificationCodeError ? `${phoneFormBaseId}-code-error` : undefined}
                                />
                                {phoneVerificationCodeError ? (
                                  <p id={`${phoneFormBaseId}-code-error`} className="mt-2 text-[11px] font-medium text-red-500">
                                    {phoneVerificationCodeError}
                                  </p>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                          <div className="mt-4 flex flex-wrap justify-end gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setPhonePopoverOpen(false);
                                setPhoneVerificationPending(null);
                                setPhoneVerificationCode("");
                                setPhoneVerificationCodeError(null);
                              }}
                            >
                              Cancelar
                            </Button>
                            <Button type="submit" size="sm" disabled={phoneSaving}>
                              {phoneSaving ? "Aguarde..." : phoneVerificationPending ? "Confirmar código" : "Enviar código"}
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

            <form onSubmit={submitSystemNotificationPhone} className="rounded-xl border border-line bg-surface-card p-4 md:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden />
                    <h3 className="text-sm font-semibold text-content">Telefone para notificações do sistema</h3>
                  </div>
                  <p className="mt-2 max-w-3xl text-xs leading-relaxed text-content-muted">
                    Este número recebe avisos operacionais do MyChatCRM, como WhatsApp ou Meta/Facebook conectados,
                    desconectados ou exigindo atenção. Ele não é usado como linha de atendimento dos agentes.
                  </p>
                  <p className="mt-2 text-[11px] text-content-faint">
                    Atual:{" "}
                    <span className="font-medium text-content-secondary">
                      {contactSettingsLoading ? "Carregando..." : formatAccountPhone(systemNotificationPhone)}
                    </span>
                  </p>
                </div>

                <div className="w-full max-w-md space-y-3">
                  <label className="text-xs font-medium text-content-muted" htmlFor="system-notification-phone">
                    Número do responsável pelos alertas
                  </label>
                  <Input
                    id="system-notification-phone"
                    type="tel"
                    value={systemNotificationPhoneDraft}
                    onChange={(ev) => {
                      setSystemNotificationPhoneDraft(ev.target.value);
                      setSystemNotificationPending(null);
                      setSystemNotificationCode("");
                      setSystemNotificationCodeError(null);
                    }}
                    placeholder="(00) 00000-0000"
                    autoComplete="tel"
                    disabled={
                      !canManageSystemNotificationPhone ||
                      contactSettingsLoading ||
                      notificationPhoneSaving ||
                      Boolean(systemNotificationPending)
                    }
                  />
                  {systemNotificationPending ? (
                    <div className="rounded-lg border border-primary/20 bg-primary/10 p-3">
                      <p className="text-[11px] leading-relaxed text-content-muted">
                        O agente do sistema enviou um código para{" "}
                        <span className="font-medium text-content">{formatAccountPhone(systemNotificationPending.phone)}</span>.
                        Confirme para este número receber alertas operacionais.
                      </p>
                      <label className="mt-3 block text-xs font-medium text-content-muted" htmlFor="system-notification-phone-code">
                        Código recebido
                      </label>
                      <Input
                        id="system-notification-phone-code"
                        className={`mt-1 ${systemNotificationCodeError ? "border-red-500 bg-red-500/10 text-red-700 focus-visible:ring-red-500 dark:text-red-100" : ""}`}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={systemNotificationCode}
                        onChange={(ev) => {
                          setSystemNotificationCode(ev.target.value.replace(/\D/g, "").slice(0, 6));
                          setSystemNotificationCodeError(null);
                        }}
                        placeholder="000000"
                        disabled={notificationPhoneSaving}
                        aria-invalid={Boolean(systemNotificationCodeError)}
                        aria-describedby={systemNotificationCodeError ? "system-notification-phone-code-error" : undefined}
                      />
                      {systemNotificationCodeError ? (
                        <p id="system-notification-phone-code-error" className="mt-2 text-[11px] font-medium text-red-500">
                          {systemNotificationCodeError}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {!canManageSystemNotificationPhone ? (
                    <p className="text-[11px] leading-relaxed text-content-faint">
                      Apenas o dono da conta pode alterar o telefone de notificações operacionais.
                    </p>
                  ) : null}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!systemNotificationPhoneDraft || notificationPhoneSaving || contactSettingsLoading}
                      onClick={systemNotificationPending ? () => {
                        setSystemNotificationPending(null);
                        setSystemNotificationCode("");
                        setSystemNotificationCodeError(null);
                      } : clearSystemNotificationPhone}
                    >
                      {systemNotificationPending ? "Trocar número" : "Limpar"}
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={!canManageSystemNotificationPhone || contactSettingsLoading || notificationPhoneSaving}
                    >
                      {notificationPhoneSaving ? "Aguarde..." : systemNotificationPending ? "Confirmar código" : "Enviar código"}
                    </Button>
                  </div>
                </div>
              </div>
            </form>
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

  return (
    <DashboardOverviewV2
      session={session}
      dataset={dataset}
      rangeISO={rangeISO}
      rangeLabel={rangeLabel}
    />
  );
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
        return <AtendimentoV2 session={session} />;
      case "integracoes-leads":
        return <IntegracoesLeadsHub session={session} />;
      case "colaboradores":
        return <TeamEmployeesHub session={session} />;
      case "crm":
        return <CrmPage dataset={dataset} session={session} />;
      case "ofertas-ativas":
        return <ActiveOffersPage />;
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
            title="Integrações"
            description="Ligue WhatsApp, Facebook e outras ferramentas ao seu fluxo de trabalho — passo a passo simples, sem comandos."
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

  // Conversas e Agenda: DashboardShell já renderiza este filho directamente dentro de
  // <main> sem padding (modo full-bleed). Wrapper com 100% × 100% herda o
  // calc(100dvh - 48px) imposto pelo DashboardShell — não usa flex:1 para
  // evitar dependência da cadeia de min-height/flex parents.
  if (routeKey === "conversas" || routeKey === "agenda") {
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 max-w-full flex-col overflow-x-hidden" style={{ height: "100%" }}>
        {content}
      </div>
    );
  }

  return <div className="w-full">{content}</div>;
}
