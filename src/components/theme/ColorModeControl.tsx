'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun, Monitor } from 'lucide-react'
import {
  COLOR_MODE_STORAGE_KEY,
  applyColorModeFromStorage,
  type ColorModePreference,
} from '@/components/theme/ThemeClientProvider'

export default function ColorModeControl() {
  const [mode, setMode] = useState<ColorModePreference>('system')

  useEffect(() => {
    const raw = localStorage.getItem(COLOR_MODE_STORAGE_KEY) as ColorModePreference | null
    if (raw === 'light' || raw === 'dark' || raw === 'system') {
      setMode(raw)
    } else {
      setMode('system')
    }
  }, [])

  function persist(next: ColorModePreference) {
    setMode(next)
    if (next === 'system') {
      localStorage.removeItem(COLOR_MODE_STORAGE_KEY)
    } else {
      localStorage.setItem(COLOR_MODE_STORAGE_KEY, next)
    }
    applyColorModeFromStorage()
  }

  const btn =
    'inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-input bg-background text-xs font-medium shadow-sm transition-colors hover:bg-muted sm:flex-none sm:px-3'

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={btn} onClick={() => persist('light')} aria-pressed={mode === 'light'}>
        <Sun className="h-4 w-4" aria-hidden />
        Día
      </button>
      <button type="button" className={btn} onClick={() => persist('dark')} aria-pressed={mode === 'dark'}>
        <Moon className="h-4 w-4" aria-hidden />
        Noche
      </button>
      <button type="button" className={btn} onClick={() => persist('system')} aria-pressed={mode === 'system'}>
        <Monitor className="h-4 w-4" aria-hidden />
        Sistema
      </button>
    </div>
  )
}
