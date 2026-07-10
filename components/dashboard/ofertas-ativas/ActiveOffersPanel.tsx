"use client";

import { cn } from "@/lib/utils";
import { typography } from "@/lib/typography";
import { PanelHelp, type PanelHelpContent } from "@/components/panel/ui/PanelHelp";

export function ActiveOffersPanel({
  title,
  description,
  help,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  help?: PanelHelpContent;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("panel-surface-card min-w-0 rounded-xl border border-line bg-surface-card p-5 sm:p-6", className)}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className={cn(typography.heading.h4, "text-[17px] sm:text-xl")}>{title}</h2>
            {help ? <PanelHelp content={help} /> : null}
          </div>
          {description ? (
            <p className="mt-1.5 text-[13px] leading-relaxed text-content-muted">{description}</p>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
