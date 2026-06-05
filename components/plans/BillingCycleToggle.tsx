"use client";

import { cn } from "@/lib/utils";
import type { PlanBillingCycle } from "@/lib/plans";
import { PLAN_ANNUAL_DISCOUNT_PERCENT } from "@/lib/plans";

type BillingCycleToggleProps = {
  value: PlanBillingCycle;
  onChange: (cycle: PlanBillingCycle) => void;
  className?: string;
};

export function BillingCycleToggle({ value, onChange, className }: BillingCycleToggleProps) {
  const inactiveTab =
    "text-content-muted hover:bg-surface-elevated/90 hover:text-content-secondary dark:hover:bg-surface-deep/80";
  const activeTab = "bg-primary text-white";

  return (
    <div
      className={cn(
        "inline-flex rounded-xl border border-line/80 bg-surface-card p-1 dark:bg-surface-elevated",
        className,
      )}
      role="tablist"
      aria-label="Ciclo de cobrança"
    >
      <button
        type="button"
        role="tab"
        aria-selected={value === "monthly"}
        className={cn(
            "relative rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors duration-150 sm:px-7",
          value === "monthly" ? activeTab : inactiveTab,
        )}
        onClick={() => onChange("monthly")}
      >
        Mensal
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "annual"}
        className={cn(
            "relative flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors duration-150 sm:px-7",
          value === "annual" ? activeTab : inactiveTab,
        )}
        onClick={() => onChange("annual")}
      >
        <span>Anual</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
            value === "annual"
              ? "bg-white/20 text-white ring-1 ring-white/35"
              : "bg-primary/15 text-primary ring-1 ring-primary/25 dark:bg-primary/20",
          )}
        >
          −{PLAN_ANNUAL_DISCOUNT_PERCENT}% OFF
        </span>
      </button>
    </div>
  );
}
