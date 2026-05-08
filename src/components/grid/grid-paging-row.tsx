'use client'

import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

export type GridPagingRowProps = {
  disablePrev: boolean
  disableNext: boolean
  onPrev: () => void
  onNext: () => void
  /** Índice base 0 */
  pageIndex: number
  /** Si es false, solo se muestra «Página N» más metaSuffix (p. ej. modales). */
  hidePageSize?: boolean
  pageSize?: number
  metaSuffix?: ReactNode
  trailing?: ReactNode
  className?: string
}

/**
 * Controles de paginación repetidos arriba y abajo de grillas (reglas UX / grillas).
 */
export function GridPagingRow(props: GridPagingRowProps) {
  const {
    disablePrev,
    disableNext,
    onPrev,
    onNext,
    pageIndex,
    hidePageSize = false,
    pageSize,
    metaSuffix,
    trailing,
    className,
  } = props

  const sizePart =
    hidePageSize || pageSize == null ? null : (
      <>
        {' '}
        · Tamaño {pageSize}
      </>
    )

  return (
    <div
      className={
        className ??
        'flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground'
      }
    >
      <Button type="button" variant="outline" size="sm" disabled={disablePrev} onClick={onPrev}>
        Anterior
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={disableNext} onClick={onNext}>
        Siguiente
      </Button>
      <span>
        Página {pageIndex + 1}
        {sizePart}
        {metaSuffix}
      </span>
      {trailing}
    </div>
  )
}
