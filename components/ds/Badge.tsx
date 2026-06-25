import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

const variants = {
  brand:   'bg-[#FFF4EE] text-[#B22A00] border border-[#F7DDCF]',
  success: 'bg-[#ECFDF3] text-[#067A3C] border border-[#C9EFD6]',
  info:    'bg-[#DBEAFE] text-[#1D4ED8] border border-[#BFDBFE]',
  warning: 'bg-amber-50 text-amber-700 border border-amber-200',
  danger:  'bg-rose-50 text-rose-700 border border-rose-200',
  neutral: 'bg-mc-surface-2 text-mc-muted border border-mc-border',
} as const

export type DsBadgeVariant = keyof typeof variants

export interface DsBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: DsBadgeVariant
  dot?: boolean
  children: ReactNode
}

export function DsBadge({ variant = 'neutral', dot, children, className, ...props }: DsBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium leading-[18px]',
        variants[variant],
        className,
      )}
      {...props}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  )
}
