'use client'

import { Moon, MoonStar, Sun, type LucideIcon } from 'lucide-react'
import { useTheme, type McTheme } from './ThemeProvider'

const ICON_MAP: Record<McTheme, LucideIcon> = {
  light: Sun,
  dim: MoonStar,
  dark: Moon,
}

const LABEL_MAP: Record<McTheme, string> = {
  light: 'Tema claro — trocar para Cinza',
  dim: 'Tema cinza — trocar para Preto',
  dark: 'Tema preto — trocar para Claro',
}

export function ThemeSwitchButton({ className }: { className?: string }) {
  const { theme, cycleTheme } = useTheme()
  const Icon = ICON_MAP[theme]

  return (
    <button
      onClick={cycleTheme}
      aria-label={LABEL_MAP[theme]}
      className={[
        'rounded-mc-base p-2 transition-colors',
        'text-mc-muted hover:bg-mc-surface-2 hover:text-mc-text',
        'active:scale-[0.98]',
        className ?? '',
      ].join(' ')}
    >
      <Icon size={18} strokeWidth={1.9} />
    </button>
  )
}
