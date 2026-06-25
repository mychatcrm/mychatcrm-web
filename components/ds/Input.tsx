import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export const DsInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function DsInput({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'w-full min-h-[44px] rounded-mc-base border border-mc-border bg-mc-surface-2',
          'px-4 py-2.5 text-sm font-normal text-mc-text',
          'placeholder:text-mc-muted',
          'transition-colors duration-150',
          'hover:border-mc-muted',
          'focus:border-primary/80 focus:bg-mc-surface focus:outline-none',
          'focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1 focus-visible:ring-offset-mc-bg',
          'disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        {...props}
      />
    )
  },
)
