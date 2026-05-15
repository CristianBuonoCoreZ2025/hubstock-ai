'use client'

import { Loader2 } from 'lucide-react'

export type SimilarityBulkProgressState = {
  /** purge = limpiar scrapping ya homologado; homologate = pasada de similitud */
  step: 'purge' | 'homologate'
  total: number
  processed: number
  purgedDuplicates: number
  autoLinked: number
  autoPendingNew: number
  leftForReview: number
  failed: number
}

export type ScrappingSimilarityBulkProgressProps = {
  progress: SimilarityBulkProgressState
}

export function ScrappingSimilarityBulkProgress({ progress }: ScrappingSimilarityBulkProgressProps) {
  const { step, total, processed, purgedDuplicates, autoLinked, autoPendingNew, leftForReview, failed } =
    progress
  const isPurge = step === 'purge'
  const denom = total > 0 ? total : Math.max(processed, 1)
  const pct = isPurge ? (processed > 0 ? 50 : 8) : Math.min(100, Math.round((processed / denom) * 100))
  const remaining = Math.max(0, total - processed)

  return (
    <div
      className="flex min-h-[min(52vh,520px)] flex-1 flex-col items-center justify-center gap-6 rounded-xl border border-border bg-muted/20 px-6 py-10 dark:bg-muted/10"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Loader2 className="size-7 animate-spin" aria-hidden />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            {isPurge ? 'Limpiando cola duplicada' : 'Homologación automática en curso'}
          </h3>
          <p className="mt-1 max-w-lg text-sm text-muted-foreground">
            {isPurge ?
              'Quitando filas de scrapping que ya tienen vínculo en el catálogo (misma cadena + referencia). No se tocan maestros ni vínculos.'
            : 'Analizando y homologando el resto de filas pending. Al terminar verás solo lo que requiere tu revisión.'}
          </p>
        </div>
      </div>

      <div className="w-full max-w-xl space-y-2">
        <div className="flex items-center justify-between text-sm tabular-nums">
          <span className="font-medium text-foreground">
            {isPurge ?
              purgedDuplicates > 0 ?
                `${purgedDuplicates.toLocaleString('es-CL')} duplicada(s) quitada(s)`
              : 'Revisando scrapping…'
            : `${processed.toLocaleString('es-CL')} de ${total.toLocaleString('es-CL')}`}
          </span>
          {!isPurge ?
            <span className="text-muted-foreground">{pct}%</span>
          : null}
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-center text-xs text-muted-foreground">
          {isPurge ?
            'Paso 1 de 2 · limpieza automática'
          : remaining > 0 ?
            `Faltan aprox. ${remaining.toLocaleString('es-CL')} fila(s) por analizar`
          : 'Finalizando pasada…'}
        </p>
      </div>

      {isPurge ?
        <div className="grid w-full max-w-xl grid-cols-1 gap-3">
          <StatCard label="Quitadas de scrapping" value={purgedDuplicates} tone="muted" />
        </div>
      : (
        <div className="grid w-full max-w-xl grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Vinculadas" value={autoLinked} tone="emerald" />
          <StatCard label="Producto nuevo" value={autoPendingNew} tone="amber" />
          <StatCard label="Para revisar" value={leftForReview} tone="sky" />
          <StatCard label="Errores" value={failed} tone="muted" />
        </div>
      )}
    </div>
  )
}

function StatCard(props: {
  label: string
  value: number
  tone: 'emerald' | 'amber' | 'sky' | 'muted'
}) {
  const toneClass =
    props.tone === 'emerald' ? 'text-emerald-800 dark:text-emerald-200'
    : props.tone === 'amber' ? 'text-amber-800 dark:text-amber-200'
    : props.tone === 'sky' ? 'text-sky-800 dark:text-sky-200'
    : 'text-muted-foreground'

  return (
    <div className="rounded-lg border border-border bg-background/80 px-3 py-3 text-center shadow-sm">
      <p className={`text-xl font-semibold tabular-nums ${toneClass}`}>
        {props.value.toLocaleString('es-CL')}
      </p>
      <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{props.label}</p>
    </div>
  )
}
