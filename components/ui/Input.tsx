import type { InputHTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full min-h-[44px] rounded-xl border border-line/80 bg-surface-deep px-3.5 py-2.5 text-base font-normal text-content transition-all duration-150 sm:min-h-[42px] sm:py-2 sm:text-sm",
          "placeholder:text-content-faint",
          "hover:border-line",
          "focus:border-primary/70 focus:bg-surface-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-deep",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        {...props}
      />
    );
  },
);
