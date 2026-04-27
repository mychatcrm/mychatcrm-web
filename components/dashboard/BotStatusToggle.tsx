"use client";

import { cn } from "@/lib/utils";
import { typography } from "@/lib/typography";

type Mode = "online" | "offline" | "manual";

export function BotStatusToggle({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  const modes: { id: Mode; label: string; dot: string }[] = [
    { id: "online", label: "Online", dot: "bg-success" },
    { id: "offline", label: "Offline", dot: "bg-content-muted" },
    { id: "manual", label: "Manual", dot: "bg-primary" },
  ];

  return (
    <div
      className="rounded-xl border border-line/70 bg-surface-card p-4 ring-1 ring-inset ring-line/30"
      role="group"
      aria-label="Status do bot"
    >
      <div className="mb-0.5 flex items-center gap-1.5">
        <div className="h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
        <p className={cn(typography.ui.overline, "text-primary")}>Status do bot</p>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {modes.map((m) => {
          const active = value === m.id;
          return (
            <button
              key={m.id}
              type="button"
              className={cn(
                "group relative inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl border px-3 text-[13px] font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
                active
                  ? "border-primary/40 bg-primary/[0.12] text-primary ring-1 ring-inset ring-primary/20"
                  : "border-line/70 bg-surface-deep/60 text-content-secondary hover:border-line hover:bg-surface-elevated/55 hover:text-content",
              )}
              aria-pressed={active}
              onClick={() => onChange(m.id)}
            >
              <span
                aria-hidden
                className={cn(
                  "inline-block h-1.5 w-1.5 rounded-full transition-shadow",
                  m.dot,
                  active && "ring-2 ring-primary/40",
                )}
              />
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
