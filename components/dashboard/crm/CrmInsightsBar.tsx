"use client";

import { useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import { Percent, TrendingUp, UserRound, Wallet } from "lucide-react";
import type { ClientLead } from "@/lib/dashboard-data";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import { cn, formatBRL } from "@/lib/utils";
import { typography } from "@/lib/typography";
import styles from "./crm-premium.module.css";

function splitMetricValue(value: string) {
  const currencyMatch = value.match(/^(R\$)\s*(.+)$/);
  if (currencyMatch) {
    return { prefix: currencyMatch[1], main: currencyMatch[2], suffix: "" };
  }

  const percentMatch = value.match(/^(.+?)(%)$/);
  if (percentMatch) {
    return { prefix: "", main: percentMatch[1], suffix: percentMatch[2] };
  }

  return { prefix: "", main: value, suffix: "" };
}

function InsightCard({
  label,
  value,
  hint,
  accent,
  compact,
  minimal,
  Icon,
}: {
  label: string;
  value: string;
  hint: string;
  /** `sky` mantém o nome histórico na API; visual alinhado ao azul carvão / neutros da marca. */
  accent?: "primary" | "sky" | "amber" | "emerald";
  compact?: boolean;
  /** Topo CRM: KPI compacto com ícone, valor e label. */
  minimal?: boolean;
  Icon: LucideIcon;
}) {
  const { isLight } = usePanelAppearance();
  const metricValue = splitMetricValue(value);

  const iconWrap = cn(
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border transition-colors group-hover:border-primary/35",
    accent === "sky" &&
      (isLight
        ? "border-line/80 bg-surface-elevated/90 text-content"
        : "border-line/60 bg-surface-elevated/40 text-content-secondary"),
    accent === "amber" &&
      (isLight
        ? "border-primary/25 bg-primary/[0.08] text-primary"
        : "border-primary/30 bg-primary/10 text-primary"),
    accent === "emerald" &&
      (isLight
        ? "border-primary/25 bg-primary/[0.08] text-primary"
        : "border-primary/30 bg-primary/10 text-primary"),
    (accent === "primary" || !accent) &&
      (isLight
        ? "border-primary/25 bg-primary/[0.08] text-content"
        : "border-primary/30 bg-primary/10 text-primary"),
  );

  const valueClass =
    accent === "sky"
      ? (isLight ? "text-content-secondary" : "text-content-muted")
      : "text-primary";

  const topSheen = accent === "sky" ? "bg-brand-secondary/35" : "bg-primary/45";

  if (minimal) {
    return (
      <div
        className={cn(
          "group relative min-w-0 overflow-hidden px-3.5 py-4 transition-[background-color,box-shadow,transform] duration-200 sm:px-4",
          styles.metricCell,
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/[0.12] text-primary transition-[background-color,transform] duration-200 group-hover:scale-[1.04] group-hover:bg-primary/[0.17]",
              styles.metricIcon,
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={1.9} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "flex min-w-0 items-baseline gap-1 truncate font-bold tabular-nums tracking-[-0.035em]",
                isLight ? "text-content" : "text-white",
              )}
            >
              {metricValue.prefix ? (
                <span className="text-[11px] font-semibold tracking-normal text-primary">{metricValue.prefix}</span>
              ) : null}
              <span className="truncate text-xl sm:text-[1.35rem]">{metricValue.main}</span>
              {metricValue.suffix ? (
                <span className="text-xs font-semibold tracking-normal text-content-muted">{metricValue.suffix}</span>
              ) : null}
            </p>
            <p className="mt-1 truncate text-[10px] font-medium uppercase tracking-[0.13em] text-content-muted">
              {label}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative min-w-0 overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:border-primary/25",
        "shadow-[0_18px_52px_-42px_rgba(15,23,42,0.72)] ring-1 ring-white/[0.025]",
        compact ? "rounded-[1.25rem] p-3" : "rounded-[1.35rem] p-4",
        isLight
          ? "border border-slate-200/75 bg-white/75"
          : "border border-line/60 bg-surface-card/[0.86]",
      )}
    >
      <div className={cn("pointer-events-none absolute inset-x-4 top-0 h-px rounded-full opacity-90", topSheen)} aria-hidden />
      <div className={cn("relative flex items-start gap-3", compact && "gap-2.5")}>
        <div className={cn(iconWrap, compact && "h-9 w-9 rounded-lg [&_svg]:h-[18px] [&_svg]:w-[18px]")}>
          <Icon strokeWidth={1.85} />
        </div>
        <div className="min-w-0 flex-1">
          <p className={typography.ui.overline}>{label}</p>
          <p
            className={cn(
              "truncate font-semibold tracking-tight tabular-nums",
              compact ? "mt-1 text-lg" : "mt-1.5 text-2xl",
              valueClass,
            )}
          >
            {value}
          </p>
          <p
            className={cn(
              "line-clamp-2 leading-snug text-content-muted",
              compact ? "mt-0.5 text-[10px]" : "mt-1 text-[11px]",
            )}
          >
            {hint}
          </p>
        </div>
      </div>
    </div>
  );
}

export function CrmInsightsBar({
  leads,
  stageCount,
  funnelName,
  firstStageId,
  embedded,
  compactTop,
}: {
  leads: ClientLead[];
  stageCount: number;
  funnelName: string;
  firstStageId: string;
  /** Dentro do painel principal CRM: menos moldura e título duplicado. */
  embedded?: boolean;
  /** Barra compacta no topo do CRM Kanban — só os 4 KPIs. */
  compactTop?: boolean;
}) {
  const { isLight } = usePanelAppearance();

  const stats = useMemo(() => {
    const ativos = leads.length;
    const valor = leads.reduce((s, l) => s + l.valor, 0);
    const qualificados = leads.filter((l) => l.status !== firstStageId).length;
    const taxaQualif = ativos ? Math.round((qualificados / ativos) * 100) : 0;
    const byResp = leads.reduce<Record<string, number>>((acc, l) => {
      acc[l.responsavel] = (acc[l.responsavel] ?? 0) + 1;
      return acc;
    }, {});
    const topResp = Object.entries(byResp).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
    const ganhos = leads.filter((l) => l.status === "fechado").length;
    const taxaFecho = ativos ? Math.round((ganhos / ativos) * 100) : 0;
    return { ativos, valor, taxaQualif, topResp, taxaFecho };
  }, [leads, firstStageId]);

  const grid = (
    <div
      className={cn(
        "grid min-[480px]:grid-cols-2 lg:grid-cols-4",
        compactTop
          ? cn(
              "rounded-2xl",
              styles.metricStrip,
            )
          : embedded
            ? "gap-2.5"
            : "gap-3",
      )}
    >
      <InsightCard
        label="Valor no pipeline"
        value={formatBRL(stats.valor)}
        hint="Soma das oportunidades abertas neste funil (demo)."
        accent="primary"
        compact={embedded}
        minimal={compactTop}
        Icon={Wallet}
      />
      <InsightCard
        label="Avanço no funil"
        value={`${stats.taxaQualif}%`}
        hint="Leads que já saíram da primeira etapa."
        accent="sky"
        compact={embedded}
        minimal={compactTop}
        Icon={TrendingUp}
      />
      <InsightCard
        label="Taxa ganho (demo)"
        value={`${stats.taxaFecho}%`}
        hint="Proporção em etapa «Fechado» neste conjunto."
        accent="emerald"
        compact={embedded}
        minimal={compactTop}
        Icon={Percent}
      />
      <InsightCard
        label="Top responsável"
        value={stats.topResp}
        hint="Distribuição simulada por corretor."
        accent="amber"
        compact={embedded}
        minimal={compactTop}
        Icon={UserRound}
      />
    </div>
  );

  if (compactTop) {
    return grid;
  }

  if (embedded) {
    return (
      <div
        className={cn(
          "mb-5 rounded-[1.4rem] border p-3.5 shadow-[0_22px_70px_-52px_rgba(15,23,42,0.72)] ring-1 ring-white/[0.025] sm:p-4",
          isLight
            ? "border-slate-200/75 bg-white/70"
            : "border-line/60 bg-surface-card/75",
        )}
      >
        <p className="mb-3 text-xs text-content-muted">
          <span className="font-semibold text-content">{funnelName}</span>
          <span className="text-content-faint"> · </span>
          {stageCount} etapas · {stats.ativos} oportunidades ativas
        </p>
        {grid}
      </div>
    );
  }

  return (
    <section
      className={cn(
        "rounded-[1.4rem] border p-4 shadow-[0_22px_70px_-52px_rgba(15,23,42,0.72)] ring-1 ring-white/[0.025] sm:p-5",
        isLight
          ? "border-slate-200/75 bg-white/70"
          : "border-line/60 bg-surface-card/75",
      )}
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="mb-0.5 flex items-center gap-1.5">
            <div className="h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
            <p className={cn(typography.ui.overline, "text-primary")}>Painel do funil</p>
          </div>
          <h2 className={cn("mt-0.5", typography.heading.h5)}>{funnelName}</h2>
          <p className="mt-0.5 text-xs text-content-muted">
            {stageCount} etapas · {stats.ativos} oportunidades ativas
          </p>
        </div>
      </div>
      {grid}
    </section>
  );
}
