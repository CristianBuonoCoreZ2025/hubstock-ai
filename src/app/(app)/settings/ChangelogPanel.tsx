'use client'

import { useCallback, useEffect, useState } from 'react'
import { BookOpen, ChevronDown, ChevronUp, Clock, Tag } from 'lucide-react'
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

export default function ChangelogPanel() {
  const [rows, setRows] = useState<ChangelogRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await getAppChangelogAction()
    if (res.ok) {
      setRows(res.rows)
    } else {
      setError(res.error)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className="app-panel">
      <div className="flex items-center gap-3">
        <BookOpen className="h-5 w-5 text-primary" />
        <h2 className="text-sm font-semibold">Versiones del sistema</h2>
      </div>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Historial de mejoras, correcciones y cambios arquitectonicos aplicados.
      </p>

      {loading && (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4 animate-spin" />
          Cargando historial...
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">No hay registros de versiones.</p>
      )}

      <div className="mt-4 space-y-3">
        {rows.map((row) => {
          const isOpen = expanded.has(row.id)
          return (
            <div
              key={row.id}
              className="rounded-xl border border-border/60 bg-card/50 p-4 transition-colors hover:bg-card"
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
    </section>
  )
}
