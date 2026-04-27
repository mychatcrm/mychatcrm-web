import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

const variants = {
  primary:
    "bg-primary text-white hover:bg-primary-hover hover:-translate-y-[0.5px] active:translate-y-0 active:scale-[0.98]",
  gradient:
    "bg-gradient-primary text-white hover:-translate-y-[0.5px] active:translate-y-0 active:scale-[0.98]",
  secondary:
    "border border-primary/30 bg-primary/[0.08] text-primary hover:bg-primary/[0.14] hover:border-primary/45 active:scale-[0.98]",
  navy:
    "bg-brand-secondary text-white hover:bg-brand-dark active:scale-[0.98]",
  outline:
    "border border-line/90 bg-surface-card/40 text-content-secondary hover:text-content hover:border-line hover:bg-surface-elevated/50 active:scale-[0.98]",
  ghost: "text-content-secondary hover:text-primary hover:bg-surface-elevated/35",
} as const;

const sizes = {
  sm: "min-h-[40px] px-3.5 py-1.5 text-[13px] rounded-xl",
  md: "min-h-[44px] px-4 py-2 text-sm rounded-xl",
  lg: "min-h-[48px] px-6 py-2.5 text-base rounded-xl",
} as const;

const base =
  "inline-flex touch-manipulation items-center justify-center gap-2 text-center font-medium transition duration-200 ease-out will-change-transform hover:scale-[1.02] motion-reduce:hover:scale-100 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base";

/** Reutiliza as mesmas classes do LinkButton em um `<a>` externo (ex.: WhatsApp). */
export function linkButtonClass(
  variant: keyof typeof variants = "primary",
  size: keyof typeof sizes = "md",
  className?: string,
) {
  return cn(base, variants[variant], sizes[size], className);
}

export type LinkButtonProps = Omit<ComponentProps<typeof Link>, "className"> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  className?: string;
  children: ReactNode;
};

export function LinkButton({
  variant = "primary",
  size = "md",
  className,
  children,
  ...linkProps
}: LinkButtonProps) {
  return (
    <Link {...linkProps} className={cn(base, variants[variant], sizes[size], className)}>
      {children}
    </Link>
  );
}
