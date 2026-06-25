import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type DsButtonVariant = 'primary' | 'dark' | 'secondary' | 'ghost' | 'link' | 'success' | 'danger'
export type DsButtonSize = 'sm' | 'md' | 'lg'

const variants: Record<DsButtonVariant, string> = {
  primary:   'bg-mc-brand text-white hover:bg-[#B22A00]',
  dark:      'bg-mc-coal text-white hover:bg-[#182736]',
  secondary: 'border border-mc-border bg-mc-surface text-mc-text hover:bg-mc-surface-2',
  ghost:     'text-mc-muted hover:bg-mc-surface-2 hover:text-mc-text',
  link:      'text-mc-brand underline-offset-4 hover:underline',
  success:   'bg-success text-white hover:bg-[#007A3D]',
  danger:    'bg-error text-white hover:bg-rose-600',
}

const sizes: Record<DsButtonSize, string> = {
  sm: 'min-h-[38px] px-[22px] py-[10px] text-[13px]',
  md: 'min-h-[42px] px-[28px] py-[12px] text-sm',
  lg: 'min-h-[48px] px-[32px] py-[14px] text-base',
}

export interface DsButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: DsButtonVariant
  size?: DsButtonSize
  isLoading?: boolean
  children: ReactNode
}

export function DsButton({
  variant = 'primary',
  size = 'md',
  isLoading,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}: DsButtonProps) {
  const isLink = variant === 'link'

  return (
    <button
      type={type}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cn(
        'inline-flex touch-manipulation items-center justify-center gap-2 font-medium transition-colors duration-150',
        'rounded-mc-base',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-mc-bg',
        'disabled:pointer-events-none disabled:opacity-50',
        'active:scale-[0.98]',
        isLink ? 'p-0' : sizes[size],
        variants[variant],
        className,
      )}
      {...props}
    >
      {isLoading && (
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      )}
      {children}
    </button>
  )
}
