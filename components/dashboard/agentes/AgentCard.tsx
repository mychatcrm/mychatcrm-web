"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Coins, Copy, Link2, Settings, Users } from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import type { Agent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatDemoCreditsCompactPtBr } from "@/lib/format-number";
import { AgentAvatarGlyph } from "./agent-avatar-icons";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";

/** Valor estável só para demo (sem API de métricas por agente). */
function demoCreditsLabel(agent: Agent): string {
  const base = agent.metricas.conversasHoje * 48_000 + agent.metricas.conversasAtivasAgora * 120_000;
  let h = 0;
  for (let i = 0; i < agent.id.length; i++) h = (h * 33 + agent.id.charCodeAt(i)) >>> 0;
  const v = base + (h % 400_000);
  return formatDemoCreditsCompactPtBr(v);
}

function AgentStatusSwitch({
  checked,
  onToggle,
  id,
}: {
  checked: boolean;
  onToggle: () => void;
  id: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      id={id}
      onClick={onToggle}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        checked ? "border-emerald-500/45 bg-emerald-500/25" : "border-line bg-surface-deep",
      )}
      aria-label={checked ? "Agente ativo — clique para pausar" : "Agente pausado — clique para ativar"}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition",
          checked ? "translate-x-5" : "translate-x-1",
        )}
      />
    </button>
  );
}

export function AgentCard({
  agent,
  onToggleStatus,
  onDuplicate,
  dragHandle,
  onManage,
}: {
  agent: Agent;
  onToggleStatus: (agentId: string) => void;
  onDuplicate: (agentId: string) => void;
  /** Alça para arrastar e reordenar (ex.: na lista Meus Agentes). */
  dragHandle?: ReactNode;
  /** Abre o balão «Gerenciar» (lista de agentes). Se omitido, «Gerenciar» navega para a página de edição. */
  onManage?: () => void;
}) {
  const { isLight } = usePanelAppearance();
  const creditsDisplay = demoCreditsLabel(agent);
  const leadsAtendendo = agent.metricas.conversasAtivasAgora;
  const isActive = agent.status === "ativo";

  return (
    <article className="rounded-xl border border-line bg-surface-card p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2.5">
          {dragHandle ? <div className="shrink-0">{dragHandle}</div> : null}
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white"
            style={{ backgroundColor: agent.cor }}
            aria-hidden
          >
            <AgentAvatarGlyph avatar={agent.avatar} className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-content">{agent.nome}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] font-medium capitalize text-content-muted">{isActive ? "Ativo" : "Pausado"}</span>
          <AgentStatusSwitch
            id={`agent-status-${agent.id}`}
            checked={isActive}
            onToggle={() => onToggleStatus(agent.id)}
          />
        </div>
      </div>

      <div className="mt-3 space-y-2 rounded-xl border border-line/80 bg-surface-elevated/25 p-2.5">
        <div className="flex items-center gap-2.5">
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15", isLight ? "text-amber-600" : "text-amber-300")}>
            <Coins className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-content-muted">Créditos utilizados</p>
            <p className="truncate text-lg font-semibold tabular-nums leading-tight text-content">{creditsDisplay}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 border-t border-line/60 pt-2">
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15", isLight ? "text-emerald-600" : "text-emerald-300")}>
            <Users className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-content-muted">Leads atendendo</p>
            <p className="text-lg font-semibold tabular-nums leading-tight text-content">{leadsAtendendo}</p>
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex flex-col gap-1.5 border-t border-line/70 pt-2">
        <Link
          href={`/dashboard/integracoes?agente=${encodeURIComponent(agent.id)}`}
          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-line bg-surface-elevated/40 px-3 text-xs font-medium text-content-secondary transition hover:bg-surface-elevated hover:text-content sm:text-[13px]"
        >
          <Link2 className="h-3.5 w-3.5 shrink-0 opacity-80" strokeWidth={1.75} aria-hidden />
          Distribuições de leads
        </Link>
        {onManage ? (
          <Button
            type="button"
            onClick={onManage}
            className="inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-xs font-semibold text-white transition hover:bg-primary-hover sm:text-[13px]"
          >
            <Settings className="h-3.5 w-3.5 shrink-0 opacity-95" strokeWidth={1.75} aria-hidden />
            Gerenciar
          </Button>
        ) : (
          <Link
            href={`/dashboard/agentes/${agent.id}/editar`}
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl bg-primary px-3 text-xs font-semibold text-white transition hover:bg-primary-hover sm:text-[13px]"
          >
            <Settings className="h-3.5 w-3.5 shrink-0 opacity-95" strokeWidth={1.75} aria-hidden />
            Gerenciar
          </Link>
        )}
        <Button
          variant="secondary"
          type="button"
          className="!min-h-9 w-full rounded-xl px-3 text-xs sm:text-[13px]"
          onClick={() => onDuplicate(agent.id)}
        >
          <Copy className="mr-1.5 h-3.5 w-3.5 shrink-0 opacity-80" strokeWidth={1.75} aria-hidden />
          Copiar
        </Button>
      </div>
    </article>
  );
}
