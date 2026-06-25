import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface DsCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export function DsCard({ children, className, ...props }: DsCardProps) {
  return (
    <div
      className={cn(
        'rounded-mc-base border border-mc-border bg-mc-surface p-4',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function DsCardHeader({ children, className, ...props }: DsCardProps) {
  return (
    <div className={cn('mb-4 flex items-center justify-between gap-3', className)} {...props}>
      {children}
    </div>
  )
}

export function DsCardTitle({ children, className, ...props }: DsCardProps) {
  return (
    <p className={cn('text-sm font-semibold text-mc-text', className)} {...props}>
      {children}
    </p>
  )
}

export function DsCardMeta({ children, className, ...props }: DsCardProps) {
  return (
    <p className={cn('mt-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-mc-muted', className)} {...props}>
      {children}
    </p>
  )
}
