'use client'

import { ThemeProvider } from 'next-themes'
import { Toaster } from '@/components/ui/sonner'
import ThemeClientProvider from '@/components/theme/ThemeClientProvider'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem storageKey="stockcasa-theme">
      <ThemeClientProvider>
        {children}
      </ThemeClientProvider>
      <Toaster richColors position="top-center" />
    </ThemeProvider>
  )
}
