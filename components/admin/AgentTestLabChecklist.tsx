"use client";

import type { LabChecklistItem } from "@/lib/agent-test-lab/connection-plan";

const button = "rounded-xl border border-white/15 px-4 py-2 text-sm hover:bg-white/10";
const primary = `${button} bg-orange-600 hover:bg-orange-500 border-orange-500`;

/**
 * The checklist and the single next action. Everything the panel blocks has a
 * plain sentence saying why and a link to the exact place that resolves it.
 */
export function AgentTestLabChecklist({ items, next }: { items: LabChecklistItem[]; next: LabChecklistItem | null }) {
  return <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
    <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
      <h3 className="text-sm font-semibold text-sky-200">O que faço agora?</h3>
      {next ? <>
        <p className="mt-2 text-sm">{next.detail}</p>
        {next.action && <a className={`${primary} mt-3 inline-block`} href={`#${next.action.anchor}`}>{next.action.label}</a>}
      </> : <p className="mt-2 text-sm text-white/60">Nada pendente.</p>}
    </div>
    <ul className="space-y-2 text-sm">
      {items.map(item => <li key={item.code} className="flex flex-wrap items-center gap-2">
        <span aria-hidden className={item.ok ? "text-emerald-400" : "text-white/40"}>{item.ok ? "✓" : "○"}</span>
        <span className={item.ok ? "text-white/80" : "text-white/55"}>{item.label}</span>
        <span className="sr-only">{item.ok ? "concluído" : "pendente"}</span>
        {!item.ok && item.action && <a className="text-xs text-orange-300 underline" href={`#${item.action.anchor}`}>{item.action.label}</a>}
      </li>)}
    </ul>
  </div>;
}
