import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = {
  default:  "border-line/70 bg-surface-elevated/60 text-content-secondary",
  primary:  "border-primary/30 bg-primary/[0.08] text-primary",
  success:  "border-success/30 bg-success/[0.07] text-success",
  warning:  "border-warning/30 bg-warning/[0.07] text-warning",
  danger:   "border-error/30 bg-error/[0.07] text-error",
  info:     "border-info/30 bg-info/[0.07] text-info",
} as const;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  variant?: keyof typeof badgeVariants;
}

export function Badge({
  children,
  className,
  variant = "default",
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-[18px]",
        badgeVariants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
