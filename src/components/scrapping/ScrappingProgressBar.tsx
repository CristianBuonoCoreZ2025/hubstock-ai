'use client'

import { cn } from '@/lib/utils'

type ScrappingProgressBarProps = {
  percent: number
  active?: boolean
  tone?: 'blue' | 'primary'
  className?: string
}

/**
 * Barra de progreso con ancho dinámico. El único estilo inline permitido
 * es la variable CSS --scrapping-progress (definida en scrapping-ui.css).
 */
export function ScrappingProgressBar({
  percent,
  active = true,
  tone = 'blue',
  className,
}: ScrappingProgressBarProps) {
  const pct = active ? Math.min(100, Math.max(0, percent)) : 0

  return (
    <div
      className={cn(
        'scrapping-progress-track',
        tone === 'primary' && 'scrapping-progress-track--muted',
        className,
      )}
    >
      <div
        className={cn(
          'scrapping-progress-fill',
          tone === 'primary' && 'scrapping-progress-fill--primary',
          !active && 'scrapping-progress-fill--empty',
        )}
        style={{ '--scrapping-progress': `${pct}%` } as React.CSSProperties}
      />
    </div>
  )
}
