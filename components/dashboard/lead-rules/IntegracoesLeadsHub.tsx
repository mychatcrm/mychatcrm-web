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
          "inline-flex rounded-lg border p-1",
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
              "rounded-md px-4 py-2 text-sm font-medium transition-colors",
              tab === item.id
                ? "bg-primary text-primary-foreground shadow-sm"
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
