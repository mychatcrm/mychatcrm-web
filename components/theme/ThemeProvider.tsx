'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export type McTheme = 'light' | 'dim' | 'dark'

const ORDER: McTheme[] = ['light', 'dim', 'dark']

interface ThemeContextValue {
  theme: McTheme
  cycleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  cycleTheme: () => {},
})

function applyTheme(t: McTheme) {
  const cl = document.documentElement.classList
  cl.remove('dim', 'dark')
  if (t === 'dim') cl.add('dim')
  else if (t === 'dark') cl.add('dark')
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<McTheme>('light')

  useEffect(() => {
    const stored = (localStorage.getItem('mcTheme') ?? 'light') as McTheme
    const valid: McTheme[] = ['light', 'dim', 'dark']
    const t = valid.includes(stored) ? stored : 'light'
    applyTheme(t)
    setTheme(t)
  }, [])

  const cycleTheme = useCallback(() => {
    setTheme(prev => {
      const next = ORDER[(ORDER.indexOf(prev) + 1) % 3]
      applyTheme(next)
      localStorage.setItem('mcTheme', next)
      return next
    })
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
