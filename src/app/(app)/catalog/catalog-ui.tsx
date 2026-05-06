'use client'

import { Check, ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { filterBySearch, normalizeSearchText } from '@/lib/search'
import { cn } from '@/lib/utils'

type SectionOpt = { id: string; name: string }

/** Combo único: muestra selección, permite escribir para filtrar y elegir; opciones ordenadas alfabéticamente. */
export function SectionSearchCombo(props: {
  id?: string
  label?: string
  sections: SectionOpt[]
  value: string | 'all'
  onChange: (v: string | 'all') => void
  allLabel?: string
  placeholder?: string
  className?: string
}) {
  const { sections, value, onChange, allLabel = 'Todas las secciones', placeholder = 'Escribe para filtrar…' } =
    props
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const sorted = useMemo(
    () => [...sections].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })),
    [sections]
  )
  const filtered = useMemo(
    () => (normalizeSearchText(q) ? filterBySearch(sorted, q, (s) => s.name) : sorted),
    [sorted, q]
  )

  const selectedLabel =
    value === 'all' ? allLabel : sorted.find((s) => s.id === value)?.name ?? '—'

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div ref={ref} className={cn('relative min-w-[200px] flex-1', props.className)}>
      {props.label ? <Label className="mb-1.5 block text-[12px]">{props.label}</Label> : null}
      <Button
        id={props.id}
        type="button"
        variant="outline"
        aria-expanded={open}
        className="h-9 w-full justify-between gap-2 px-3 font-normal"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate text-left text-[13px]">{selectedLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </Button>
      {open ? (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover p-2 shadow-md">
          <Input
            className="app-input mb-2 h-8 text-[13px]"
            placeholder={placeholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <ul className="max-h-56 overflow-auto text-[13px]">
            <li className="border-b border-border last:border-0">
              <button
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-muted',
                  value === 'all' && 'bg-muted font-medium'
                )}
                onClick={() => {
                  onChange('all')
                  setOpen(false)
                  setQ('')
                }}
              >
                {value === 'all' ? <Check className="h-3.5 w-3.5" /> : <span className="w-3.5" />}
                {allLabel}
              </button>
            </li>
            {filtered.map((s) => (
              <li key={s.id} className="border-b border-border last:border-0">
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-muted',
                    value === s.id && 'bg-muted font-medium'
                  )}
                  onClick={() => {
                    onChange(s.id)
                    setOpen(false)
                    setQ('')
                  }}
                >
                  {value === s.id ? <Check className="h-3.5 w-3.5" /> : <span className="w-3.5" />}
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

/** Encabezado estándar de pestaña tipo ERP. */
export function CatalogTabHeader(props: { title: string; description: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{props.title}</h2>
      <p className="max-w-3xl text-[13px] text-muted-foreground">{props.description}</p>
    </div>
  )
}

/** Superposición discreta de carga sobre la grilla (no bloquea toda la página). */
export function GridLoadingMask(props: { show: boolean; children: ReactNode }) {
  return (
    <div className="relative">
      {props.children}
      {props.show ? (
        <div className="pointer-events-none absolute inset-0 flex items-start justify-center rounded-lg bg-background/50 pt-10">
          <span className="rounded-md border border-border bg-card px-3 py-1.5 text-[12px] text-muted-foreground shadow-sm">
            Cargando…
          </span>
        </div>
      ) : null}
    </div>
  )
}

type ComboOpt = { id: string; name: string }

/**
 * Combo filtro con lista local ordenada: trigger + búsqueda + estados cargando / vacío.
 * Las opciones vienen del padre (p. ej. servidor acotado); aquí solo se filtran al escribir.
 */
export function CatalogFilterCombo(props: {
  id?: string
  label: string
  options: ComboOpt[]
  value: string | 'all'
  onChange: (v: string | 'all') => void
  allLabel: string
  placeholder?: string
  className?: string
  loading?: boolean
  emptyHint?: string
  /** Si el valor está fuera de `options`, muestra este texto en el botón. */
  selectionHint?: string | null
}) {
  const {
    options,
    value,
    onChange,
    allLabel,
    placeholder = 'Filtrar lista…',
    loading = false,
    emptyHint = 'No se encontraron resultados.',
    selectionHint,
  } = props
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const sorted = useMemo(
    () => [...options].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })),
    [options]
  )
  const filtered = useMemo(
    () => (normalizeSearchText(q) ? filterBySearch(sorted, q, (s) => s.name) : sorted),
    [sorted, q]
  )

  const pickedName = sorted.find((s) => s.id === value)?.name
  const selectedLabel =
    value === 'all'
      ? allLabel
      : pickedName || selectionHint?.trim() || '—'

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div ref={ref} className={cn('relative min-w-[200px] flex-1', props.className)}>
      <Label className="mb-1.5 block text-[12px]">{props.label}</Label>
      <Button
        id={props.id}
        type="button"
        variant="outline"
        aria-expanded={open}
        className="h-9 w-full justify-between gap-2 px-3 font-normal"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate text-left text-[13px]">{selectedLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </Button>
      {open ? (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover p-2 shadow-md">
          <Input
            className="app-input mb-2 h-8 text-[13px]"
            placeholder={placeholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          {loading ? (
            <p className="px-2 py-2 text-[12px] text-muted-foreground">Cargando opciones…</p>
          ) : null}
          <ul className="max-h-56 overflow-auto text-[13px]">
            <li className="border-b border-border last:border-0">
              <button
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-muted',
                  value === 'all' && 'bg-muted font-medium'
                )}
                onClick={() => {
                  onChange('all')
                  setOpen(false)
                  setQ('')
                }}
              >
                {value === 'all' ? <Check className="h-3.5 w-3.5" /> : <span className="w-3.5" />}
                {allLabel}
              </button>
            </li>
            {!loading && filtered.length === 0 ? (
              <li className="px-2 py-2 text-[12px] text-muted-foreground">{emptyHint}</li>
            ) : null}
            {filtered.map((s) => (
              <li key={s.id} className="border-b border-border last:border-0">
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-muted',
                    value === s.id && 'bg-muted font-medium'
                  )}
                  onClick={() => {
                    onChange(s.id)
                    setOpen(false)
                    setQ('')
                  }}
                >
                  {value === s.id ? <Check className="h-3.5 w-3.5" /> : <span className="w-3.5" />}
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

/** Filas esqueleto dentro de la tabla de productos (sin blur ni overlay sobre datos). */
export function CatalogProductsTableSkeleton(props: { colCount: number; rows?: number }) {
  const n = props.rows ?? 8
  const cols = props.colCount
  return (
    <>
      {Array.from({ length: n }).map((_, i) => (
        <tr key={`sk-${i}`} className="border-b border-border last:border-0">
          {Array.from({ length: cols }).map((__, j) => (
            <td key={j} className="p-3">
              <div className="h-4 animate-pulse rounded bg-muted" />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
