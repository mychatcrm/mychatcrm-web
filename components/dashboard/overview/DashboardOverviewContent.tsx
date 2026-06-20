"use client";

import { useEffect, useRef, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  AlarmClock,
  Bot,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Globe,
  Headphones,
  MessageCircle,
  Send,
  Target,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
  Wifi,
} from "lucide-react";
import type { ClientSession } from "@/lib/client-auth";
import type {
  DashboardDataset,
  OverviewStats,
  TeamMemberStats,
  WhatsAppInstanceStatus,
} from "@/lib/dashboard-data";
import { useLeadUsageSnapshot } from "@/lib/use-lead-usage-snapshot";
import { formatLeadCount, planMonthlyLeadAllowance } from "@/lib/dashboard-lead-usage";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import { typography } from "@/lib/typography";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { Badge } from "@/components/ui/Badge";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPeakHour(hour: number | null): string {
  if (hour === null) return "—";
  const h1 = String(hour).padStart(2, "0");
  const h2 = String((hour + 2) % 24).padStart(2, "0");
  return `${h1}h–${h2}h`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDayLabel(iso: string): string {
  try {
    const d = new Date(iso + "T12:00:00Z");
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  } catch {
    return iso.slice(5);
  }
}

const PIE_COLORS = ["#f24400", "#6366f1", "#10b981", "#f59e0b", "#3b82f6", "#ec4899"];

const TEMP_COLORS: Record<string, string> = {
  hot: "#f24400",
  warm: "#f59e0b",
  cold: "#6366f1",
  neutral: "#71717a",
};
const TEMP_LABEL: Record<string, string> = {
  hot: "Quente",
  warm: "Morno",
  cold: "Frio",
  neutral: "Neutro",
};
const MODE_LABEL: Record<string, string> = {
  automation: "Automação",
  waiting_human: "Aguardando",
  human: "Humano",
};
const MODE_COLOR: Record<string, string> = {
  automation: "text-success",
  waiting_human: "text-warning",
  human: "text-info",
};

// ---------------------------------------------------------------------------
// Sub-componentes
// ---------------------------------------------------------------------------

function OverviewPanel({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "panel-surface-card rounded-xl border border-line bg-surface-card p-5 sm:p-6",
        className,
      )}
    >
      <div className="mb-4">
        <h3 className={cn(typography.heading.h4, "text-[15px] sm:text-[17px]")}>{title}</h3>
        {description ? (
          <p className="mt-1 text-[12.5px] leading-relaxed text-content-muted">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

type StatCard = {
  label: string;
  value: string;
  icon: React.ElementType;
  helper?: string;
  accent?: "primary" | "success" | "warning" | "error" | "info";
  trend?: "up" | "down" | "neutral";
};

function OverviewStatsCard({ label, value, icon: Icon, helper, accent, trend }: StatCard) {
  const accentCls = {
    primary: "text-primary bg-primary/[0.10] border-primary/20",
    success: "text-success bg-success/[0.10] border-success/20",
    warning: "text-warning bg-warning/[0.10] border-warning/20",
    error: "text-error bg-error/[0.10] border-error/20",
    info: "text-info bg-info/[0.10] border-info/20",
  }[accent ?? "primary"];

  return (
    <div
      className={cn(
        "panel-surface-card panel-kpi-card group relative rounded-xl border border-line bg-surface-card/80 p-4",
        "transition-all duration-300",
        "hover:border-primary/30",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={cn("rounded-lg border p-2", accentCls)}>
          <Icon className="h-4 w-4" strokeWidth={2} />
        </div>
        {trend === "up" && (
          <TrendingUp className="h-3.5 w-3.5 text-success opacity-70" strokeWidth={2} />
        )}
        {trend === "down" && (
          <TrendingDown className="h-3.5 w-3.5 text-error opacity-70" strokeWidth={2} />
        )}
      </div>
      <p
        className={cn(
          typography.ui.kpi,
          "mt-3 font-display text-[22px] font-bold tabular-nums sm:text-[26px]",
          accent === "primary" ? "text-content" : "",
        )}
      >
        {value}
      </p>
      <p className={cn(typography.ui.overline, "mt-1.5 text-[11px]")}>{label}</p>
      {helper ? (
        <p className="mt-1 text-[11px] leading-snug text-content-faint">{helper}</p>
      ) : null}
    </div>
  );
}

function OverviewSkeletonCard() {
  return (
    <div className="panel-surface-card animate-pulse rounded-xl border border-line bg-surface-card p-4">
      <div className="h-8 w-8 rounded-lg bg-surface-elevated/50" />
      <div className="mt-3 h-7 w-20 rounded-md bg-surface-elevated/50" />
      <div className="mt-1.5 h-3 w-28 rounded bg-surface-elevated/40" />
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

function MessagesAreaChart({ data }: { data: OverviewStats["messagesByDay"] }) {
  const { isLight } = usePanelAppearance();

  if (!data.length) {
    return (
      <div
        className={cn(
          "flex h-48 items-center justify-center rounded-xl border border-dashed border-line/80 bg-surface-deep/30 text-center text-[13px] leading-relaxed text-content-muted",
          isLight ? "bg-slate-50 text-slate-600" : null,
        )}
      >
        Sem mensagens neste período.
      </div>
    );
  }

  const displayData = data.map((d) => ({ ...d, date: formatDayLabel(d.date) }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={displayData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="gradInbound" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f24400" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#f24400" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradOutbound" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.30} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.07} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, opacity: 0.5 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, opacity: 0.5 }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <RechartsTooltip
          contentStyle={{
            background: "var(--color-surface-card, #1a1a2e)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "0.75rem",
            fontSize: 12,
          }}
          labelStyle={{ color: "currentColor", marginBottom: 4 }}
          itemStyle={{ color: "currentColor" }}
        />
        <Area
          type="monotone"
          dataKey="inbound"
          name="Recebidas"
          stroke="#f24400"
          strokeWidth={2}
          fill="url(#gradInbound)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
        <Area
          type="monotone"
          dataKey="outbound"
          name="Enviadas"
          stroke="#6366f1"
          strokeWidth={2}
          fill="url(#gradOutbound)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function LeadSourceDonut({ data }: { data: OverviewStats["leadsBySource"] }) {
  const { isLight } = usePanelAppearance();

  if (!data.length) {
    return (
      <div
        className={cn(
          "flex h-40 items-center justify-center rounded-xl border border-dashed border-line/80 bg-surface-deep/30 text-center text-[12.5px] text-content-muted",
          isLight ? "bg-slate-50 text-slate-600" : null,
        )}
      >
        Sem leads neste período.
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width={100} height={100}>
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="source"
            cx="50%"
            cy="50%"
            innerRadius={28}
            outerRadius={46}
            strokeWidth={0}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {data.slice(0, 5).map((item, i) => (
          <li key={item.source} className="flex items-center justify-between gap-2 text-[12px]">
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
              />
              <span className="truncate capitalize text-content-secondary">{item.source}</span>
            </span>
            <span className="tabular-nums font-semibold text-content">{item.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PeakHoursHeatmap({ data }: { data: OverviewStats["peakHourCounts"] }) {
  const { isLight } = usePanelAppearance();
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const hasData = data.some((d) => d.count > 0);

  if (!hasData) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-xl border border-dashed border-line/80 bg-surface-deep/30 px-4 py-8 text-center text-[12.5px] leading-relaxed text-content-muted",
          isLight ? "bg-slate-50 text-slate-600" : null,
        )}
      >
        Sem dados de pico para este período.
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-12 gap-1">
        {data.map(({ hour, count }) => {
          const intensity = maxCount > 0 ? count / maxCount : 0;
          const opacity = Math.max(0.08, intensity * 0.9);
          return (
            <div
              key={hour}
              title={`${String(hour).padStart(2, "0")}h: ${count} msg`}
              className="flex flex-col items-center gap-0.5 rounded"
            >
              <div
                className="w-full rounded"
                style={{
                  height: "22px",
                  background: `rgba(242,68,0,${opacity})`,
                  border: `1px solid rgba(242,68,0,${Math.min(opacity + 0.15, 1)})`,
                }}
              />
              <span className="text-[9px] tabular-nums text-content-faint">
                {String(hour).padStart(2, "0")}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-content-faint">Hora local (0–23h) — volume de mensagens</p>
    </div>
  );
}

function LeadTemperatureBars({ data }: { data: OverviewStats["leadsByTemperature"] }) {
  const { isLight } = usePanelAppearance();

  if (data.length < 3) {
    return (
      <div
        className={cn(
          "rounded-xl border border-dashed border-line/80 bg-surface-deep/30 px-4 py-5 text-center text-[12.5px] text-content-muted",
          isLight ? "bg-slate-50 text-slate-600" : null,
        )}
      >
        A IA ainda não classificou leads suficientes para gerar o gráfico de temperatura.
      </div>
    );
  }

  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <div className="space-y-3">
      {data.map((item) => {
        const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
        const color = TEMP_COLORS[item.temperature] ?? "#71717a";
        const label = TEMP_LABEL[item.temperature] ?? item.temperature;
        return (
          <div key={item.temperature}>
            <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
              <span className="font-medium" style={{ color }}>
                {label}
              </span>
              <span className="tabular-nums font-semibold text-content">
                {item.count} <span className="font-normal text-content-muted">({pct}%)</span>
              </span>
            </div>
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-elevated/70 ring-1 ring-inset ring-line/30">
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${pct}%`, background: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RecentConversationsList({
  items,
}: {
  items: OverviewStats["recentConversations"];
}) {
  if (!items.length) {
    return (
      <p className="rounded-xl border border-dashed border-line/80 bg-surface-deep/30 px-4 py-6 text-center text-[12.5px] text-content-muted">
        Nenhuma conversa ativa no momento.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => {
        const initials = item.name
          ? item.name.split(" ").map((p) => p.charAt(0)).slice(0, 2).join("").toUpperCase()
          : item.phone.slice(-4);
        return (
          <li
            key={item.phone + item.lastAt}
            className="group flex items-center gap-3 rounded-xl border border-line/70 bg-surface-card p-3 transition-colors hover:border-primary/25"
          >
            <span
              aria-hidden
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/[0.08] font-display text-[11px] font-bold tracking-tight text-primary"
            >
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-semibold tracking-tight text-content">
                  {item.name ?? `+${item.phone}`}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-[10.5px] font-semibold",
                    MODE_COLOR[item.mode] ?? "text-content-muted",
                  )}
                >
                  {MODE_LABEL[item.mode] ?? item.mode}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-content-faint">
                {formatDate(item.lastAt)}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function UpcomingAgendaList({
  items,
}: {
  items: OverviewStats["upcomingAgenda"];
}) {
  if (!items.length) {
    return (
      <p className="rounded-lg border border-dashed border-line/70 px-3 py-3 text-[12px] text-content-muted">
        Nenhum agendamento futuro.
      </p>
    );
  }

  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li
          key={item.startAt + item.title}
          className="flex items-start gap-2 rounded-lg border border-transparent bg-surface-deep/40 px-3 py-2 text-[12.5px] text-content-secondary transition-all hover:border-line/60 hover:bg-surface-elevated/40"
        >
          <span aria-hidden className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-content">{item.title}</p>
            {item.attendeeName ? (
              <p className="text-[11px] text-content-muted">{item.attendeeName}</p>
            ) : null}
            <p className="text-[11px] text-content-faint">{formatDate(item.startAt)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyChannelRow({ label, badge }: { label: string; badge: string }) {
  return (
    <div className="flex items-center justify-between pl-9">
      <span className="text-[12px] text-content-muted">{label}</span>
      <span className="text-[11px] font-semibold text-content-muted">{badge}</span>
    </div>
  );
}

function WhatsAppSection({ instances }: { instances: WhatsAppInstanceStatus[] }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2.5">
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-success/25 bg-success/[0.10] text-success"
        >
          <Wifi className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
        <span className="text-[13px] font-semibold text-content">WhatsApp</span>
      </div>
      {instances.length === 0 ? (
        <EmptyChannelRow label="Linha não configurada" badge="Não configurado" />
      ) : (
        <ul className="space-y-1.5 pl-9">
          {instances.map((inst) => {
            const isOpen = inst.connectionState === "open";
            const isConnecting = inst.connectionState === "connecting";
            const phone = inst.waJid?.split("@")[0];
            return (
              <li key={inst.slotIndex} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[12px] text-content">
                  Linha {inst.slotIndex + 1}
                  {phone ? (
                    <span className="text-content-muted"> · ({phone})</span>
                  ) : null}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-[11px] font-semibold",
                    isOpen ? "text-success" : isConnecting ? "text-warning" : "text-error",
                  )}
                >
                  {isOpen ? "Conectado" : isConnecting ? "Conectando" : "Desconectado"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MetaSection({
  status,
}: {
  status: { connected: boolean; pages: Array<{ pageName: string | null }> } | null;
}) {
  const pages = status?.pages ?? [];
  return (
    <div className="mt-3 border-t border-line/50 pt-3">
      <div className="mb-2 flex items-center gap-2.5">
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#1877F2]/25 bg-[#1877F2]/[0.08] text-[#1877F2]"
        >
          <Globe className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
        <span className="text-[13px] font-semibold text-content">Meta Lead Ads</span>
      </div>
      {pages.length === 0 ? (
        <EmptyChannelRow label="Nenhuma página" badge="Não conectado" />
      ) : (
        <ul className="space-y-1.5 pl-9">
          {pages.map((p, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[12px] text-content">
                {p.pageName ?? "Página Meta"}
              </span>
              <span className="shrink-0 text-[11px] font-semibold text-success">Conectado</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TeamOverviewTable({ members }: { members: TeamMemberStats[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-line/50 text-left">
            <th className={cn(typography.ui.overline, "pb-2 font-medium")}>Colaborador</th>
            <th className={cn(typography.ui.overline, "pb-2 text-right font-medium")}>Leads</th>
            <th className={cn(typography.ui.overline, "pb-2 text-right font-medium")}>Ativas</th>
            <th className={cn(typography.ui.overline, "pb-2 text-right font-medium")}>Concluídas</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/30">
          {members.map((m) => (
            <tr key={m.id} className="transition-colors hover:bg-surface-elevated/20">
              <td className="py-2.5 pr-4">
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/[0.10] font-display text-[10px] font-bold text-primary"
                  >
                    {m.nome.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-content">{m.nome}</p>
                    {m.funcao ? (
                      <p className="truncate text-[10.5px] capitalize text-content-muted">{m.funcao}</p>
                    ) : null}
                  </div>
                </div>
              </td>
              <td className="py-2.5 text-right tabular-nums font-semibold text-content">
                {m.leadsCount}
              </td>
              <td className="py-2.5 text-right tabular-nums font-semibold text-info">
                {m.activeConvs}
              </td>
              <td className="py-2.5 text-right tabular-nums font-semibold text-success">
                {m.closedConvs}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function DashboardOverviewContent({
  session,
  dataset,
  rangeISO,
  rangeLabel,
}: {
  session: ClientSession;
  dataset: DashboardDataset;
  rangeISO: { fromISO: string; toISO: string };
  rangeLabel: string;
}) {
  const [stats, setStats] = useState<OverviewStats | null>(dataset.overviewStats ?? null);
  const [loading, setLoading] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [waInstances, setWaInstances] = useState<WhatsAppInstanceStatus[]>([]);
  const [teamStats, setTeamStats] = useState<TeamMemberStats[]>([]);
  const [metaStatus, setMetaStatus] = useState<{ connected: boolean; pages: Array<{ pageName: string | null }> } | null>(null);

  const leadSnap = useLeadUsageSnapshot(session.tenantId, session.plan, session.operationalLimits);
  const baseLeads = planMonthlyLeadAllowance(session.plan, session.operationalLimits);
  const totalLeadCap = baseLeads + leadSnap.bonus;
  const usedLeads = Math.min(leadSnap.used, totalLeadCap);
  const usedShort = formatLeadCount(usedLeads);
  const capShort = formatLeadCount(totalLeadCap);
  const leadUsageProgressPct = totalLeadCap > 0 ? Math.min(100, (usedLeads / totalLeadCap) * 100) : 0;

  // Refetch quando o filtro de data muda
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(
      `/api/client/stats/overview?from=${rangeISO.fromISO}&to=${rangeISO.toISO}`
    )
      .then((r) => (r.ok ? (r.json() as Promise<OverviewStats>) : null))
      .then((data) => {
        if (!cancelled && data) setStats(data);
      })
      .catch(() => {}) // mantém dados anteriores silenciosamente
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rangeISO.fromISO, rangeISO.toISO]);

  // Polling 30s + refetch imediato ao voltar à aba
  const rangeRef = useRef(rangeISO);
  useEffect(() => { rangeRef.current = rangeISO; }, [rangeISO]);
  useEffect(() => {
    const poll = () => {
      if (document.hidden) return;
      const { fromISO, toISO } = rangeRef.current;
      fetch(`/api/client/stats/overview?from=${fromISO}&to=${toISO}`)
        .then((r) => (r.ok ? (r.json() as Promise<OverviewStats>) : null))
        .then((data) => { if (data) setStats(data); })
        .catch(() => {});
    };
    const timer = setInterval(poll, 30_000);
    document.addEventListener("visibilitychange", poll);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
  }, []);

  // WhatsApp instances — 60s polling (podem desconectar a qualquer hora)
  useEffect(() => {
    const fetchWa = () => {
      fetch("/api/client/stats/whatsapp-status")
        .then((r) => (r.ok ? (r.json() as Promise<WhatsAppInstanceStatus[]>) : null))
        .then((data) => { if (data) setWaInstances(data); })
        .catch(() => {});
    };
    fetchWa();
    const timer = setInterval(fetchWa, 60_000);
    return () => clearInterval(timer);
  }, []);

  // Equipe — refetch ao mudar período
  useEffect(() => {
    fetch(`/api/client/stats/team-overview?from=${rangeISO.fromISO}&to=${rangeISO.toISO}`)
      .then((r) => (r.ok ? (r.json() as Promise<TeamMemberStats[]>) : null))
      .then((data) => { if (data) setTeamStats(data); })
      .catch(() => {});
  }, [rangeISO.fromISO, rangeISO.toISO]);

  // Meta — leitura única no mount (status do banco, sem chamada externa)
  useEffect(() => {
    fetch("/api/client/meta/connection-status")
      .then((r) => (r.ok ? (r.json() as Promise<{ connected: boolean; pages: Array<{ pageName: string | null }> }>) : null))
      .then((data) => { if (data) setMetaStatus(data); })
      .catch(() => {});
  }, []);

  // Cards de métricas definidos a partir dos stats reais
  const statCards: StatCard[] = stats
    ? [
        {
          label: "Mensagens trocadas",
          value: stats.totalMessages.toLocaleString("pt-BR"),
          icon: MessageCircle,
          accent: "primary",
        },
        {
          label: "Novos leads",
          value: stats.newLeads.toLocaleString("pt-BR"),
          icon: UserPlus,
          accent: "success",
          trend: stats.newLeads > 0 ? "up" : "neutral",
        },
        {
          label: "Conversas ativas",
          value: stats.activeConversations.toLocaleString("pt-BR"),
          icon: Activity,
          accent: "info",
        },
        {
          label: "Conv. concluídas",
          value: stats.closedConversations.toLocaleString("pt-BR"),
          icon: CheckCircle2,
          accent: "success",
        },
        {
          label: "Transferências",
          value: stats.handoffCount.toLocaleString("pt-BR"),
          icon: Headphones,
          accent: stats.handoffCount > 0 ? "warning" : "primary",
        },
        {
          label: "Taxa de automação",
          value: `${stats.automationRate}%`,
          icon: Bot,
          accent: stats.automationRate >= 70 ? "success" : "primary",
          helper: "Conversas sem handoff humano",
        },
        {
          label: "Pico de demanda",
          value: formatPeakHour(stats.peakHour),
          icon: Clock,
          accent: "primary",
        },
        {
          label: "Leads em oportunidade",
          value: stats.leadsInOpportunity.toLocaleString("pt-BR"),
          icon: Target,
          accent: "warning",
        },
        {
          label: "Agendamentos",
          value: stats.agendaConfirmed.toLocaleString("pt-BR"),
          icon: CalendarCheck,
          accent: "success",
          helper:
            stats.agendaCancelled > 0
              ? `${stats.agendaCancelled} cancelados`
              : undefined,
        },
        {
          label: "Follow-ups enviados",
          value: stats.followUpSent.toLocaleString("pt-BR"),
          icon: Send,
          accent: "primary",
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="panel-surface-card rounded-xl border border-line bg-surface-card px-5 py-5 sm:px-7 sm:py-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div
              className={cn(
                "inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/[0.08] px-2.5 py-1 text-primary",
                typography.ui.overline,
              )}
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-primary/60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
              Visão geral
            </div>
            <h2 className="mt-3 font-display text-2xl font-bold tracking-tight text-content sm:text-[28px]">
              Olá,{" "}
              <span className="text-primary">
                {(session.displayName ?? "").trim().split(/\s+/).filter(Boolean)[0] ||
                  "Cliente"}
              </span>
              <span className="text-content">.</span>
            </h2>
            <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-content-muted">
              Aqui estão os resultados do{" "}
              <span className="font-semibold text-content-secondary">{rangeLabel}</span>.
              Ajuste o período no topo para comparar intervalos diferentes.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden flex-col items-end text-right sm:flex">
              <span className={typography.ui.overline}>Plano</span>
              <span className="mt-0.5 font-display text-sm font-bold tracking-tight text-content">
                {session.planLabel}
              </span>
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

      {/* Dica banner */}
      <div
        className="panel-surface-card flex flex-wrap items-start gap-3 rounded-xl border border-amber-500/35 bg-amber-500/[0.08] px-4 py-3 text-[13px] text-content-secondary"
        role="status"
      >
        <span className="mt-0.5 flex shrink-0 rounded-lg bg-amber-500/15 p-1.5 text-amber-500" aria-hidden>
          <AlertTriangle className="h-4 w-4" strokeWidth={2} />
        </span>
        <p className="min-w-0 flex-1 leading-relaxed">
          <span className="font-semibold text-content">Dica:</span> mantenha o WhatsApp
          conectado e acompanhe o limite mensal de leads abaixo para evitar interrupções no
          atendimento.
        </p>
      </div>

      {/* Métricas principais */}
      <div className="grid gap-4 xl:grid-cols-[1.6fr_0.9fr]">
        <OverviewPanel
          title="Resumo operacional"
          description={`Principais resultados do período ${rangeLabel}.`}
        >
          {/* Grid de cards ou skeleton */}
          <div
            className={cn(
              "grid gap-3 transition-opacity duration-300",
              "grid-cols-2 sm:grid-cols-3 xl:grid-cols-5",
              loading && stats ? "opacity-60" : "",
            )}
          >
            {stats
              ? statCards.map((card) => (
                  <OverviewStatsCard key={card.label} {...card} />
                ))
              : Array.from({ length: 10 }, (_, i) => <OverviewSkeletonCard key={i} />)}
          </div>

          {/* Progresso de leads */}
          <div className="panel-surface-card mt-4 rounded-xl border border-primary/25 bg-primary/[0.06] p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className={cn("text-primary", typography.ui.overline)}>
                  Leads atendidos (ciclo)
                </p>
                <p className={cn("mt-1.5", typography.ui.kpi)}>
                  {usedShort}
                  <span className="ml-1.5 text-sm font-medium text-content-muted">
                    / {capShort}
                  </span>
                </p>
              </div>
              <p className={cn("mt-1 leading-snug text-[12px]", typography.ui.caption)}>
                Contagem mensal do plano. Avisamos perto do limite para evitar pausas no bot.
              </p>
            </div>
            <div className="mt-3">
              <ProgressBar value={leadUsageProgressPct} />
            </div>
          </div>
        </OverviewPanel>

        <OverviewPanel
          title="Canais Conectados"
          description="Status em tempo real das integrações ativas."
          className="self-start"
        >
          <WhatsAppSection instances={waInstances} />
          <MetaSection status={metaStatus} />
        </OverviewPanel>
      </div>

      {/* Follow-up hoje */}
      {stats && (stats.followUpPending > 0 || stats.followUpSentToday > 0 || stats.followUpCancelledToday > 0) ? (
        <OverviewPanel title="Follow-up hoje" description="Atividade de follow-up automático no dia atual.">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-line/60 bg-surface-deep/40 px-3 py-3 text-center">
              <AlarmClock className="mx-auto mb-1.5 h-4 w-4 text-warning" strokeWidth={2} />
              <p className="font-display text-xl font-bold tabular-nums text-content">
                {stats.followUpPending}
              </p>
              <p className="mt-1 text-[11px] text-content-muted">Pendentes</p>
            </div>
            <div className="rounded-xl border border-success/25 bg-success/[0.07] px-3 py-3 text-center">
              <Send className="mx-auto mb-1.5 h-4 w-4 text-success" strokeWidth={2} />
              <p className="font-display text-xl font-bold tabular-nums text-success">
                {stats.followUpSentToday}
              </p>
              <p className="mt-1 text-[11px] text-content-muted">Enviados hoje</p>
            </div>
            <div className="rounded-xl border border-line/60 bg-surface-deep/40 px-3 py-3 text-center">
              <AlertTriangle className="mx-auto mb-1.5 h-4 w-4 text-content-muted" strokeWidth={2} />
              <p className="font-display text-xl font-bold tabular-nums text-content-muted">
                {stats.followUpCancelledToday}
              </p>
              <p className="mt-1 text-[11px] text-content-muted">Cancelados hoje</p>
            </div>
          </div>
        </OverviewPanel>
      ) : null}

      {/* Charts */}
      <div className="grid gap-6 xl:grid-cols-3">
        <OverviewPanel
          title="Mensagens por dia"
          className="xl:col-span-2"
          description={`Volume diário de mensagens — intervalo ${rangeLabel}.`}
        >
          <MessagesAreaChart data={stats?.messagesByDay ?? []} />
          {stats ? (
            <div className="mt-3 flex items-center gap-4 text-[11.5px]">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-full bg-[#f24400]" />
                <span className="text-content-muted">Recebidas</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-full bg-[#6366f1]" />
                <span className="text-content-muted">Enviadas</span>
              </span>
            </div>
          ) : null}
        </OverviewPanel>

        <OverviewPanel
          title="Leads por origem"
          description={`Distribuição de fonte no intervalo ${rangeLabel}.`}
        >
          <LeadSourceDonut data={stats?.leadsBySource ?? []} />
        </OverviewPanel>
      </div>

      {/* Heatmap + Conversas + Agenda */}
      <div className="grid gap-6 xl:grid-cols-3">
        <OverviewPanel
          title="Horários de pico"
          description={`Volume por hora do dia (${rangeLabel}).`}
        >
          <PeakHoursHeatmap data={stats?.peakHourCounts ?? []} />
        </OverviewPanel>

        <OverviewPanel title="Conversas recentes">
          <RecentConversationsList items={stats?.recentConversations ?? []} />
        </OverviewPanel>

        <OverviewPanel title="Agenda">
          <div className="space-y-5">
            <div>
              <p className={cn(typography.ui.overline, "mb-2")}>Hoje</p>
              {(stats?.agendaToday ?? []).length > 0 ? (
                <UpcomingAgendaList items={stats!.agendaToday} />
              ) : (
                <p className="rounded-lg border border-dashed border-line/70 px-3 py-3 text-[12px] text-content-muted">
                  Nenhum agendamento para hoje.
                </p>
              )}
            </div>
            <div>
              <p className={cn(typography.ui.overline, "mb-2")}>Próximos 7 dias</p>
              <UpcomingAgendaList items={stats?.upcomingAgendaWeek ?? []} />
            </div>
            {stats && stats.agendaConfirmed > 0 ? (
              <div className="rounded-lg border border-success/25 bg-success/[0.07] px-3 py-2.5 text-[12.5px]">
                <span className="font-semibold text-success">
                  {stats.agendaConfirmed}
                </span>{" "}
                <span className="text-content-secondary">agendamento(s) no período</span>
                {stats.agendaCancelled > 0 ? (
                  <span className="ml-2 text-content-faint">
                    · {stats.agendaCancelled} cancelado(s)
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </OverviewPanel>
      </div>

      {/* Temperatura de leads */}
      {stats ? (
        <OverviewPanel
          title="Temperatura dos leads"
          description="Classificação de temperatura feita pela IA para leads do período."
        >
          <LeadTemperatureBars data={stats.leadsByTemperature} />
        </OverviewPanel>
      ) : null}

      {/* Equipe */}
      {teamStats.length > 0 ? (
        <OverviewPanel
          title="Equipe"
          description={`Desempenho dos colaboradores no período ${rangeLabel}.`}
        >
          <TeamOverviewTable members={teamStats} />
        </OverviewPanel>
      ) : null}

      {/* Export */}
      <div className="flex flex-wrap justify-end border-t border-line pt-6">
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px]"
          onClick={() => setExportOpen(true)}
        >
          Exportações
        </Button>
      </div>

      <Modal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Exportações"
        footer={
          <>
            <Button
              variant="secondary"
              type="button"
              onClick={() => setExportOpen(false)}
            >
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
                <Badge className="border-line bg-surface-elevated/50 text-content-secondary">
                  {format}
                </Badge>
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
