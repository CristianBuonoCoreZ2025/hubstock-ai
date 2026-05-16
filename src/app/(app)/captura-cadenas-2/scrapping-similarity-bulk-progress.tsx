'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ScrappingSimilarityPrepSummary } from '@/app/actions/retail-scrapping'

export type SimilarityBulkProgressState = {
  /** purge = limpiar scrapping ya homologado; homologate = pasada de similitud */
  step: 'purge' | 'homologate'
  total: number
  processed: number
  purgedDuplicates: number
  autoLinked: number
  /** Filas donde se guardó hint IA sin autovínculo */
  iaHintsStored?: number
  autoPendingNew: number
  leftForReview: number
  failed: number
}

export type ScrappingSimilarityBulkProgressProps = {
  progress: SimilarityBulkProgressState
  /** Epoch ms cuando empezó esta pasada (cliente); muestra tiempo transcurrido */
  bulkSessionStartedAtMs?: number | null
  onSkipToReview?: () => void
  /** Resumen motor base (antes de aplicar vínculos); null si no se cargó */
  prepSummary?: ScrappingSimilarityPrepSummary | null
  prepSummaryLoading?: boolean
}

function formatElapsedDuration(ms: number): string {
  const sec = Math.floor(ms / 1000)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h} h ${m} min ${s} s`
  if (m > 0) return `${m} min ${s} s`
  return `${s} s`
}

export function ScrappingSimilarityBulkProgress({
  progress,
  bulkSessionStartedAtMs,
  onSkipToReview,
  prepSummary = null,
  prepSummaryLoading = false,
}: ScrappingSimilarityBulkProgressProps) {
  const {
    step,
    total,
    processed,
    purgedDuplicates,
    autoLinked,
    iaHintsStored = 0,
    autoPendingNew,
    leftForReview,
    failed,
  } = progress

  const [elapsedLabel, setElapsedLabel] = useState<string | null>(() =>
    bulkSessionStartedAtMs != null ? formatElapsedDuration(0) : null,
  )

  useEffect(() => {
    if (bulkSessionStartedAtMs == null) {
      setElapsedLabel(null)
      return
    }
    const tick = (): void => {
      setElapsedLabel(formatElapsedDuration(Date.now() - bulkSessionStartedAtMs))
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return (): void => window.clearInterval(id)
  }, [bulkSessionStartedAtMs])
  const isPurge = step === 'purge'
  const denom = total > 0 ? total : Math.max(processed, 1)
  const waitingFirstBatch = !isPurge && total > 0 && processed === 0
  const pct =
    isPurge ? (processed > 0 ? 50 : 8)
    : waitingFirstBatch ? 4
    : Math.min(100, Math.round((processed / denom) * 100))
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
            : 'Procesando en el servidor; la barra se actualiza cada pocos segundos. Si ya corriste esta pasada, puedes ir directo a la grilla.'}
          </p>
        </div>
      </div>

      {!isPurge ?
        <div className="w-full max-w-xl rounded-lg border border-border bg-background/90 px-4 py-3 text-left text-sm shadow-sm">
          <p className="font-semibold text-foreground">Vista previa · motor base (sin aplicar aún)</p>
          {prepSummaryLoading ?
            <p className="mt-2 flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
              Consultando la base y estimando desglose…
            </p>
          : prepSummary ?
            <>
              <p className="mt-2 tabular-nums text-muted-foreground">
                <span className="font-medium text-foreground">
                  {prepSummary.totalPending.toLocaleString('es-CL')}
                </span>{' '}
                fila(s){' '}
                <span className="text-muted-foreground">
                  pending
                  {prepSummary.rowsAnalyzed > 0 && prepSummary.rowsAnalyzed !== prepSummary.totalPending ?
                    ` · analizadas para estimación: ${prepSummary.rowsAnalyzed.toLocaleString('es-CL')}`
                  : null}
                </span>
              </p>
              {prepSummary.prepSliceError ?
                <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">{prepSummary.prepSliceError}</p>
              : (
                <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs tabular-nums sm:grid-cols-3">
                  <li>
                    Autovínculo estimado:{' '}
                    <span className="font-medium text-foreground">
                      {prepSummary.estimatedAutoLink.toLocaleString('es-CL')}
                    </span>
                  </li>
                  <li>
                    Producto nuevo estimado:{' '}
                    <span className="font-medium text-foreground">
                      {prepSummary.estimatedAutoPendingNew.toLocaleString('es-CL')}
                    </span>
                  </li>
                  <li>
                    Revisión estimada:{' '}
                    <span className="font-medium text-foreground">
                      {prepSummary.estimatedNeedsReview.toLocaleString('es-CL')}
                    </span>
                  </li>
                  {prepSummary.iaEnabled ?
                    <li className="col-span-2 sm:col-span-3">
                      Alcance IA (si la pasada sigue activa): hasta{' '}
                      <span className="font-medium text-foreground">
                        {prepSummary.estimatedIaInvocations.toLocaleString('es-CL')}
                      </span>{' '}
                      fila(s) podrían llamar al modelo · tope por corrida:{' '}
                      {prepSummary.iaMaxPerRun.toLocaleString('es-CL')}
                    </li>
                  : (
                    <li className="col-span-2 text-muted-foreground sm:col-span-3">IA desactivada o sin API key.</li>
                  )}
                  {prepSummary.fastBaseRpc ?
                    <li className="col-span-2 text-muted-foreground sm:col-span-3">
                      Corte en base (máx. score RPC):{' '}
                      <span className="font-medium text-foreground">
                        {prepSummary.fastBaseRpc.conservativeNoIaByCompositeCeil.toLocaleString('es-CL')}
                      </span>{' '}
                      fila(s) quedan por debajo del piso IA incluso con la cota 0.42×RPC+0.58 · máx. RPC{' '}
                      {prepSummary.fastBaseRpc.maxTopRpc.toFixed(3)} · mín. RPC{' '}
                      {prepSummary.fastBaseRpc.minTopRpc.toFixed(3)} · filas puntuadas:{' '}
                      {prepSummary.fastBaseRpc.rowsScored.toLocaleString('es-CL')}
                    </li>
                  : null}
                </ul>
              )}
              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{prepSummary.disclaimer}</p>
            </>
          : (
            <p className="mt-2 text-xs text-muted-foreground">No hay resumen cargado.</p>
          )}
        </div>
      : null}

      <div className="w-full max-w-xl space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm tabular-nums">
          <span className="font-medium text-foreground">
            {isPurge ?
              purgedDuplicates > 0 ?
                `${purgedDuplicates.toLocaleString('es-CL')} duplicada(s) quitada(s)`
              : 'Revisando scrapping…'
            : `${processed.toLocaleString('es-CL')} de ${total.toLocaleString('es-CL')}`}
          </span>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {!isPurge && elapsedLabel != null ?
              <span
                className="text-muted-foreground"
                aria-label={`Tiempo transcurrido: ${elapsedLabel}`}
              >
                Transcurrido: <span className="font-medium text-foreground">{elapsedLabel}</span>
              </span>
            : null}
            {!isPurge ?
              <span className="text-muted-foreground">{pct}%</span>
            : null}
          </div>
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
          : waitingFirstBatch ?
            'Procesando el primer lote en el servidor…'
          : remaining > 0 ?
            `Faltan aprox. ${remaining.toLocaleString('es-CL')} fila(s) por analizar`
          : 'Finalizando pasada…'}
        </p>
      </div>

      {onSkipToReview && !isPurge ?
        <Button type="button" variant="outline" onClick={onSkipToReview}>
          Ir a revisión manual (omitir pasada automática)
        </Button>
      : null}

      {isPurge ?
        <div className="grid w-full max-w-xl grid-cols-1 gap-3">
          <StatCard label="Quitadas de scrapping" value={purgedDuplicates} tone="muted" />
        </div>
      : (
        <div
          className={`grid w-full max-w-xl gap-3 ${iaHintsStored > 0 ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4'}`}
        >
          <StatCard label="Vinculadas" value={autoLinked} tone="emerald" />
          {iaHintsStored > 0 ?
            <StatCard label="Sugerencias IA guardadas" value={iaHintsStored} tone="sky" />
          : null}
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
