'use client'

import { useCallback, useEffect, useState } from 'react'
import { BookOpen, ChevronDown, ChevronUp, Clock, Tag, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getAppChangelogAction, type ChangelogRow } from '@/app/actions/changelog'

function ModuleBadge({ module }: { module: string }) {
  const colors: Record<string, string> = {
    scraping: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
    diagnostico: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    performance: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    instrumentacion: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    homologacion: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    versiones: 'bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300',
  }
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', colors[module] ?? colors.versiones)}>
      {module}
    </span>
  )
}

function TagBadge({ tag }: { tag: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
      <Tag className="h-2.5 w-2.5" />
      {tag}
    </span>
  )
}

export type ChangelogModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const INITIAL_LIMIT = 10

export function ChangelogModal({ open, onOpenChange }: ChangelogModalProps) {
  const [allRows, setAllRows] = useState<ChangelogRow[]>([])
  const [limit, setLimit] = useState(INITIAL_LIMIT)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const visibleRows = allRows.slice(0, limit)
  const hasMore = allRows.length > limit

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await getAppChangelogAction()
    if (res.ok) {
      setAllRows(res.rows)
      setLimit(INITIAL_LIMIT)
    } else {
      setError(res.error)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (open && allRows.length === 0) {
      load()
    }
  }, [open, allRows.length, load])

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-9999 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
      <div className="relative max-h-[80vh] w-full max-w-xl overflow-hidden rounded-xl border border-border bg-background shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2.5">
            <BookOpen className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">Versiones del sistema</h2>
          </div>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => onOpenChange(false)} aria-label="Cerrar">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Clock className="h-4 w-4 animate-spin" />
              Cargando historial...
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}

          {!loading && !error && allRows.length === 0 && (
            <p className="text-sm text-muted-foreground py-4">No hay registros de versiones.</p>
          )}

          <div className="space-y-3">
            {visibleRows.map((row) => {
              const isOpen = expanded.has(row.id)
              return (
                <div
                  key={row.id}
                  className="rounded-xl border border-border/60 bg-muted/30 p-4 transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-primary">v{row.version}</span>
                        <ModuleBadge module={row.module} />
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(row.created_at).toLocaleDateString('es-CL')}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-foreground">
                        {row.description}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {row.tags.map((tag) => (
                          <TagBadge key={tag} tag={tag} />
                        ))}
                      </div>
                    </div>
                    {row.files_changed.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 h-7 w-7 p-0"
                        onClick={() => toggle(row.id)}
                        aria-label={isOpen ? 'Colapsar' : 'Expandir'}
                      >
                        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    )}
                  </div>

                  {isOpen && row.files_changed.length > 0 && (
                    <div className="mt-3 rounded-lg bg-muted/40 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                        Archivos afectados
                      </p>
                      <ul className="space-y-1">
                        {row.files_changed.map((f) => (
                          <li key={f} className="text-[11px] font-mono text-muted-foreground truncate">
                            {f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {hasMore && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLimit((prev) => prev + 10)}
              >
                Ver más ({allRows.length - limit} restantes)
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
