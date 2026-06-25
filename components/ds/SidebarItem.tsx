'use client'

import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface DsSidebarItemProps {
  icon: LucideIcon
  label: string
  isActive?: boolean
  collapsed?: boolean
  className?: string
  onClick?: () => void
}

export function DsSidebarItem({
  icon: Icon,
  label,
  isActive = false,
  collapsed = false,
  className,
  onClick,
}: DsSidebarItemProps) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-label={label}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex h-10 w-full items-center gap-3 rounded-mc-base px-3 transition-colors duration-150',
        'text-sm font-medium',
        collapsed && 'justify-center px-0',
        isActive
          ? 'bg-[rgba(242,68,0,0.16)] text-mc-brand'
          : 'text-mc-muted hover:bg-mc-surface-2 hover:text-mc-text',
        className,
      )}
    >
      <Icon size={18} strokeWidth={1.9} aria-hidden />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  )
}
