"use client";

import { cn } from "@/lib/utils";

/**
 * Camada decorativa plana para seções públicas.
 * Mantém profundidade visual sem canvas, blur ou partículas animadas.
 */
export function MagneticParticleField({ className }: { className?: string }) {
  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden>
      <div className="absolute inset-x-8 top-0 border-t border-primary/20" />
      <div className="absolute inset-y-10 left-0 border-l border-line/70" />
      <div className="absolute inset-y-10 right-0 border-r border-line/70" />
      <div className="absolute inset-x-10 bottom-0 border-b border-line/80" />
      <div className="absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-primary/15 bg-primary/5" />
    </div>
  );
}
