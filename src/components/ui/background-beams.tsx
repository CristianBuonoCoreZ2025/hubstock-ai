'use client'

import { cn } from '@/lib/utils'

/**
 * Fondo de aplicación: lienzo claro con malla sutil o capa oscura premium.
 * Sin haces «neon» en modo día — alineado a interfaces tipo Notus / SaaS claro.
 */
export function PremiumBackground() {
  return (
    <>
      <div className="premium-bg-base fixed inset-0 z-0" aria-hidden />
      <div
        className={cn(
          'premium-bg-mesh pointer-events-none fixed inset-0 z-0',
          'opacity-100'
        )}
        aria-hidden
      />
      <div
        className="premium-grid-lines pointer-events-none fixed inset-0 z-0"
        aria-hidden
      />
    </>
  )
}

/** @deprecated usar PremiumBackground */
export const NodusBackground = PremiumBackground
