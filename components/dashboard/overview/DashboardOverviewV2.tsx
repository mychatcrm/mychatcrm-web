"use client";

import { useEffect, useRef, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Activity, Bot, MessageCircle, UserPlus } from "lucide-react";
import type { ClientSession } from "@/lib/client-auth";
import type { DashboardDataset, OverviewStats } from "@/lib/dashboard-data";
import { useLeadUsageSnapshot } from "@/lib/use-lead-usage-snapshot";
import { formatLeadCount, planMonthlyLeadAllowance } from "@/lib/dashboard-lead-usage";
import { DsCard, DsCardHeader, DsCardTitle, DsCardMeta } from "@/components/ds/Card";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDay(iso: string) {
  try {
    const d = new Date(iso + "T12:00:00Z");
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  } catch {
    return iso.slice(5);
  }
}

function fmtPeakHour(hour: number | null) {
  if (hour === null) return "—";
  const h1 = String(hour).padStart(2, "0");
  const h2 = String((hour + 2) % 24).padStart(2, "0");
  return `${h1}h–${h2}h`;
}

function fmtRelative(iso: string) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins}m atrás`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h atrás`;
    return `${Math.floor(hrs / 24)}d atrás`;
  } catch {
    return "—";
  }
}

const MODE_LABEL: Record<string, string> = {
  automation: "IA",
  waiting_human: "Aguardando",
  human: "Humano",
};

const MODE_COLORS: Record<string, string> = {
  automation: "bg-[rgba(16,185,129,0.12)] text-emerald-500",
  waiting_human: "bg-[rgba(245,158,11,0.12)] text-amber-500",
  human: "bg-[rgba(99,102,241,0.12)] text-indigo-400",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KpiCard({
  label,
  value,
  helper,
  icon: Icon,
  accent = false,
}: {
  label: string;
  value: string;
  helper: string;
  icon: React.ElementType;
  accent?: boolean;
}) {
  return (
    <DsCard className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-mc-muted">{label}</span>
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]",
            accent
              ? "bg-[rgba(242,68,0,0.12)] text-[#F24400]"
              : "bg-mc-surface-2 text-mc-muted",
          )}
        >
          <Icon size={15} strokeWidth={1.9} />
        </span>
      </div>
      <p
        className={cn(
          "font-display text-3xl font-bold tabular-nums tracking-[-0.03em]",
          accent ? "text-[#F24400]" : "text-mc-text",
        )}
      >
        {value}
      </p>
      <p className="text-[11px] leading-relaxed text-mc-muted">{helper}</p>
    </DsCard>
  );
}

function FunnelStage({
  label,
  count,
  pct,
  isFirst,
}: {
  label: string;
  count: number;
  pct: number;
  isFirst: boolean;
}) {
  return (
    <div className={cn("relative", !isFirst && "pt-1")}>
      {!isFirst && (
        <div className="absolute left-0 top-0 ml-[calc(50%-1px)] h-1 w-0.5 bg-mc-border" aria-hidden />
      )}
      <div className="flex items-center justify-between gap-3 text-[12px]">
        <span className="font-medium text-mc-muted">{label}</span>
        <span className="tabular-nums font-semibold text-mc-text">{count.toLocaleString("pt-BR")}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-mc-surface-2">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, backgroundColor: "var(--color-brand)" }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DashboardOverviewV2({
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

  const rangeRef = useRef(rangeISO);
  useEffect(() => { rangeRef.current = rangeISO; }, [rangeISO]);

  // Fetch on date range change
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/client/stats/overview?from=${rangeISO.fromISO}&to=${rangeISO.toISO}`)
      .then((r) => (r.ok ? (r.json() as Promise<OverviewStats>) : null))
      .then((data) => { if (!cancelled && data) setStats(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [rangeISO.fromISO, rangeISO.toISO]);

  // 30s polling + refetch on tab visibility
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
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, []);

  // Lead usage
  const leadSnap = useLeadUsageSnapshot(session.tenantId, session.plan, session.operationalLimits);
  const baseLeads = planMonthlyLeadAllowance(session.plan, session.operationalLimits);
  const totalLeadCap = baseLeads + leadSnap.bonus;
  const usedLeads = Math.min(leadSnap.used, totalLeadCap);
  const leadPct = totalLeadCap > 0 ? Math.min(100, (usedLeads / totalLeadCap) * 100) : 0;

  // Derived data
  const firstName = (session.displayName ?? "").trim().split(/\s+/)[0] || "Cliente";
  const automationRate = stats?.automationRate ?? 0;

  const kpis = [
    {
      label: "Mensagens",
      value: (stats?.totalMessages ?? 0).toLocaleString("pt-BR"),
      helper: `Total trocadas no período ${rangeLabel}`,
      icon: MessageCircle,
      accent: false,
    },
    {
      label: "Novos leads",
      value: (stats?.newLeads ?? 0).toLocaleString("pt-BR"),
      helper: "Capturados na janela selecionada",
      icon: UserPlus,
      accent: true,
    },
    {
      label: "Taxa IA",
      value: `${automationRate.toFixed(0)}%`,
      helper: "Conversas resolvidas sem intervenção humana",
      icon: Bot,
      accent: false,
    },
    {
      label: "Em atendimento",
      value: (stats?.activeConversations ?? 0).toLocaleString("pt-BR"),
      helper: "Conversas abertas no momento",
      icon: Activity,
      accent: false,
    },
  ];

  // Bar chart: IA vs humano per day (approximate using automationRate)
  const barData = (stats?.messagesByDay ?? []).slice(-7).map((d) => {
    const ia = Math.round(d.outbound * (automationRate / 100));
    const humano = d.outbound - ia;
    return {
      dia: fmtDay(d.date),
      IA: ia,
      Humano: humano,
    };
  });

  // Funnel stages
  const funnelData = [
    { label: "Leads captados", count: stats?.newLeads ?? 0 },
    { label: "Em oportunidade", count: stats?.leadsInOpportunity ?? 0 },
    { label: "Handoffs humanos", count: stats?.handoffCount ?? 0 },
    { label: "Conversas fechadas", count: stats?.closedConversations ?? 0 },
  ];
  const funnelMax = Math.max(...funnelData.map((s) => s.count), 1);

  // AI donut
  const donutData = [
    { name: "IA", value: automationRate },
    { name: "Humano", value: 100 - automationRate },
  ];

  // Recent conversations
  const recent = stats?.recentConversations ?? [];

  return (
    <div className="space-y-5">
      {/* ── Greeting ── */}
      <DsCard className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-mc-muted">
            Visão geral
          </p>
          <h2 className="mt-1.5 font-display text-[22px] font-bold tracking-tight text-mc-text">
            Olá, <span style={{ color: "var(--color-brand)" }}>{firstName}</span>.
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-mc-muted">
            Resultados do{" "}
            <span className="font-semibold text-mc-text">{rangeLabel}</span>.
          </p>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-mc-muted">Plano</p>
            <p className="mt-0.5 text-sm font-bold text-mc-text">{session.planLabel}</p>
          </div>
          <div className="h-8 w-px bg-mc-border" />
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-mc-muted">Leads (ciclo)</p>
            <p className="mt-0.5 text-sm font-bold text-mc-text">
              {formatLeadCount(usedLeads)}
              <span className="font-normal text-mc-muted"> / {formatLeadCount(totalLeadCap)}</span>
            </p>
            <div className="mt-1 h-1 w-24 overflow-hidden rounded-full bg-mc-surface-2">
              <div
                className="h-full rounded-full"
                style={{ width: `${leadPct}%`, backgroundColor: "var(--color-brand)" }}
              />
            </div>
          </div>
        </div>
      </DsCard>

      {/* ── 4 KPIs ── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </div>

      {/* ── Bar chart + Funnel ── */}
      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        {/* Bar chart */}
        <DsCard className="p-5">
          <DsCardHeader>
            <div>
              <DsCardTitle>IA × Humano por dia</DsCardTitle>
              <DsCardMeta>Distribuição de respostas — {rangeLabel}</DsCardMeta>
            </div>
          </DsCardHeader>
          {barData.length === 0 ? (
            <div className="flex min-h-[180px] items-center justify-center rounded-[10px] border border-dashed border-mc-border text-[12px] text-mc-muted">
              Sem dados para o período.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={barData} barSize={12} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="dia"
                  tick={{ fontSize: 10, fill: "var(--muted)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--muted)" }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    fontSize: 12,
                    color: "var(--text)",
                  }}
                  cursor={{ fill: "var(--surface-2)" }}
                />
                <Bar dataKey="IA" fill="var(--color-brand)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Humano" fill="var(--muted)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <div className="mt-3 flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-[11px] text-mc-muted">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: "var(--color-brand)" }} />
              IA
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-mc-muted">
              <span className="inline-block h-2 w-2 rounded-sm bg-mc-muted" />
              Humano
            </span>
          </div>
        </DsCard>

        {/* Funnel */}
        <DsCard className="p-5">
          <DsCardHeader>
            <div>
              <DsCardTitle>Funil de conversão</DsCardTitle>
              <DsCardMeta>4 etapas — {rangeLabel}</DsCardMeta>
            </div>
          </DsCardHeader>
          <div className="space-y-4 pt-1">
            {funnelData.map((stage, i) => (
              <FunnelStage
                key={stage.label}
                label={stage.label}
                count={stage.count}
                pct={(stage.count / funnelMax) * 100}
                isFirst={i === 0}
              />
            ))}
          </div>
        </DsCard>
      </div>

      {/* ── AI performance card + Recent activity ── */}
      <div className="grid gap-5 xl:grid-cols-[1fr_1.4fr]">
        {/* Dark AI card */}
        <div
          className="flex flex-col gap-5 rounded-mc-base border border-mc-border p-5"
          style={{ backgroundColor: "var(--color-coal)" }}
        >
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/50">
              Desempenho da IA
            </p>
            <p className="mt-1 text-sm font-medium text-white/70">
              Taxa de automação no período
            </p>
          </div>

          {/* Donut */}
          <div className="flex items-center gap-5">
            <div className="relative h-[100px] w-[100px] shrink-0">
              <PieChart width={100} height={100}>
                <Pie
                  data={donutData}
                  cx={46}
                  cy={46}
                  innerRadius={32}
                  outerRadius={46}
                  startAngle={90}
                  endAngle={-270}
                  dataKey="value"
                  strokeWidth={0}
                >
                  <Cell fill="#F24400" />
                  <Cell fill="rgba(255,255,255,0.1)" />
                </Pie>
              </PieChart>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-display text-xl font-bold tabular-nums text-white">
                  {automationRate.toFixed(0)}%
                </span>
              </div>
            </div>
            <div className="min-w-0 space-y-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/40">Handoffs</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-white">
                  {(stats?.handoffCount ?? 0).toLocaleString("pt-BR")}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/40">Pico de demanda</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-white">
                  {fmtPeakHour(stats?.peakHour ?? null)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/40">Follow-ups enviados</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-white">
                  {(stats?.followUpSent ?? 0).toLocaleString("pt-BR")}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Recent activity */}
        <DsCard className="p-5">
          <DsCardHeader>
            <DsCardTitle>Atividade recente</DsCardTitle>
          </DsCardHeader>
          {recent.length === 0 ? (
            <div className="flex min-h-[120px] items-center justify-center rounded-[10px] border border-dashed border-mc-border text-[12px] text-mc-muted">
              Nenhuma conversa no período.
            </div>
          ) : (
            <ul className="space-y-2">
              {recent.slice(0, 6).map((conv, i) => {
                const name = conv.name || conv.phone;
                const initials = name
                  .split(" ")
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((p) => p[0]?.toUpperCase())
                  .join("") || "?";
                const modeClass = MODE_COLORS[conv.mode] ?? "bg-mc-surface-2 text-mc-muted";
                const modeLabel = MODE_LABEL[conv.mode] ?? conv.mode;
                return (
                  <li
                    key={`${conv.phone}-${i}`}
                    className="flex items-center gap-3 rounded-[10px] border border-mc-border p-3 transition-colors hover:bg-mc-surface-2"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgba(242,68,0,0.1)] text-[11px] font-bold text-[#F24400]">
                      {initials}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-mc-text">{name}</p>
                      <p className="text-[11px] text-mc-muted">{fmtRelative(conv.lastAt)}</p>
                    </div>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", modeClass)}>
                      {modeLabel}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </DsCard>
      </div>
    </div>
  );
}
