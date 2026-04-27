"use client";

import { cn } from "@/lib/utils";

interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  id: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, description, id, disabled }: ToggleProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="text-sm font-medium text-content">
          {label}
        </label>
        {description ? <p className="mt-1 text-xs text-content-muted">{description}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card",
          checked
            ? "border-primary/40 bg-gradient-primary"
            : "border-line/80 bg-surface-deep",
          disabled && "cursor-not-allowed opacity-50",
        )}
        aria-label={label}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-[18px] w-[18px] transform rounded-full bg-white transition-transform duration-200 ease-out",
            checked ? "translate-x-[22px]" : "translate-x-[2px]",
          )}
        />
      </button>
    </div>
  );
}
