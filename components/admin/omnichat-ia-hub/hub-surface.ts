import { cn } from "@/lib/utils";

/** Shell visual confinado ao hub — segue tokens flat do design system. */
export const hubPageBg = cn(
  "panel-surface-card relative min-h-[60vh] rounded-2xl border border-line/80 bg-surface-card",
);

export const hubGlass = cn(
  "panel-surface-card rounded-2xl border border-line/80 bg-surface-deep",
);

export const hubGlowTitle = cn("text-content");
