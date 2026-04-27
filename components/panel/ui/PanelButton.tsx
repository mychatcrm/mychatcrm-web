/**
 * PanelButton — versão DS do Button exclusiva para /dashboard e /admin.
 *
 * API idêntica ao components/ui/Button.tsx, mas com:
 *  - Tamanhos maiores do DS (px-7 py-3.5 no md, + xs size)
 *  - rounded-panel-xl (radius DS 0.45rem)
 *  - Sem min-h forçado (padding generoso já garante altura adequada)
 *
 * NUNCA importar fora de components/dashboard/**, components/admin/**, components/panel/**.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PANEL_BUTTON_SIZES } from "@/lib/panel-component-tokens";

const variants = {
  primary:
    "bg-primary text-white hover:bg-primary-hover active:scale-[0.98]",
  gradient:
    "bg-gradient-primary text-white hover:-translate-y-[0.5px] active:translate-y-0 active:scale-[0.98]",
  secondary:
    "border border-primary/30 bg-primary/[0.08] text-primary hover:bg-primary/[0.14] hover:border-primary/45 active:scale-[0.98]",
  navy:
    "bg-brand-secondary text-white hover:bg-brand-dark active:scale-[0.98]",
  outline:
    "border border-line/90 bg-surface-card/40 text-content-secondary hover:text-content hover:border-line hover:bg-surface-elevated/50 active:scale-[0.98]",
  ghost:
    "text-content-secondary hover:text-content hover:bg-surface-elevated/40 active:bg-surface-elevated/55 active:scale-[0.98]",
  danger:
    "bg-error text-white hover:bg-rose-500 active:scale-[0.98]",
} as const;

export interface PanelButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof PANEL_BUTTON_SIZES;
  children: ReactNode;
  className?: string;
  isLoading?: boolean;
}

export function PanelButton({
  variant = "primary",
  size = "md",
  className,
  children,
  disabled,
  isLoading,
  type = "button",
  ...props
}: PanelButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex touch-manipulation items-center justify-center gap-2 font-medium transition duration-200 ease-out will-change-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        PANEL_BUTTON_SIZES[size],
        className,
      )}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...props}
    >
      {isLoading ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
      ) : null}
      {children}
    </button>
  );
}
