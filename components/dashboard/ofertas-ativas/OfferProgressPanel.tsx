"use client";

import type { ActiveOfferProgressStats } from "@/lib/active-offers-types";
import { cn } from "@/lib/utils";
import { ACTIVE_OFFERS_HELP } from "./active-offers-help";
import { SectionTitleWithHelp } from "./SectionTitleWithHelp";

function StatPill({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={cn("rounded-xl border border-line bg-surface-elevated/35 px-3 py-2", tone)}>
      <p className="text-[11px] uppercase tracking-wide text-content-faint">{label}</p>
      <p className="mt-1 text-lg font-semibold text-content">{value}</p>
    </div>
  );
}

export function OfferProgressPanel({
  stats,
  sellerRows,
  employeeNames,
}: {
  stats: ActiveOfferProgressStats | null;
  sellerRows?: Array<{ employeeId: string; stats: ActiveOfferProgressStats }>;
  employeeNames?: Map<string, string>;
}) {
  if (!stats) return null;

  const completionPct = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <SectionTitleWithHelp title="Acompanhamento da lista" help={ACTIVE_OFFERS_HELP.progressoGeral} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatPill label="Total na lista" value={stats.total} />
        <StatPill label="Aguardando ligação" value={stats.pending} tone="border-amber-500/20" />
        <StatPill label="Finalizados" value={stats.completed} tone="border-emerald-500/20" />
        <StatPill label="Concluído (%)" value={completionPct} tone="border-primary/20" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatPill label="Não atendeu" value={stats.noAnswer} />
        <StatPill label="Passou p/ vendedor" value={stats.answeredTransfer} />
        <StatPill label="Não quer nada" value={stats.answeredNotInterested} />
        <StatPill label="Pediu p/ não ligar" value={stats.doNotCall} />
      </div>

      {sellerRows?.length ? (
        <div className="rounded-xl border border-line bg-surface-card p-4">
          <SectionTitleWithHelp title="Por vendedor" help={ACTIVE_OFFERS_HELP.porVendedor} />
          <div className="mt-3 space-y-2">
            {sellerRows.map((row) => (
              <div
                key={row.employeeId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line/70 px-3 py-2 text-sm"
              >
                <span className="font-medium text-content">
                  {employeeNames?.get(row.employeeId) ??
                    (row.employeeId === "sem_atribuicao" ? "Sem atribuição" : row.employeeId)}
                </span>
                <span className="text-content-muted">
                  {row.stats.completed}/{row.stats.total} finalizados · {row.stats.pending} aguardando
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
