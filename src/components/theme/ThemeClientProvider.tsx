'use client'

import { useEffect } from 'react'
import { UI_STYLE_STORAGE_KEY, applyUiStyleFromStorage } from '@/lib/ui-styles'

/** Debe coincidir con el script inline en `src/app/layout.tsx`. */
export const COLOR_MODE_STORAGE_KEY = 'stockcasa-theme'

export type ColorModePreference = 'light' | 'dark' | 'system'

export function applyColorModeFromStorage() {
  const root = document.documentElement
  const stored = localStorage.getItem(COLOR_MODE_STORAGE_KEY) as ColorModePreference | null
  if (stored === 'dark') {
    root.classList.add('dark')
    return
  }
  if (stored === 'light') {
    root.classList.remove('dark')
    return
  }
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

export default function ThemeClientProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    applyColorModeFromStorage()
    applyUiStyleFromStorage()
    function onStorage(e: StorageEvent) {
      if (e.key === COLOR_MODE_STORAGE_KEY || e.key === null) {
        applyColorModeFromStorage()
      }
      if (e.key === UI_STYLE_STORAGE_KEY || e.key === null) {
        applyUiStyleFromStorage()
      }
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    function onSchemeChange() {
      const stored = localStorage.getItem(COLOR_MODE_STORAGE_KEY)
      if (stored !== 'light' && stored !== 'dark') {
        applyColorModeFromStorage()
      }
    }
    window.addEventListener('storage', onStorage)
    mq.addEventListener('change', onSchemeChange)
    return () => {
      window.removeEventListener('storage', onStorage)
      mq.removeEventListener('change', onSchemeChange)
    }
  }, [])

  return children
}
