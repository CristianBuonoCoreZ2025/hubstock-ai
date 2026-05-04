'use client'

import { ThemeProvider } from 'next-themes'
import { Toaster } from '@/components/ui/sonner'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem storageKey="stockcasa-theme">
      {children}
      <Toaster richColors position="top-center" />
    </ThemeProvider>
  )
}
