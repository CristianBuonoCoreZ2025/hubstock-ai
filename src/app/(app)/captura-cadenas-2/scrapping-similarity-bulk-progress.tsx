'use client'

import { useEffect, useState } from 'react'
import { Loader2, Zap, Trash2, Brain } from 'lucide-react'
import type { ScrappingSimilarityPrepSummary } from '@/server/retail/scrapping/scrapping-similarity-bulk-summary'

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
  /** Resumen motor base (antes de aplicar vínculos); null si no se cargó */
  prepSummary?: ScrappingSimilarityPrepSummary | null
  prepSummaryLoading?: boolean
}

/* Las animaciones (bulk-shimmer, bulk-fade-up, bulk-count-pop, bulk-pulse-ring)
   están definidas en globals.css para centralizar estilos. */

function formatElapsedDuration(ms: number): string {
  const sec = Math.floor(ms / 1000)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h} h ${m} min ${s} s`
  if (m > 0) return `${m} min ${s} s`
  return `${s} s`
}

function ShimmerProgressBar({ pct, indeterminate }: { pct: number; indeterminate?: boolean }) {
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted/60">
      <div
        className="h-full rounded-full"
        style={{
          background: 'linear-gradient(90deg, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.3) 50%, hsl(var(--primary)) 100%)',
          backgroundSize: '200% 100%',
          animation: indeterminate ? 'bulk-shimmer 1.8s ease-in-out infinite' : undefined,
          width: indeterminate ? '100%' : `${pct}%`,
          transition: 'width 0.5s ease-out',
        }}
      />
    </div>
  )
}

export function ScrappingSimilarityBulkProgress({
  progress,
  bulkSessionStartedAtMs,
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
    if (bulkSessionStartedAtMs == null) return
    const tick = (): void => {
      setElapsedLabel(formatElapsedDuration(Date.now() - bulkSessionStartedAtMs))
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return (): void => {
      window.clearInterval(id)
      setElapsedLabel(null)
    }
  }, [bulkSessionStartedAtMs])
  const isPurge = step === 'purge'
  const effectiveTotal = total > 0 ? Math.max(total, processed) : Math.max(processed, 1)
  const displayProcessed = Math.min(processed, effectiveTotal)
  const waitingFirstBatch = !isPurge && total > 0 && processed === 0
  const pct =
    isPurge ? (processed > 0 ? 50 : 8)
    : waitingFirstBatch ? 4
    : Math.min(100, Math.round((displayProcessed / effectiveTotal) * 100))
  const remaining = Math.max(0, effectiveTotal - displayProcessed)

  return (
    <div
      className="flex flex-1 gap-6 rounded-xl border border-border bg-muted/10 p-8"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      {/* ══ COLUMNA IZQUIERDA: estado + progreso + stats ══ */}
      <div className="flex flex-1 flex-col justify-between gap-6" style={{ animation: 'bulk-fade-up 0.4s ease-out both' }}>

        {/* Header con icono animado */}
        <div className="flex items-center gap-4">
          <div className="relative flex size-14 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-primary to-violet-600 shadow-lg shadow-primary/25">
            <div
              className="absolute inset-0 rounded-2xl bg-primary/40"
              style={{ animation: 'bulk-pulse-ring 2s ease-in-out infinite' }}
            />
            {isPurge
              ? <Trash2 className="relative size-6 text-white" aria-hidden />
              : <Zap className="relative size-6 text-white" aria-hidden />
            }
          </div>
          <div>
            <h3 className="text-lg font-bold tracking-tight text-foreground">
              {isPurge ? 'Limpiando cola duplicada' : 'Homologación automática'}
            </h3>
            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
              {isPurge
                ? 'Quitando filas de scrapping que ya tienen vínculo en el catálogo.'
                : 'Procesando en el servidor. La barra se actualiza cada pocos segundos.'}
            </p>
          </div>
        </div>

        {/* Barra de progreso */}
        <div className="space-y-2" style={{ animation: 'bulk-fade-up 0.4s ease-out 0.1s both' }}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm tabular-nums">
            <span className="font-bold text-foreground">
              {isPurge ?
                purgedDuplicates > 0 ?
                  `${purgedDuplicates.toLocaleString('es-CL')} duplicada(s) quitada(s)`
                : 'Revisando scrapping…'
              : `${displayProcessed.toLocaleString('es-CL')} de ${effectiveTotal.toLocaleString('es-CL')}`}
            </span>
            <div className="flex items-center gap-3 text-xs">
              {!isPurge && elapsedLabel != null ?
                <span className="font-bold text-foreground tabular-nums">{elapsedLabel}</span>
              : null}
              {!isPurge ?
                <span className="rounded-md bg-primary/10 px-2 py-0.5 font-bold text-primary">{pct}%</span>
              : null}
            </div>
          </div>
          <ShimmerProgressBar pct={pct} indeterminate={waitingFirstBatch || isPurge} />
          <p className="text-xs text-muted-foreground">
            {isPurge ?
              'Paso 1 de 2 · limpieza automática'
            : waitingFirstBatch ?
              'Procesando el primer lote en el servidor…'
            : remaining > 0 ?
              `Faltan aprox. ${remaining.toLocaleString('es-CL')} fila(s) por analizar`
            : 'Finalizando pasada…'}
          </p>
        </div>

        {/* Stat cards */}
        <div style={{ animation: 'bulk-fade-up 0.4s ease-out 0.2s both' }}>
          {isPurge ?
            <div className="grid grid-cols-1 gap-3">
              <StatCard label="Quitadas de scrapping" value={purgedDuplicates} tone="muted" />
            </div>
          : (
            <div className={`grid gap-3 ${iaHintsStored > 0 ? 'grid-cols-5' : 'grid-cols-4'}`}>
              <StatCard label="Vinculadas" value={autoLinked} tone="emerald" />
              {iaHintsStored > 0 ?
                <StatCard label="Hints IA" value={iaHintsStored} tone="violet" />
              : null}
              <StatCard label="Nuevo" value={autoPendingNew} tone="amber" />
              <StatCard label="Revisar" value={leftForReview} tone="sky" />
              <StatCard label="Errores" value={failed} tone="muted" />
            </div>
          )}
        </div>
      </div>

      {/* ══ COLUMNA DERECHA: estimación previa ══ */}
      {!isPurge ?
        <div
          className="w-80 shrink-0 rounded-xl border border-border bg-card px-5 py-5 text-left shadow-sm"
          style={{ animation: 'bulk-fade-up 0.4s ease-out 0.15s both' }}
        >
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <Brain className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-bold tracking-tight text-foreground">Estimación previa</p>
          </div>
          {prepSummaryLoading ?
            <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
              Analizando productos pendientes…
            </p>
          : prepSummary ?
            <>
              <p className="mt-3 text-xs tabular-nums text-muted-foreground">
                <span className="text-2xl font-bold tabular-nums text-foreground">
                  {prepSummary.totalPending.toLocaleString('es-CL')}
                </span>{' '}
                producto(s) pendientes
              </p>
              {prepSummary.prepSliceError ?
                <p className="mt-3 text-xs text-amber-800 dark:text-amber-200">{prepSummary.prepSliceError}</p>
              : (
                <div className="mt-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2">
                    <span className="text-xs text-emerald-700">Autovínculo</span>
                    <span className="text-sm font-bold tabular-nums text-emerald-700">{prepSummary.estimatedAutoLink.toLocaleString('es-CL')}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2">
                    <span className="text-xs text-amber-700">Nuevos</span>
                    <span className="text-sm font-bold tabular-nums text-amber-700">{prepSummary.estimatedAutoPendingNew.toLocaleString('es-CL')}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 py-2">
                    <span className="text-xs text-sky-700">Para revisión</span>
                    <span className="text-sm font-bold tabular-nums text-sky-700">{prepSummary.estimatedNeedsReview.toLocaleString('es-CL')}</span>
                  </div>
                  <div className={`flex items-center justify-between rounded-lg border px-3 py-2 ${prepSummary.iaEnabled ? 'border-violet-500/20 bg-violet-500/10' : 'border-border bg-muted/40'}`}>
                    <span className={`text-xs ${prepSummary.iaEnabled ? 'text-violet-700' : 'text-muted-foreground'}`}>
                      {prepSummary.iaEnabled ? 'Llamadas IA' : 'IA desactivada'}
                    </span>
                    {prepSummary.iaEnabled ?
                      <span className="text-sm font-bold tabular-nums text-violet-700">{prepSummary.estimatedIaInvocations.toLocaleString('es-CL')}</span>
                    : null}
                  </div>
                </div>
              )}
              <p className="mt-3 text-[11px] leading-snug text-muted-foreground/60">{prepSummary.disclaimer}</p>
            </>
          : (
            <p className="mt-4 text-xs text-muted-foreground">El resumen estará disponible una vez se analicen los productos.</p>
          )}
        </div>
      : null}
    </div>
  )
}

function StatCard(props: {
  label: string
  value: number
  tone: 'emerald' | 'amber' | 'sky' | 'violet' | 'muted'
}) {
  const toneClasses: Record<typeof props.tone, { card: string; num: string }> = {
    emerald: { card: 'border-emerald-500/20 bg-emerald-500/5', num: 'text-emerald-700' },
    amber:   { card: 'border-amber-500/20 bg-amber-500/5',     num: 'text-amber-700' },
    sky:     { card: 'border-sky-500/20 bg-sky-500/5',         num: 'text-sky-700' },
    violet:  { card: 'border-violet-500/20 bg-violet-500/5',   num: 'text-violet-700' },
    muted:   { card: 'border-border bg-muted/30',              num: 'text-muted-foreground' },
  }
  const t = toneClasses[props.tone]

  return (
    <div
      className={`rounded-xl border px-3 py-3 text-center shadow-sm ${t.card}`}
      style={{ animation: `bulk-count-pop 0.4s ease-out both` }}
    >
      <p className={`text-xl font-bold tabular-nums ${t.num}`}>
        {props.value.toLocaleString('es-CL')}
      </p>
      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{props.label}</p>
    </div>
  )
}
