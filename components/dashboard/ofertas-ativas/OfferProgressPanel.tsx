"use client";

import type { ActiveOfferProgressStats } from "@/lib/active-offers-types";
import { ACTIVE_OFFER_DISPOSITION_LABELS } from "@/lib/active-offers-types";
import { cn } from "@/lib/utils";

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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatPill label="Total" value={stats.total} />
        <StatPill label="Pendentes" value={stats.pending} tone="border-amber-500/20" />
        <StatPill label="Concluídos" value={stats.completed} tone="border-emerald-500/20" />
        <StatPill label="Progresso" value={completionPct} tone="border-primary/20" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatPill label={ACTIVE_OFFER_DISPOSITION_LABELS.no_answer} value={stats.noAnswer} />
        <StatPill label={ACTIVE_OFFER_DISPOSITION_LABELS.answered_transfer} value={stats.answeredTransfer} />
        <StatPill label={ACTIVE_OFFER_DISPOSITION_LABELS.answered_not_interested} value={stats.answeredNotInterested} />
        <StatPill label={ACTIVE_OFFER_DISPOSITION_LABELS.do_not_call} value={stats.doNotCall} />
      </div>

      {sellerRows?.length ? (
        <div className="rounded-xl border border-line bg-surface-card p-4">
          <p className="text-sm font-semibold text-content">Por vendedor</p>
          <div className="mt-3 space-y-2">
            {sellerRows.map((row) => (
              <div key={row.employeeId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line/70 px-3 py-2 text-sm">
                <span className="font-medium text-content">
                  {employeeNames?.get(row.employeeId) ?? (row.employeeId === "sem_atribuicao" ? "Sem atribuição" : row.employeeId)}
                </span>
                <span className="text-content-muted">
                  {row.stats.completed}/{row.stats.total} concluídos · {row.stats.pending} pendentes
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
