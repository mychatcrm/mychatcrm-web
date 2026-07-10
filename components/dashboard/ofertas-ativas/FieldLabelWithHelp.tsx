"use client";

import { PanelHelp, type PanelHelpContent } from "@/components/panel/ui/PanelHelp";
import { cn } from "@/lib/utils";

export function FieldLabelWithHelp({
  label,
  htmlFor,
  help,
  hint,
  className,
}: {
  label: string;
  htmlFor?: string;
  help: PanelHelpContent;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center gap-1.5">
        {htmlFor ? (
          <label className="text-sm font-medium text-content" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <p className="text-sm font-medium text-content">{label}</p>
        )}
        <PanelHelp content={help} />
      </div>
      {hint ? <p className="text-xs leading-relaxed text-content-muted">{hint}</p> : null}
    </div>
  );
}
