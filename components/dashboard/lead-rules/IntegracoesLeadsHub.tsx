"use client";

import { useState } from "react";
import type { ClientSession } from "@/lib/client-auth";
import { LeadDistributionHub } from "./LeadDistributionHub";
import { MetaLeadEventsPanel } from "./MetaLeadEventsPanel";
import { CentralDeLeadsPanel } from "./central/CentralDeLeadsPanel";
import { cn } from "@/lib/utils";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";

type TabId = "leads" | "central" | "rules";

const TABS: { id: TabId; label: string; hint: string }[] = [
  { id: "leads", label: "Leads recebidos", hint: "O que acabou de chegar, em tempo real" },
  { id: "central", label: "Central de leads", hint: "A base inteira, com filtro, resultado e export" },
  { id: "rules", label: "Regras de distribuição", hint: "Quem atende cada formulário" },
];

export function IntegracoesLeadsHub({ session }: { session: ClientSession }) {
  const { isLight } = usePanelAppearance();
  const [tab, setTab] = useState<TabId>("leads");

  return (
    <div className="space-y-6">
      <div
        className={cn(
          "flex w-full flex-col gap-1 rounded-lg border p-1 sm:inline-flex sm:w-auto sm:flex-row",
          isLight ? "border-slate-200 bg-surface-deep" : "border-line/80 bg-surface-card/60",
        )}
        role="tablist"
        aria-label="Integrações de leads"
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            title={item.hint}
            className={cn(
              "flex-1 rounded-md px-3 py-2.5 text-center text-sm font-medium transition-colors sm:flex-none sm:px-4",
              tab === item.id
                ? "bg-primary text-primary-foreground"
                : "text-content-muted hover:text-content",
            )}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "leads" ? <MetaLeadEventsPanel tenantId={session.tenantId} /> : null}
      {tab === "central" ? <CentralDeLeadsPanel session={session} /> : null}
      {tab === "rules" ? <LeadDistributionHub session={session} /> : null}
    </div>
  );
}
