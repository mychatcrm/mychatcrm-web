/**
 * PanelButton — versão DS do Button exclusiva para /dashboard e /admin.
 *
 * API idêntica ao components/ui/Button.tsx, mas com:
 *  - Tamanhos maiores do DS (px-7 py-3.5 no md, + xs size)
 *  - rounded-xl (radius DS 0.45rem via panel-appearance override)
 *  - Sem min-h forçado (padding generoso já garante altura adequada)
 *  - Zero box-shadow — flat design
 *
 * NUNCA importar fora de components/dashboard/**, components/admin/**, components/panel/**.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PANEL_BUTTON_SIZES } from "@/lib/panel-component-tokens";

const variants = {
  primary:
    "bg-primary text-white hover:bg-primary-hover active:bg-primary-hover",
  gradient:
    "bg-primary text-white hover:bg-primary-hover active:bg-primary-hover",
  secondary:
    "border border-primary/20 bg-primary/[0.07] text-primary hover:bg-primary/[0.12] hover:border-primary/35",
  navy:
    "bg-brand-secondary text-white hover:bg-brand-dark",
  outline:
    "border border-line/45 bg-surface-card/70 text-content-secondary hover:text-content hover:border-line/60 hover:bg-surface-elevated/45",
  ghost:
    "text-content-secondary hover:text-content hover:bg-surface-elevated/35 active:bg-surface-elevated/50",
  link:
    "bg-transparent text-primary hover:underline p-0 h-auto font-semibold",
  success:
    "bg-success text-white hover:brightness-95",
  danger:
    "bg-error text-white hover:bg-rose-600",
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
  const isLink = variant === "link";
  return (
    <button
      type={type}
      className={cn(
        "inline-flex touch-manipulation items-center justify-center gap-2 font-medium transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base disabled:opacity-50 disabled:pointer-events-none",
        !isLink && "rounded-xl",
        !isLink && PANEL_BUTTON_SIZES[size],
        variants[variant],
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
