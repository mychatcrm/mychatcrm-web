import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

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

const sizes = {
  sm: "min-h-[40px] px-3.5 py-1.5 text-[13px] rounded-xl",
  md: "min-h-[44px] px-4 py-2 text-sm rounded-xl",
  lg: "min-h-[48px] px-6 py-2.5 text-base rounded-xl",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  children: ReactNode;
  className?: string;
  isLoading?: boolean;
}

export type ButtonVariant = keyof typeof variants;
export type ButtonSize = keyof typeof sizes;

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  disabled,
  isLoading,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex touch-manipulation items-center justify-center gap-2 font-medium transition duration-200 ease-out will-change-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        sizes[size],
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
