"use client";

import { Thermometer } from "lucide-react";
import type { LeadTemperatureResult } from "@/lib/crm-lead-temperature";
import { cn } from "@/lib/utils";
import { typography } from "@/lib/typography";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";

function fillClass(level: LeadTemperatureResult["level"]) {
  switch (level) {
    case 0:
      return "bg-brand-secondary";
    case 1:
      return "bg-primary/70";
    case 2:
      return "bg-primary";
    default:
      return "bg-primary-hover";
  }
}

function badgeRing(level: LeadTemperatureResult["level"], isLight: boolean) {
  switch (level) {
    case 0:
      return "border-line/60 bg-surface-elevated/60 text-content-muted";
    case 1:
      return cn("border-amber-400/50 bg-amber-500/15", isLight ? "text-amber-900" : "text-amber-200");
    case 2:
      return "border-primary/45 bg-primary/15 text-primary";
    default:
      return cn("border-rose-500/50 bg-rose-600/15", isLight ? "text-rose-800" : "text-rose-200");
  }
}

/** Selo fora do card (canto superior direito). */
export function LeadThermometerBadge({
  result,
  className,
}: {
  result: LeadTemperatureResult;
  className?: string;
}) {
  const { isLight } = usePanelAppearance();
  return (
    <span
      className={cn(
        "pointer-events-none inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold tabular-nums",
        badgeRing(result.level, isLight),
        className,
      )}
      title={`${result.label} · ${result.score}/100 — ${result.hint}`}
    >
      <Thermometer className="h-3 w-3 shrink-0 opacity-90" aria-hidden />
      {result.label}
    </span>
  );
}

/** Barra horizontal de preenchimento (dentro do card / linha da tabela). */
export function LeadThermometerBar({ result, className }: { result: LeadTemperatureResult; className?: string }) {
  return (
    <div className={cn("w-full min-w-0", className)} title={`${result.label} · ${result.score}/100 — ${result.hint}`}>
      <div className={cn("flex items-center justify-between gap-2", typography.ui.overline)}>
        <span className="inline-flex items-center gap-1">
          <Thermometer className="h-3 w-3 text-content-muted" aria-hidden />
          Termómetro
        </span>
        <span className="tabular-nums text-content-secondary">{result.score}/100</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-deep ring-1 ring-line/60">
        <div
          className={cn("h-full rounded-full transition-[width] duration-500 ease-out", fillClass(result.level))}
          style={{ width: `${result.score}%` }}
        />
      </div>
      <p className="mt-0.5 truncate text-[10px] font-medium text-content-muted">{result.label}</p>
    </div>
  );
}

/** Versão compacta para célula de tabela. */
export function LeadThermometerInline({ result, className }: { result: LeadTemperatureResult; className?: string }) {
  return (
    <div
      className={cn("flex w-[5.5rem] shrink-0 flex-col gap-0.5", className)}
      title={`${result.label} · ${result.score}/100 — ${result.hint}`}
    >
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-deep ring-1 ring-line/50">
        <div className={cn("h-full rounded-full", fillClass(result.level))} style={{ width: `${result.score}%` }} />
      </div>
      <span className="text-[9px] font-bold uppercase tracking-tight text-content-muted">{result.label}</span>
    </div>
  );
}

/** Painel maior (ficha do lead) com coluna de mercúrio e explicação. */
export function LeadThermometerPanel({ result, className }: { result: LeadTemperatureResult; className?: string }) {
  const h = Math.max(12, result.score);
  return (
    <div
      className={cn(
        "rounded-xl border border-line/80 bg-surface-deep/30 p-4 ring-1 ring-inset ring-line/25",
        className,
      )}
    >
      <div className="flex flex-wrap items-stretch gap-4">
        <div className="flex shrink-0 flex-col items-center gap-1">
          <span className={typography.ui.overline}>Termómetro</span>
          <div className="relative h-32 w-8 overflow-hidden rounded-full border border-line/70 bg-surface-card">
            <div
              className={cn("absolute bottom-0 left-0 right-0 rounded-b-full opacity-95", fillClass(result.level))}
              style={{ height: `${h}%` }}
            />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-content-muted">
            Calculado automaticamente a partir do <strong className="text-content-secondary">histórico de interações</strong>
            , etapa no funil, valor, tags e recência do último contacto.
          </p>
          <p className="mt-2 text-xl font-bold text-content">{result.label}</p>
          <p className="mt-1 text-sm leading-relaxed text-content-secondary">{result.hint}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end justify-center text-right">
          <Thermometer className="mb-1 h-6 w-6 text-primary opacity-80" aria-hidden />
          <p className="text-3xl font-black tabular-nums leading-none text-content">{result.score}</p>
          <p className="text-[11px] font-medium text-content-faint">/ 100</p>
        </div>
      </div>
    </div>
  );
}
