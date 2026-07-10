"use client";

import { PanelHelp, type PanelHelpContent } from "@/components/panel/ui/PanelHelp";
import { cn } from "@/lib/utils";

export function SectionTitleWithHelp({
  title,
  help,
  className,
}: {
  title: string;
  help: PanelHelpContent;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <p className="text-sm font-semibold text-content">{title}</p>
      <PanelHelp content={help} />
    </div>
  );
}
