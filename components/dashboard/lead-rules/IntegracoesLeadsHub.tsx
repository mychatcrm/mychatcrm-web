"use client";

import { useState } from "react";
import type { ClientSession } from "@/lib/client-auth";
import { LeadDistributionHub } from "./LeadDistributionHub";
import { MetaLeadEventsPanel } from "./MetaLeadEventsPanel";
import { cn } from "@/lib/utils";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";

type TabId = "leads" | "rules";

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
        {(
          [
            { id: "leads" as const, label: "Leads recebidos" },
            { id: "rules" as const, label: "Regras de distribuição" },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
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

      {tab === "leads" ? <MetaLeadEventsPanel tenantId={session.tenantId} /> : <LeadDistributionHub session={session} />}
    </div>
  );
}
