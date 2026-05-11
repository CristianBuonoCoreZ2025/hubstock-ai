import * as React from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type GridRowIconButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  'children' | 'size'
> & {
  /** Tooltip y aria-label (misma redacción; obligatorio para acciones en grilla). */
  label: string
  children: React.ReactNode
}

/**
 * Botón de acción en celda de tabla: solo ícono, medida fija en todo el sistema de grillas.
 * Ver `.cursor/rules/ui-product-rules.mdc` § Grillas.
 */
export function GridRowIconButton({
  label,
  children,
  className,
  variant = 'outline',
  ...props
}: GridRowIconButtonProps) {
  return (
    <Button
      type="button"
      variant={variant}
      size="icon"
      title={label}
      aria-label={label}
      className={cn('shrink-0', className)}
      {...props}
    >
      {children}
    </Button>
  )
}
