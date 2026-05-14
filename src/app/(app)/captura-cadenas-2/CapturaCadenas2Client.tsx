'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, CircleCheck, LayoutGrid, Link2, Play, Square, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  barridoApiBarridoContext,
  barridoApiListRetails,
  barridoApiListRuns,
  barridoApiPersistOutcome,
  barridoApiPhase1Enqueue,
  barridoApiPhase2Seal,
  barridoApiPrepareRun,
  barridoApiProcessRunPage,
  barridoApiPurgeIfIdle,
  barridoApiRequeueFailedLatest,
  barridoApiResumeBarrido,
  barridoApiStop,
} from '@/lib/retail-scrapping-barrido-api'
import {
  applyScrappingExactCatalogMatchesAction,
  forceFinalizeScrappingRunForRetailAction,
  getScrappingHomologacionPendingCountAction,
  type ScrappingExactCatalogMatchStats,
} from '@/app/actions/retail-scrapping'
import type { RetailTargetRow, ScrappingRunRow } from '@/types/retail-scrapping-ui'
import type {
  BarridoContextResponse,
  ProcessLiderScrappingRunPageResult,
  BarridoPhase2SealResponse,
} from '@/types/retail-scrapping-barrido-api'
import { ScrappingSimilarityReviewModal } from '@/app/(app)/captura-cadenas-2/scrapping-similarity-review-modal'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const TOOLBAR_BTN = 'h-9 min-w-[172px] shrink-0'

/** Resumen legible al cerrar un barrido (éxito, error, red o corte). */
export type CapturaCadenas2SweepDiagnostic = {
  finishedAtIso: string
  runId: string | null
  retailName: string
  outcome:
    | 'cola_terminada'
    | 'detencion'
    | 'error_servidor'
    | 'corte_navegador_o_red'
    | 'sin_inicio'
    | 'salida_sin_cierre'
  outcomeHint: string
  startError?: string
  actionError?: string
  browserError?: string
  lastSnapshot: {
    done: boolean
    cancelled: boolean
    queueTotal: number
    queueProcessed: number
    queueOk: number
    queueFailed: number
    queuePending: number
    queueProcessing: number
    runStatus: string
    productsTally: number
    pageError?: string
  } | null
  persistedRun?: {
    status: string
    error_message: string | null
    total_pages: number | null
    pages_ok: number
    pages_failed: number
    rows_inserted: number | string
  }
}

function outcomeLabel(o: CapturaCadenas2SweepDiagnostic['outcome']): string {
  switch (o) {
    case 'cola_terminada':
      return 'Cola terminada (sin pendientes ni en proceso)'
    case 'detencion':
      return 'Detención (corrida cancelada)'
    case 'error_servidor':
      return 'Error devuelto por el servidor'
    case 'corte_navegador_o_red':
      return 'Corte en el navegador o red (excepción al llamar al servidor)'
    case 'sin_inicio':
      return 'No se pudo iniciar el barrido'
    case 'salida_sin_cierre':
      return 'Salida antes de tiempo (revisá pendientes y estado en base)'
    default:
      return o
  }
}

function buildSweepDiagnostic(input: {
  finishedAtIso: string
  runId: string | null
  retailName: string
  startError?: string
  actionError?: string
  browserError?: string
  lastOk?: {
    ok: true
    done: boolean
    cancelled: boolean
    queuePagesTotal: number
    queuePagesProcessed: number
    queuePagesOk: number
    queuePagesFailed: number
    queuePagesPending: number
    queuePagesProcessing: number
    runPersistedStatus: string
    scrappingRowsTally: number
    error?: string
  }
  persistedRun?: CapturaCadenas2SweepDiagnostic['persistedRun']
}): CapturaCadenas2SweepDiagnostic {
  const lastSnapshot = input.lastOk ?
    {
      done: input.lastOk.done,
      cancelled: input.lastOk.cancelled,
      queueTotal: input.lastOk.queuePagesTotal,
      queueProcessed: input.lastOk.queuePagesProcessed,
      queueOk: input.lastOk.queuePagesOk,
      queueFailed: input.lastOk.queuePagesFailed,
      queuePending: input.lastOk.queuePagesPending,
      queueProcessing: input.lastOk.queuePagesProcessing,
      runStatus: input.lastOk.runPersistedStatus,
      productsTally: input.lastOk.scrappingRowsTally,
      pageError: input.lastOk.error,
    }
  : null

  let outcome: CapturaCadenas2SweepDiagnostic['outcome'] = 'salida_sin_cierre'
  let outcomeHint =
    'El bucle terminó sin marcar cierre explícito. Revisá pendientes en base, tiempo máximo del servidor o pestaña en segundo plano.'

  if (input.startError) {
    outcome = 'sin_inicio'
    outcomeHint = input.startError
  } else if (input.browserError) {
    outcome = 'corte_navegador_o_red'
    outcomeHint =
      'Falló la llamada desde el navegador (red, pestaña cerrada, suspensión del dispositivo o límite de tiempo del proveedor de hosting). Si usás Vercel u otro serverless, revisá maxDuration y el plan.'
  } else if (input.actionError) {
    outcome = 'error_servidor'
    outcomeHint = input.actionError
  } else if (input.lastOk?.cancelled) {
    outcome = 'detencion'
    outcomeHint = 'Corrida cancelada (Detener scrapping o nuevo barrido que reemplazó la cola).'
  } else if (input.lastOk?.done && !input.lastOk.cancelled) {
    const orphan = input.lastOk.queuePagesPending + input.lastOk.queuePagesProcessing
    outcome = 'cola_terminada'
    outcomeHint =
      orphan > 0 ?
        `El servidor indicó cierre pero aún hay ${input.lastOk.queuePagesPending} pendientes y ${input.lastOk.queuePagesProcessing} en proceso; conviene revisar la corrida en base.`
      : 'Cola vacía de pendientes: todas las páginas quedaron en estado hecho o fallido.'
  } else if (input.lastOk && !input.lastOk.done) {
    outcome = 'salida_sin_cierre'
    outcomeHint = `Última respuesta con cola inconclusa: ${input.lastOk.queuePagesPending} pendientes, ${input.lastOk.queuePagesProcessing} en proceso, estado ${input.lastOk.runPersistedStatus}.`
  }

  return {
    finishedAtIso: input.finishedAtIso,
    runId: input.runId,
    retailName: input.retailName,
    outcome,
    outcomeHint,
    startError: input.startError,
    actionError: input.actionError,
    browserError: input.browserError,
    lastSnapshot,
    persistedRun: input.persistedRun,
  }
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-CL', {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

/** Texto guardado en `scrapping_runs.error_message` si la corrida sigue en `running` al cortar el barrido. */
function barridoOutcomeSummaryForDb(d: CapturaCadenas2SweepDiagnostic): string {
  if (d.startError) return `${outcomeLabel('sin_inicio')}: ${d.startError}`.trim().slice(0, 2000)
  if (d.actionError) return `${outcomeLabel('error_servidor')}: ${d.actionError}`.trim().slice(0, 2000)
  if (d.browserError) return `${outcomeLabel('corte_navegador_o_red')}: ${d.browserError}`.trim().slice(0, 2000)
  return `${outcomeLabel(d.outcome)}. ${d.outcomeHint}`.trim().slice(0, 2000)
}

/** Alineado con `LIDER_SCRAPPING_QUEUE_TOTAL_PAGES_OPEN` en servidor: cola aún puede crecer (fase 2). */
const SCRAPPING_RUN_TOTAL_PAGES_QUEUE_OPEN = -1

function scrappingRunStatusLabel(status: string, totalPages?: number | null): string {
  const s = (status ?? '').toLowerCase()
  if (s === 'running' && totalPages == null) return 'En curso · armando cola'
  if (s === 'running' && totalPages === SCRAPPING_RUN_TOTAL_PAGES_QUEUE_OPEN) {
    return 'En curso · ampliando cola…'
  }
  if (s === 'completed') return 'Completada'
  if (s === 'cancelled') return 'Cancelada'
  if (s === 'running') return 'En curso'
  return status || '—'
}

export function CapturaCadenas2Client() {
  const [runs, setRuns] = useState<ScrappingRunRow[]>([])
  const [runsBusy, setRunsBusy] = useState(true)

  const [retails, setRetails] = useState<RetailTargetRow[]>([])
  const [retailsBusy, setRetailsBusy] = useState(true)
  const [selectedRetailId, setSelectedRetailId] = useState<string>('')

  const [fullSweepBusy, setFullSweepBusy] = useState(false)
  const [stopBusy, setStopBusy] = useState(false)
  const [sweepStartedAt, setSweepStartedAt] = useState<string | null>(null)
  const [currentRetailLabel, setCurrentRetailLabel] = useState<string>('')

  const [queuePagesTotal, setQueuePagesTotal] = useState(0)
  const [queuePagesProcessed, setQueuePagesProcessed] = useState(0)
  const [queuePagesFailed, setQueuePagesFailed] = useState(0)
  const [queuePagesOk, setQueuePagesOk] = useState(0)
  const [scraperRowsTotal, setScraperRowsTotal] = useState(0)
  const [retailMaxPages, setRetailMaxPages] = useState(0)
  const [retailMaxProducts, setRetailMaxProducts] = useState(0)
  const [sweepDiagnostic, setSweepDiagnostic] = useState<CapturaCadenas2SweepDiagnostic | null>(null)

  const [barridoPlanOpen, setBarridoPlanOpen] = useState(false)
  const [barridoPlanLoading, setBarridoPlanLoading] = useState(false)
  const [barridoPlanCtx, setBarridoPlanCtx] = useState<BarridoContextResponse | null>(null)
  const [barridoPlanActionBusy, setBarridoPlanActionBusy] = useState(false)
  const [purgeIdleBusy, setPurgeIdleBusy] = useState(false)
  const [exactMatchBusy, setExactMatchBusy] = useState(false)
  const [exactMatchLast, setExactMatchLast] = useState<ScrappingExactCatalogMatchStats | null>(null)
  const [scrappingSimilarityModalOpen, setScrappingSimilarityModalOpen] = useState(false)
  const [scrappingPendingHomologacion, setScrappingPendingHomologacion] = useState<number | null>(null)
  const [forceFinalizeBusy, setForceFinalizeBusy] = useState(false)

  const canStopScrapping = useMemo(() => {
    return fullSweepBusy || runs.some((r) => r.status === 'running')
  }, [fullSweepBusy, runs])

  /** Homologación solo con scrapping cerrado (sin corrida `running` en base; sin barrido activo en esta sesión). */
  const homologacionBloqueada = useMemo(() => {
    return runsBusy || fullSweepBusy || runs.some((r) => r.status === 'running')
  }, [runsBusy, fullSweepBusy, runs])

  const refreshScrappingPendingHomologacion = useCallback(async () => {
    const r = await getScrappingHomologacionPendingCountAction()
    if (!r.ok) return
    setScrappingPendingHomologacion(r.pendingCount)
  }, [])

  /** Hay filas `pending` en scrapping: el paso 2 (similitud) puede actuar sobre ellas. */
  const paso2Destacado = useMemo(() => {
    return (
      !homologacionBloqueada &&
      scrappingPendingHomologacion !== null &&
      scrappingPendingHomologacion > 0
    )
  }, [homologacionBloqueada, scrappingPendingHomologacion])

  const referenceRun = useMemo(() => {
    return [...runs]
      .filter((r) => r.status === 'completed' && r.finished_at)
      .sort((a, b) => new Date(b.finished_at!).getTime() - new Date(a.finished_at!).getTime())[0] ?? null
  }, [runs])

  /** Radix Select rompe si `value` no coincide con ningún ítem (p. ej. `''` o id obsoleto). */
  const retailSelectValue = useMemo(() => {
    if (!selectedRetailId) return undefined
    return retails.some((r) => r.id === selectedRetailId) ? selectedRetailId : undefined
  }, [selectedRetailId, retails])

  const reloadRuns = useCallback(async () => {
    setRunsBusy(true)
    const res = await barridoApiListRuns()
    setRunsBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setRuns(res.runs)
  }, [])

  const reloadRetails = useCallback(async () => {
    setRetailsBusy(true)
    const res = await barridoApiListRetails()
    setRetailsBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setRetails(res.retails)
    setSelectedRetailId((prev) => {
      if (prev && res.retails.some((r) => r.id === prev)) return prev
      return res.retails[0]?.id ?? ''
    })
  }, [])

  useEffect(() => {
    void reloadRuns()
    void reloadRetails()
  }, [reloadRuns, reloadRetails])

  useEffect(() => {
    void refreshScrappingPendingHomologacion()
  }, [refreshScrappingPendingHomologacion, homologacionBloqueada])

  /** Porcentaje de barra: solo cola real (max_pages no acota); monótono para no retroceder si crece la cola. */
  const [progressBarPercent, setProgressBarPercent] = useState(0)

  useEffect(() => {
    if (!fullSweepBusy) {
      setProgressBarPercent(0)
      return
    }
    if (queuePagesTotal <= 0) {
      setProgressBarPercent(0)
      return
    }
    const denom = Math.max(queuePagesTotal, 1)
    const raw = Math.min(100, Math.round((queuePagesProcessed / denom) * 100))
    setProgressBarPercent((prev) => Math.max(prev, raw))
  }, [fullSweepBusy, queuePagesTotal, queuePagesProcessed])

  function resetMetricBoxesOnly() {
    setQueuePagesTotal(0)
    setQueuePagesProcessed(0)
    setQueuePagesFailed(0)
    setQueuePagesOk(0)
    setScraperRowsTotal(0)
  }

  function resetForNewBarrido() {
    resetMetricBoxesOnly()
    setSweepStartedAt(null)
    setCurrentRetailLabel('')
  }

  const logReference = useMemo(() => {
    if (!referenceRun) {
      return 'Referencia: todavía no hay una corrida completada reciente en la tabla de abajo.'
    }
    const name = referenceRun.retail?.name ?? referenceRun.retailer
    const ok = referenceRun.pages_ok ?? 0
    const fail = referenceRun.pages_failed ?? 0
    const total = referenceRun.total_pages ?? '—'
    const prod = Number(referenceRun.rows_inserted ?? 0).toLocaleString('es-CL')
    const maxP = referenceRun.retail?.max_pages ?? 0
    const maxPr = referenceRun.retail?.max_products ?? 0
    const maxLine =
      maxP > 0 || maxPr > 0 ?
        ` · referencia retail (no limita barrido): ${maxP} págs / ${maxPr.toLocaleString('es-CL')} prod`
      : ''
    return `Referencia (última corrida cerrada): ${name} · ${formatWhen(referenceRun.started_at)} · páginas ok ${ok} / total cola ${total} · lecturas fallidas ${fail} · productos en scrapping ${prod}${maxLine}`
  }, [referenceRun])

  const logCurrent = useMemo(() => {
    if (!fullSweepBusy || !sweepStartedAt) {
      return 'Actual: sin barrido en curso.'
    }
    const label = currentRetailLabel || 'Retail'
    return `${label} en curso · ${formatWhen(sweepStartedAt)} · cola ${queuePagesProcessed} / ${queuePagesTotal} · ok ${queuePagesOk} · fallidas ${queuePagesFailed} · productos ${scraperRowsTotal.toLocaleString('es-CL')}`
  }, [
    fullSweepBusy,
    sweepStartedAt,
    currentRetailLabel,
    queuePagesProcessed,
    queuePagesTotal,
    queuePagesOk,
    queuePagesFailed,
    scraperRowsTotal,
  ])

  async function onDetenerScrapping() {
    if (!canStopScrapping || stopBusy) return
    setStopBusy(true)
    try {
      const res = await barridoApiStop()
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      if (!fullSweepBusy) {
        toast.message('Scrapping detenido. Las corridas en curso quedaron canceladas.')
      }
      await reloadRuns()
    } finally {
      setStopBusy(false)
    }
  }

  type BarridoPreparedOkLocal = {
    runId: string
    retailName: string
    retailMaxPages: number
    retailMaxProducts: number
  }

  async function openBarridoPlanModal() {
    if (fullSweepBusy) return
    if (!selectedRetailId) {
      toast.error('Seleccioná un retail antes de ejecutar el barrido.')
      return
    }
    setBarridoPlanOpen(true)
    setBarridoPlanLoading(true)
    setBarridoPlanCtx(null)
    const ctx = await barridoApiBarridoContext(selectedRetailId)
    setBarridoPlanLoading(false)
    if (!ctx.ok) {
      toast.error(ctx.error)
      setBarridoPlanOpen(false)
      return
    }
    setBarridoPlanCtx(ctx)
  }

  async function onPurgeScrappingIdle() {
    if (purgeIdleBusy || fullSweepBusy) return
    if (runs.some((r) => r.status === 'running')) {
      toast.error('Hay una corrida en curso. Detené el scrapping antes de limpiar las tablas.')
      return
    }
    setPurgeIdleBusy(true)
    try {
      const r = await barridoApiPurgeIfIdle()
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.message(
        'Tablas scrapping y scrapping_pages vaciadas. Los registros de corridas (scrapping_runs) siguen en el historial.',
      )
      await reloadRuns()
      await refreshScrappingPendingHomologacion()
    } finally {
      setPurgeIdleBusy(false)
    }
  }

  async function onApplyExactCatalogMatches() {
    if (exactMatchBusy || fullSweepBusy || runsBusy) return
    if (runs.some((r) => r.status === 'running')) {
      toast.error(
        'Hay scrapping en curso. Finalizá el barrido o usá «Dar por finalizado el scrapping pendiente» en el plan del barrido antes de homologar.',
      )
      return
    }
    setExactMatchBusy(true)
    try {
      const r = await applyScrappingExactCatalogMatchesAction()
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setExactMatchLast(r.result)
      setScrappingPendingHomologacion(r.result.pendingScrappingRemaining)
      const { scrappingRowsRemoved, distinctCatalogProducts, catalogProductsUpdated, pendingScrappingRemaining } =
        r.result
      toast.success(
        `Paso 1 · ${distinctCatalogProducts.toLocaleString('es-CL')} maestro(s) con precio actualizado · ${scrappingRowsRemoved.toLocaleString('es-CL')} fila(s) quitada(s) de scrapping. Quedan ${pendingScrappingRemaining.toLocaleString('es-CL')} fila(s) pending.${pendingScrappingRemaining > 0 ? ' Podés usar el paso 2 (similitud inteligente) sobre las que quedaron.' : ''}`,
      )
      await reloadRuns()
      await refreshScrappingPendingHomologacion()
    } finally {
      setExactMatchBusy(false)
    }
  }

  async function onForceFinalizeScrappingFromModal() {
    if (!selectedRetailId || forceFinalizeBusy || fullSweepBusy || barridoPlanActionBusy) return
    setForceFinalizeBusy(true)
    try {
      const r = await forceFinalizeScrappingRunForRetailAction({ retailId: selectedRetailId })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      const extra =
        r.forcedPages > 0 ?
          `${r.forcedPages.toLocaleString('es-CL')} listado(s) pendientes o en proceso marcados como listos sin descargar. `
        : ''
      toast.success(
        `${extra}Corrida cerrada como completada. Referencias del retail: max_pages / max_products = ${r.retailMaxPages.toLocaleString('es-CL')} / ${r.retailMaxProducts.toLocaleString('es-CL')}.`,
      )
      setBarridoPlanOpen(false)
      setBarridoPlanCtx(null)
      await reloadRuns()
      await reloadRetails()
      await refreshScrappingPendingHomologacion()
    } finally {
      setForceFinalizeBusy(false)
    }
  }

  async function startBarridoFreshFromModal() {
    if (!selectedRetailId) return
    const retailLabelAtStart = retails.find((x) => x.id === selectedRetailId)?.name ?? ''
    setBarridoPlanActionBusy(true)
    try {
      const prepared = await barridoApiPrepareRun(selectedRetailId)
      if (!prepared.ok) {
        toast.error(prepared.error)
        return
      }
      await executeBarridoWithPrepared(prepared, retailLabelAtStart, true)
    } finally {
      setBarridoPlanActionBusy(false)
    }
  }

  async function resumeBarridoFromModal(runId: string) {
    if (!selectedRetailId) return
    const retailLabelAtStart = retails.find((x) => x.id === selectedRetailId)?.name ?? ''
    setBarridoPlanActionBusy(true)
    try {
      const prepared = await barridoApiResumeBarrido({ runId, retailId: selectedRetailId })
      if (!prepared.ok) {
        toast.error(prepared.error)
        return
      }
      await executeBarridoWithPrepared(prepared, retailLabelAtStart, false)
    } finally {
      setBarridoPlanActionBusy(false)
    }
  }

  async function requeueFailedAndResumeFromModal() {
    if (!selectedRetailId) return
    const retailLabelAtStart = retails.find((x) => x.id === selectedRetailId)?.name ?? ''
    setBarridoPlanActionBusy(true)
    try {
      const prepared = await barridoApiRequeueFailedLatest(selectedRetailId)
      if (!prepared.ok) {
        toast.error(prepared.error)
        return
      }
      toast.message(`Se reencolaron ${prepared.requeued} listado(s) fallidos para volver a leerlos.`)
      await executeBarridoWithPrepared(
        {
          runId: prepared.runId,
          retailName: prepared.retailName,
          retailMaxPages: prepared.retailMaxPages,
          retailMaxProducts: prepared.retailMaxProducts,
        },
        retailLabelAtStart,
        false,
      )
    } finally {
      setBarridoPlanActionBusy(false)
    }
  }

  async function executeBarridoWithPrepared(
    prepared: BarridoPreparedOkLocal,
    retailLabelAtStart: string,
    isFreshRun: boolean,
  ) {
    setBarridoPlanOpen(false)
    setFullSweepBusy(true)
    resetMetricBoxesOnly()
    setSweepStartedAt(new Date().toISOString())

    let sweepRunId: string | null = null
    let resolvedScrappingRowTotal: number | undefined
    let finalRetailName = ''
    let startError: string | undefined
    let actionError: string | undefined
    let browserError: string | undefined
    let lastOk:
      | {
          ok: true
          done: boolean
          cancelled: boolean
          queuePagesTotal: number
          queuePagesProcessed: number
          queuePagesOk: number
          queuePagesFailed: number
          queuePagesPending: number
          queuePagesProcessing: number
          runPersistedStatus: string
          scrappingRowsTally: number
          error?: string
          scrappingRowsTotal?: number
        }
      | undefined

    try {
      sweepRunId = prepared.runId
      finalRetailName = prepared.retailName
      setCurrentRetailLabel(prepared.retailName)
      setRetailMaxPages(prepared.retailMaxPages)
      setRetailMaxProducts(prepared.retailMaxProducts)
      setQueuePagesTotal(0)
      setQueuePagesProcessed(0)
      setQueuePagesOk(0)
      setQueuePagesFailed(0)
      setScraperRowsTotal(0)
      await reloadRuns()

      if (isFreshRun) {
        toast.message(`Corrida registrada · ${prepared.retailName}. Armando cola inicial de URLs…`)
      } else {
        toast.message(`Retomando corrida · ${prepared.retailName}. Sincronizando cola…`)
      }

      const phase1 = await barridoApiPhase1Enqueue({
        runId: prepared.runId,
        retailId: selectedRetailId,
      })
      if (!phase1.ok) {
        actionError = phase1.error
        toast.error(phase1.error)
        await reloadRuns()
        return
      }

      setRetailMaxPages(phase1.retailMaxPages)
      setRetailMaxProducts(phase1.retailMaxProducts)
      setQueuePagesTotal(phase1.phase1Pages)
      await reloadRuns()

      const parallelLiderWorkers = Math.min(6, Math.max(2, Math.ceil(phase1.phase1Pages / 200)))

      toast.message(
        phase1.alreadyPhase1 ?
          `Cola ya tenía listados: ${phase1.phase1Pages} · ${phase1.retailName} · ${parallelLiderWorkers} lecturas en paralelo (ampliación en segundo plano si aplica).`
        : `Cola inicial: ${phase1.phase1Pages} listado(s) · ${phase1.retailName} · ${parallelLiderWorkers} lecturas en paralelo mientras se completa el descubrimiento.`,
      )

      type ProcessPageOk = Extract<ProcessLiderScrappingRunPageResult, { ok: true }>
      const sync = {
        stop: false,
        error: undefined as string | undefined,
        browserErr: undefined as string | undefined,
        warnedListings: false,
        /** Evita toasts duplicados cuando varios workers reciben `done` casi a la vez. */
        finishedUi: false,
        lastOk: undefined as ProcessPageOk | undefined,
      }

      const phase2Promise = barridoApiPhase2Seal({
        runId: prepared.runId,
        retailId: selectedRetailId,
      })

      const runWorker = async () => {
        while (!sync.stop) {
          let res: ProcessLiderScrappingRunPageResult
          try {
            res = await barridoApiProcessRunPage(prepared.runId)
          } catch (e) {
            sync.browserErr = e instanceof Error ? e.message : String(e)
            sync.stop = true
            return
          }
          if (!res.ok) {
            sync.error = res.error
            sync.stop = true
            return
          }
          const okRes = res
          sync.lastOk = okRes
          setQueuePagesTotal(okRes.queuePagesTotal)
          setQueuePagesProcessed(okRes.queuePagesProcessed)
          setQueuePagesOk(okRes.queuePagesOk)
          setQueuePagesFailed(okRes.queuePagesFailed)
          setScraperRowsTotal(okRes.scrappingRowsTally)
          setRetailMaxPages(okRes.retailMaxPages)
          setRetailMaxProducts(okRes.retailMaxProducts)

          if (okRes.error && !sync.warnedListings) {
            sync.warnedListings = true
            toast.warning(
              'Algunos listados pueden fallar (p. ej. HTTP 404). Se omiten y el barrido sigue hasta vaciar la cola.',
            )
          }

          if (typeof okRes.scrappingRowsTotal === 'number') {
            resolvedScrappingRowTotal = okRes.scrappingRowsTotal
          }

          if (okRes.done) {
            if (!sync.finishedUi) {
              sync.finishedUi = true
              if (typeof okRes.scrappingRowsTotal === 'number') {
                setScraperRowsTotal(okRes.scrappingRowsTotal)
              }
              if (okRes.cancelled) {
                toast.message('Barrido detenido.')
              } else {
                toast.success(
                  `Proceso finalizado · ${finalRetailName || 'Retail'} · páginas ok ${okRes.queuePagesOk} · fallidas ${okRes.queuePagesFailed} · productos en scrapping ${(okRes.scrappingRowsTotal ?? okRes.scrappingRowsTally).toLocaleString('es-CL')} · total en cola ${okRes.queuePagesTotal}. Las reglas de negocio posteriores se aplican en otros pasos, con lo ya guardado en la base.`,
                )
              }
            }
            sync.stop = true
            return
          }
        }
      }

      type Phase2Res = BarridoPhase2SealResponse
      const sweepResults = await Promise.all([
        phase2Promise,
        ...Array.from({ length: parallelLiderWorkers }, () => runWorker()),
      ])
      const phase2Res = sweepResults[0] as Phase2Res

      if (sync.browserErr) {
        browserError = sync.browserErr
      } else if (sync.error) {
        actionError = sync.error
        toast.error(sync.error)
      } else {
        lastOk = sync.lastOk
      }

      if (!phase2Res.ok) {
        if (!actionError && !browserError) {
          actionError = phase2Res.error
          toast.error(phase2Res.error)
        } else if (!actionError) {
          actionError = phase2Res.error
        }
      } else if (phase2Res.ok && !phase2Res.sealedAlready) {
        setQueuePagesTotal(phase2Res.finalTotalPages)
        setRetailMaxPages(phase2Res.retailMaxPages)
        setRetailMaxProducts(phase2Res.retailMaxProducts)
        if (!actionError && !browserError) {
          toast.message(
            `Cola completa: ${phase2Res.finalTotalPages} listado(s) (${phase2Res.appendedUrls} agregados en la ampliación).`,
          )
        }
      } else if (phase2Res.ok && phase2Res.sealedAlready) {
        setRetailMaxPages(phase2Res.retailMaxPages)
        setRetailMaxProducts(phase2Res.retailMaxProducts)
      }
    } finally {
      const finishedAtIso = new Date().toISOString()
      let persistedRun: CapturaCadenas2SweepDiagnostic['persistedRun']

      if (sweepRunId) {
        const listBefore = await barridoApiListRuns()
        if (listBefore.ok) {
          const row = listBefore.runs.find((x) => x.id === sweepRunId)
          if (row) {
            persistedRun = {
              status: row.status,
              error_message: row.error_message,
              total_pages: row.total_pages ?? null,
              pages_ok: row.pages_ok ?? 0,
              pages_failed: row.pages_failed ?? 0,
              rows_inserted: row.rows_inserted,
            }
          }
        }

        const diagDraft = buildSweepDiagnostic({
          finishedAtIso,
          runId: sweepRunId,
          retailName: finalRetailName || retailLabelAtStart || '—',
          startError,
          actionError,
          browserError,
          lastOk,
          persistedRun,
        })

        const persistOutcomes: CapturaCadenas2SweepDiagnostic['outcome'][] = [
          'corte_navegador_o_red',
          'error_servidor',
          'salida_sin_cierre',
        ]
        if (persistOutcomes.includes(diagDraft.outcome)) {
          const summary = barridoOutcomeSummaryForDb(diagDraft)
          const pr = await barridoApiPersistOutcome({
            runId: sweepRunId,
            summary,
          })
          if (!pr.ok) {
            toast.error(pr.error)
          }
        }

        await reloadRuns()
        await reloadRetails()
        if (typeof resolvedScrappingRowTotal === 'number') {
          setScraperRowsTotal(resolvedScrappingRowTotal)
        }

        persistedRun = undefined
        const listAfter = await barridoApiListRuns()
        if (listAfter.ok) {
          const rowAfter = listAfter.runs.find((x) => x.id === sweepRunId)
          if (rowAfter) {
            persistedRun = {
              status: rowAfter.status,
              error_message: rowAfter.error_message,
              total_pages: rowAfter.total_pages ?? null,
              pages_ok: rowAfter.pages_ok ?? 0,
              pages_failed: rowAfter.pages_failed ?? 0,
              rows_inserted: rowAfter.rows_inserted,
            }
          }
        }

        setSweepDiagnostic(
          buildSweepDiagnostic({
            finishedAtIso,
            runId: sweepRunId,
            retailName: finalRetailName || retailLabelAtStart || '—',
            startError,
            actionError,
            browserError,
            lastOk,
            persistedRun,
          }),
        )
      } else {
        resetForNewBarrido()
        setSweepDiagnostic(
          buildSweepDiagnostic({
            finishedAtIso,
            runId: sweepRunId,
            retailName: finalRetailName || retailLabelAtStart || '—',
            startError,
            actionError,
            browserError,
            lastOk,
            persistedRun,
          }),
        )
      }

      setSweepStartedAt(null)
      setFullSweepBusy(false)
    }
  }

  const selectedRetailName = retails.find((x) => x.id === selectedRetailId)?.name ?? ''

  return (
    <div className="space-y-6">
      <Dialog
        open={barridoPlanOpen}
        onOpenChange={(open) => {
          if (!open) {
            setBarridoPlanOpen(false)
            setBarridoPlanCtx(null)
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Plan del barrido</DialogTitle>
            {selectedRetailName ?
              <DialogDescription>
                Retail: <span className="font-medium text-foreground">{selectedRetailName}</span>
              </DialogDescription>
            : <DialogDescription>Elegí cómo continuar con la corrida de scrapping.</DialogDescription>}
          </DialogHeader>

          {barridoPlanLoading ?
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
              Consultando estado de la cola y corridas…
            </div>
          : barridoPlanCtx && barridoPlanCtx.ok ?
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                Datos en tablas de scrapping (toda la cuenta):{' '}
                <span className="tabular-nums text-foreground">
                  {barridoPlanCtx.globalScrappingProducts.toLocaleString('es-CL')}
                </span>{' '}
                productos ·{' '}
                <span className="tabular-nums text-foreground">
                  {barridoPlanCtx.globalScrappingPages.toLocaleString('es-CL')}
                </span>{' '}
                filas en cola de páginas.
              </p>

              {barridoPlanCtx.anyRunningGlobally && !barridoPlanCtx.runningForRetail ?
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-950 dark:text-amber-100">
                  Hay una corrida en curso en otro retail. Detené el scrapping antes de iniciar un barrido nuevo,
                  reencolar fallidas o vaciar tablas desde acá.
                </p>
              : null}

              {barridoPlanCtx.runningForRetail ?
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-foreground">
                  <p className="font-medium">Corrida en curso para este retail</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pendientes: {barridoPlanCtx.runningForRetail.pending} · En proceso:{' '}
                    {barridoPlanCtx.runningForRetail.processing} · Fallidas: {barridoPlanCtx.runningForRetail.failed} ·
                    Listas: {barridoPlanCtx.runningForRetail.done} · Total cola: {barridoPlanCtx.runningForRetail.total}
                    {barridoPlanCtx.runningForRetail.totalPages != null ?
                      <>
                        {' '}
                        · total_pages en corrida: {barridoPlanCtx.runningForRetail.totalPages}
                      </>
                    : null}
                  </p>
                </div>
              : barridoPlanCtx.latestRun ?
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-foreground">
                  <p className="font-medium">Última corrida registrada</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Estado: {barridoPlanCtx.latestRun.status} · Fallidas en cola:{' '}
                    {barridoPlanCtx.latestRun.failedPages}
                  </p>
                </div>
              : (
                <p className="text-muted-foreground">No hay corridas previas para este retail.</p>
              )}

              <div className="flex flex-wrap gap-3">
                {barridoPlanCtx.runningForRetail ?
                  <Button
                    type="button"
                    className={TOOLBAR_BTN}
                    disabled={barridoPlanActionBusy || fullSweepBusy}
                    onClick={() => {
                      const r = barridoPlanCtx.runningForRetail
                      if (r) void resumeBarridoFromModal(r.runId)
                    }}
                  >
                    {barridoPlanActionBusy || fullSweepBusy ?
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    : (
                      <Play className="mr-2 h-4 w-4" aria-hidden />
                    )}
                    Continuar barrido
                  </Button>
                : null}

                {barridoPlanCtx.latestRun && barridoPlanCtx.latestRun.failedPages > 0 ?
                  <Button
                    type="button"
                    variant="secondary"
                    className={TOOLBAR_BTN}
                    disabled={
                      barridoPlanActionBusy ||
                      fullSweepBusy ||
                      (barridoPlanCtx.anyRunningGlobally && !barridoPlanCtx.runningForRetail)
                    }
                    onClick={() => void requeueFailedAndResumeFromModal()}
                    title="Vuelve a poner en cola las páginas fallidas de la última corrida y sigue leyendo"
                  >
                    {barridoPlanActionBusy || fullSweepBusy ?
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    : (
                      <Play className="mr-2 h-4 w-4" aria-hidden />
                    )}
                    Reencolar fallidas
                  </Button>
                : null}

                <Button
                  type="button"
                  variant={barridoPlanCtx.runningForRetail ? 'outline' : 'default'}
                  className={TOOLBAR_BTN}
                  disabled={
                    barridoPlanActionBusy ||
                    fullSweepBusy ||
                    (barridoPlanCtx.anyRunningGlobally && !barridoPlanCtx.runningForRetail)
                  }
                  onClick={() => void startBarridoFreshFromModal()}
                  title={
                    barridoPlanCtx.runningForRetail ?
                      'Cancela la corrida en curso, vacía scrapping y scrapping_pages, y crea una corrida nueva'
                    : 'Cancela cualquier corrida en curso, vacía scrapping y scrapping_pages, y crea una corrida nueva'
                  }
                >
                  {barridoPlanActionBusy || fullSweepBusy ?
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  : (
                    <Play className="mr-2 h-4 w-4" aria-hidden />
                  )}
                  {barridoPlanCtx.runningForRetail ? 'Empezar de cero' : 'Barrido nuevo'}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className={TOOLBAR_BTN}
                  disabled={
                    purgeIdleBusy ||
                    barridoPlanActionBusy ||
                    fullSweepBusy ||
                    barridoPlanCtx.anyRunningGlobally
                  }
                  onClick={() => void onPurgeScrappingIdle()}
                  title="Solo si no hay corridas en curso. Vacía scrapping y scrapping_pages."
                >
                  {purgeIdleBusy ?
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  : (
                    <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                  )}
                  Limpiar tablas
                </Button>
              </div>

              {barridoPlanCtx.runningForRetail ?
                <div className="space-y-2 rounded-md border border-dashed border-border bg-background/80 px-3 py-3">
                  <p className="text-xs font-medium text-foreground">Cierre de la corrida en curso</p>
                  <p className="text-xs text-muted-foreground">
                    Si no vas a seguir leyendo listados, podés dar por finalizado el scrapping pendiente: cada página
                    <span className="font-medium"> pending </span> o <span className="font-medium">processing</span>{' '}
                    pasa a <span className="font-medium">done</span> sin descarga, la corrida queda{' '}
                    <span className="font-medium">completed</span>, se sella el total de la cola y se actualizan los
                    picos en la fila del retail (<span className="font-mono">max_pages</span>,{' '}
                    <span className="font-mono">max_products</span>). Usá esto cuando el navegador ya no está leyendo
                    la cola (no durante un barrido activo en esta pestaña).
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className={TOOLBAR_BTN}
                    disabled={
                      forceFinalizeBusy ||
                      fullSweepBusy ||
                      barridoPlanActionBusy ||
                      purgeIdleBusy
                    }
                    title={
                      fullSweepBusy ?
                        'Esperá a que termine el barrido en esta sesión o usá Detener scrapping antes de cerrar forzado.'
                      : 'Marca pendientes como listos sin leer y cierra la corrida'
                    }
                    onClick={() => void onForceFinalizeScrappingFromModal()}
                  >
                    {forceFinalizeBusy ?
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    : (
                      <CircleCheck className="mr-2 h-4 w-4" aria-hidden />
                    )}
                    Dar por finalizado el scrapping pendiente
                  </Button>
                </div>
              : null}

              <p className="text-xs text-muted-foreground">
                Cuando la cola termine sin cancelación, los datos quedan en la base; las reglas de negocio y procesos
                posteriores se ejecutan fuera de esta pantalla.
              </p>
            </div>
          : null}

          <DialogFooter className="sm:justify-start">
            <Button
              type="button"
              variant="ghost"
              className={TOOLBAR_BTN}
              disabled={barridoPlanActionBusy || forceFinalizeBusy}
              onClick={() => {
                setBarridoPlanOpen(false)
                setBarridoPlanCtx(null)
              }}
            >
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">Scraper retail (motor Lider)</p>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              Podés usar <span className="font-medium text-foreground">Detener scrapping</span> para cancelar la cola
              en curso. Al pulsar <span className="font-medium text-foreground">Barrido</span> se abre un plan: podés
              reanudar una corrida interrumpida, reencolar listados fallidos de la última corrida, arrancar un barrido
              nuevo (cancela otras corridas en curso, vacía <code className="rounded bg-muted px-1">scrapping</code> y{' '}
              <code className="rounded bg-muted px-1">scrapping_pages</code> y crea un registro nuevo en{' '}
              <code className="rounded bg-muted px-1">scrapping_runs</code>) o vaciar tablas si no hay nada en curso.
              Elegí el retail y revisá el log abajo.
            </p>
          </div>
          <span
            className={
              fullSweepBusy ?
                'inline-flex items-center rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-800 dark:text-amber-200'
              : 'inline-flex items-center rounded-md border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground'
            }
          >
            {fullSweepBusy ? 'En ejecución' : 'Listo'}
          </span>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-[220px] flex-1 space-y-2">
            <Label htmlFor="retail-scrape-select">Retail a consultar</Label>
            <Select
              value={retailSelectValue}
              onValueChange={setSelectedRetailId}
              disabled={fullSweepBusy || barridoPlanActionBusy || retailsBusy || retails.length === 0}
            >
              <SelectTrigger id="retail-scrape-select" className="w-full">
                <SelectValue placeholder={retailsBusy ? 'Cargando retails…' : 'Elegí un retail'} />
              </SelectTrigger>
              <SelectContent>
                {retails.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {retails.length > 0 && selectedRetailId ? (
              <p className="text-[11px] text-muted-foreground">
                Origen:{' '}
                <span className="font-mono text-foreground">
                  {retails.find((x) => x.id === selectedRetailId)?.base_url ?? '—'}
                </span>
                {(retails.find((x) => x.id === selectedRetailId)?.max_pages ?? 0) > 0 ?
                  <>
                    {' '}
                    · referencia retail: {retails.find((x) => x.id === selectedRetailId)?.max_pages} págs /{' '}
                    {(retails.find((x) => x.id === selectedRetailId)?.max_products ?? 0).toLocaleString('es-CL')} prod
                    {' '}(no limita el barrido)
                  </>
                : null}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Log</p>
          <p className="mt-1 wrap-break-word font-mono text-xs leading-relaxed text-muted-foreground">{logReference}</p>
          <p className="mt-2 wrap-break-word font-mono text-xs leading-relaxed text-foreground">{logCurrent}</p>
          {referenceRun?.error_message && !fullSweepBusy ? (
            <p className="mt-2 font-mono text-[11px] text-amber-700 dark:text-amber-300">
              Aviso en última referencia: {referenceRun.error_message}
            </p>
          ) : null}
          <div className="mt-3 space-y-1">
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>
                Avance: procesadas / total en cola (<span className="font-mono">max_pages</span> no acota ni corta el
                barrido). La barra no retrocede si la cola crece.
              </span>
              <span className="tabular-nums">{fullSweepBusy ? `${progressBarPercent}%` : '—'}</span>
            </div>
            <div
              className={`h-2 w-full overflow-hidden rounded-full bg-muted ${fullSweepBusy ? '' : 'opacity-50'}`}
              role={fullSweepBusy ? 'progressbar' : undefined}
              aria-valuenow={fullSweepBusy ? progressBarPercent : undefined}
              aria-valuemin={fullSweepBusy ? 0 : undefined}
              aria-valuemax={fullSweepBusy ? 100 : undefined}
              aria-label={
                fullSweepBusy ?
                  'Avance del barrido según páginas procesadas respecto al total de la cola; max_pages no acota el barrido; el indicador no retrocede si crece la cola'
                : 'Barra inactiva: solo muestra avance durante un barrido en curso'
              }
            >
              <div
                className={`h-full rounded-full bg-primary transition-[width] duration-300 ease-out ${fullSweepBusy ? '' : 'w-0'}`}
                style={{ width: fullSweepBusy ? `${progressBarPercent}%` : '0%' }}
              />
            </div>
            {fullSweepBusy && retailMaxPages > 0 ? (
              <p className="text-[10px] text-muted-foreground">
                Referencia <span className="font-mono">retail.max_pages</span>: {retailMaxPages} (solo dato; no corta
                el barrido).
              </p>
            ) : null}
            {!fullSweepBusy ? (
              <p className="text-[10px] text-muted-foreground">
                Los campos <span className="font-mono">max_pages</span> y <span className="font-mono">max_products</span>{' '}
                en <span className="font-mono">retail</span> son solo referencia (último pico histórico); no cortan el
                barrido ni fijan cuántas páginas se descargan.
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-border bg-background/80 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cola (scrapping_pages)</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">
              {queuePagesProcessed} / {queuePagesTotal}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Procesadas · Total en cola</p>
          </div>
          <div className="rounded-md border border-border bg-background/80 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Lecturas fallidas</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">{queuePagesFailed}</p>
            <p className="mt-1 text-xs text-muted-foreground">Páginas con error en esta corrida (p. ej. 404)</p>
          </div>
          <div className="rounded-md border border-border bg-background/80 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total scraper (scrapping)</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">
              {scraperRowsTotal.toLocaleString('es-CL')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Filas acumuladas en esta corrida</p>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-foreground">Resultado del barrido</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {sweepDiagnostic ?
                  `${outcomeLabel(sweepDiagnostic.outcome)} · ${formatWhen(sweepDiagnostic.finishedAtIso)}`
                : 'Todavía no hay un cierre de barrido en esta sesión.'}
              </p>
            </div>
            {sweepDiagnostic ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setSweepDiagnostic(null)}
              >
                Limpiar
              </Button>
            ) : null}
          </div>
          {sweepDiagnostic ? (
            <>
              <p className="mt-2 text-sm text-foreground">{sweepDiagnostic.outcomeHint}</p>
              <ul className="mt-3 max-h-64 space-y-1.5 overflow-y-auto rounded-md border border-border bg-background/80 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                <li>
                  <span className="text-foreground">Retail:</span> {sweepDiagnostic.retailName}
                </li>
                <li>
                  <span className="text-foreground">Corrida (run id):</span>{' '}
                  {sweepDiagnostic.runId ?? '— (no se creó corrida)'}
                </li>
                {sweepDiagnostic.startError ? (
                  <li className="text-destructive">
                    <span className="font-medium">Inicio:</span> {sweepDiagnostic.startError}
                  </li>
                ) : null}
                {sweepDiagnostic.actionError ? (
                  <li className="text-destructive">
                    <span className="font-medium">Error en proceso de página:</span> {sweepDiagnostic.actionError}
                  </li>
                ) : null}
                {sweepDiagnostic.browserError ? (
                  <li className="text-destructive">
                    <span className="font-medium">Fallo en el navegador o red:</span> {sweepDiagnostic.browserError}
                  </li>
                ) : null}
                {sweepDiagnostic.lastSnapshot ? (
                  <>
                    <li>
                      <span className="text-foreground">Última respuesta del servidor:</span> done=
                      {String(sweepDiagnostic.lastSnapshot.done)} · cancelled=
                      {String(sweepDiagnostic.lastSnapshot.cancelled)} · runStatus=
                      {sweepDiagnostic.lastSnapshot.runStatus}
                    </li>
                    <li>
                      Cola: total {sweepDiagnostic.lastSnapshot.queueTotal} · procesadas (ok+fallidas){' '}
                      {sweepDiagnostic.lastSnapshot.queueProcessed} · ok {sweepDiagnostic.lastSnapshot.queueOk} ·
                      fallidas {sweepDiagnostic.lastSnapshot.queueFailed} · pendientes{' '}
                      {sweepDiagnostic.lastSnapshot.queuePending} · en proceso {sweepDiagnostic.lastSnapshot.queueProcessing}
                    </li>
                    <li>
                      Productos (tally en respuesta):{' '}
                      {sweepDiagnostic.lastSnapshot.productsTally.toLocaleString('es-CL')}
                    </li>
                    {sweepDiagnostic.lastSnapshot.pageError ? (
                      <li className="text-amber-800 dark:text-amber-200">
                        Aviso en última página: {sweepDiagnostic.lastSnapshot.pageError}
                      </li>
                    ) : null}
                  </>
                ) : null}
                {sweepDiagnostic.persistedRun ? (
                  <>
                    <li className="mt-1 border-t border-border pt-1.5 text-foreground">
                      Tras sincronizar con la base (corrida en tabla)
                    </li>
                    <li>
                      Estado corrida: {sweepDiagnostic.persistedRun.status} · total_pages en corrida:{' '}
                      {sweepDiagnostic.persistedRun.total_pages ?? '—'} · ok {sweepDiagnostic.persistedRun.pages_ok} ·
                      fallidas {sweepDiagnostic.persistedRun.pages_failed} · rows_inserted{' '}
                      {String(sweepDiagnostic.persistedRun.rows_inserted)}
                    </li>
                    {sweepDiagnostic.persistedRun.error_message ? (
                      <li className="text-destructive">
                        <span className="font-medium">Mensaje en corrida:</span> {sweepDiagnostic.persistedRun.error_message}
                      </li>
                    ) : null}
                  </>
                ) : sweepDiagnostic.runId ? (
                  <li>No se encontró la corrida en el listado recargado (id {sweepDiagnostic.runId}).</li>
                ) : null}
              </ul>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Al terminar un barrido (bien, con error, detención o corte de red) aparece aquí el detalle. Si el servidor
              seguía con la corrida en <span className="font-mono">running</span>, el mismo texto se guarda en la
              columna «Mensaje» de la tabla de corridas.
            </p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {runsBusy ? <p className="text-sm text-muted-foreground">Cargando corridas…</p> : null}
          <Button
            type="button"
            variant="secondary"
            className={TOOLBAR_BTN}
            onClick={() => void onDetenerScrapping()}
            disabled={!canStopScrapping || stopBusy || runsBusy}
            title="Cancela corridas en estado «running» y marca la cola pendiente o en proceso como fallida"
            aria-label="Detener scrapping"
          >
            {stopBusy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Square className="mr-2 h-4 w-4" aria-hidden />
            )}
            Detener scrapping
          </Button>
          <Button
            type="button"
            className={TOOLBAR_BTN}
            onClick={() => void openBarridoPlanModal()}
            disabled={
              fullSweepBusy || barridoPlanActionBusy || runsBusy || retailsBusy || !selectedRetailId
            }
          >
            {fullSweepBusy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Play className="mr-2 h-4 w-4" aria-hidden />
            )}
            Barrido
          </Button>
        </div>

      </div>

      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <p className="text-sm font-medium text-foreground">Corridas recientes</p>
        <p className="mt-1 max-w-prose text-xs text-muted-foreground">
          Últimas 32 filas de <code className="rounded bg-muted px-1">scrapping_runs</code>. La columna Mensaje muestra
          resúmenes de fallas al cerrar la cola, detención por usuario o el texto guardado si el barrido se interrumpió
          con la corrida aún en <span className="font-mono">running</span>.
        </p>
        <div className="mt-3 overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Inicio</th>
                <th className="px-3 py-2">Retail</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 tabular-nums">Total cola</th>
                <th className="px-3 py-2 tabular-nums">Ok / Fallidas</th>
                <th className="px-3 py-2">Mensaje</th>
              </tr>
            </thead>
            <tbody>
              {runsBusy ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    Cargando…
                  </td>
                </tr>
              ) : runs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    No hay corridas registradas.
                  </td>
                </tr>
              ) : (
                runs.map((r) => {
                  const msg = r.error_message?.trim()
                  const msgClass =
                    !msg ? 'text-muted-foreground'
                    : r.status === 'cancelled' ? 'text-destructive'
                    : 'text-amber-800 dark:text-amber-200'
                  return (
                    <tr key={r.id} className="border-b border-border last:border-b-0">
                      <td className="whitespace-nowrap px-3 py-2 align-top text-muted-foreground tabular-nums">
                        {formatWhen(r.started_at)}
                      </td>
                      <td className="px-3 py-2 align-top text-foreground">
                        {r.retail?.name ?? r.retailer}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 align-top text-foreground">
                        {scrappingRunStatusLabel(r.status, r.total_pages)}
                      </td>
                      <td className="px-3 py-2 align-top tabular-nums text-foreground">
                        {r.status === 'running' && r.total_pages == null ?
                          <span className="text-muted-foreground">Armando cola…</span>
                        : r.status === 'running' &&
                            r.total_pages === SCRAPPING_RUN_TOTAL_PAGES_QUEUE_OPEN ?
                          <span className="text-muted-foreground">Ampliando cola…</span>
                        : (r.total_pages ?? '—')}
                      </td>
                      <td className="px-3 py-2 align-top tabular-nums text-foreground">
                        {(r.pages_ok ?? 0).toLocaleString('es-CL')} / {(r.pages_failed ?? 0).toLocaleString('es-CL')}
                      </td>
                      <td className={`max-w-md px-3 py-2 align-top text-xs leading-snug wrap-break-word ${msgClass}`}>
                        {msg || '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">Análisis de homologación al catálogo</p>
            <p className="mt-1 max-w-prose text-xs text-muted-foreground">
              Solo podés ejecutar estos pasos cuando no haya una corrida de scrapping en curso (completada
              automáticamente o cerrada con «Dar por finalizado…» en el plan del barrido). La tabla{' '}
              <code className="rounded bg-muted px-1">scrapping</code> se va <span className="font-medium text-foreground">limpiando paso a paso</span>: cada etapa resuelve un tipo de filas (hoy el paso 1 las quita al homologarlas con el maestro); lo que queda en{' '}
              <span className="font-mono">pending</span> es lo que sigue para similitud y altas nuevas.
            </p>
          </div>
        </div>

        {homologacionBloqueada ?
          <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">
            {runsBusy ?
              'Cargando estado de corridas…'
            : fullSweepBusy ?
              'Hay un barrido en ejecución en esta pestaña. Esperá el cierre o detené el scrapping antes de homologar.'
            : 'Hay una corrida en curso en la base. Finalizá el scrapping antes de usar los pasos de homologación.'}
          </p>
        : null}

        {!homologacionBloqueada && scrappingPendingHomologacion !== null ?
          <p className="mt-3 text-xs text-muted-foreground tabular-nums">
            Filas <span className="font-mono">pending</span> en scrapping (para pasos 1–3):{' '}
            <span className="font-medium text-foreground">
              {scrappingPendingHomologacion.toLocaleString('es-CL')}
            </span>
          </p>
        : null}

        {paso2Destacado ?
          <p className="mt-3 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-950 dark:text-sky-100">
            Hay filas <span className="font-mono">pending</span> en scrapping. Abrí el paso 2 para revisar similitud
            en una grilla: candidatos por marca, nombre y precio del maestro dentro de ±3000 CLP respecto al precio
            capturado. Si no corresponde ninguno, marcá «No / nuevo» y la fila pasa al paso 3.
          </p>
        : !homologacionBloqueada && scrappingPendingHomologacion === 0 ?
          <p className="mt-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-950 dark:text-emerald-100">
            No quedan filas <span className="font-mono">pending</span> en scrapping para esta tubería de homologación.
          </p>
        : null}

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="flex flex-col rounded-md border border-border bg-muted/25 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Paso 1 · Listo</p>
            <p className="mt-1 text-sm font-medium text-foreground">Nombre + marca = maestro</p>
            <p className="mt-2 flex-1 text-xs leading-relaxed text-muted-foreground">
              Cada fila <span className="font-mono">pending</span> con el mismo nombre (trim) y la misma marca
              (minúsculas/trim) que un <span className="font-mono">catalog_products</span> activo: se actualiza{' '}
              <span className="font-mono">default_reference_price</span> en el maestro con el mayor precio visto en
              scrapping para ese par, y esas filas se <span className="font-medium text-foreground">eliminan</span> de
              scrapping para no mezclar con el trabajo pendiente.
            </p>
            <Button
              type="button"
              variant="secondary"
              className="mt-4 h-9 w-full shrink-0"
              onClick={() => void onApplyExactCatalogMatches()}
              disabled={homologacionBloqueada || exactMatchBusy}
              title={
                homologacionBloqueada ?
                  'Finalizá el scrapping (ninguna corrida en curso) antes de homologar.'
                : 'Ejecuta el paso 1 en base (RPC)'
              }
            >
              {exactMatchBusy ?
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              : <Link2 className="mr-2 h-4 w-4" aria-hidden />}
              Coincidencias exactas
            </Button>
          </div>

          <div
            className={
              paso2Destacado ?
                'flex flex-col rounded-md border border-primary/40 bg-primary/5 p-4'
              : 'flex flex-col rounded-md border border-dashed border-border bg-muted/10 p-4 opacity-90'
            }
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {paso2Destacado ? 'Paso 2 · Disponible' : 'Paso 2 · Sin cola'}
            </p>
            <p className="mt-1 text-sm font-medium text-foreground">Similitud inteligente</p>
            <p className="mt-2 flex-1 text-xs leading-relaxed text-muted-foreground">
              Primero marca y nombre relativos al catálogo; luego se acota por precio de referencia del maestro dentro
              de ±3000 CLP respecto al precio capturado. Abrís el combo por fila para ver pocos candidatos (o ninguno).
              Vinculás al maestro o indicás «No / nuevo» y la fila queda en <span className="font-mono">pending_new</span>{' '}
              para el paso 3.
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-4 h-9 w-full"
              disabled={
                homologacionBloqueada ||
                exactMatchBusy ||
                fullSweepBusy ||
                runsBusy ||
                scrappingPendingHomologacion === null ||
                scrappingPendingHomologacion === 0
              }
              title={
                homologacionBloqueada ?
                  'Finalizá el scrapping (ninguna corrida en curso) antes de homologar.'
                : scrappingPendingHomologacion === 0 ?
                  'No hay filas pending en scrapping.'
                : 'Abrir grilla de revisión por similitud'
              }
              onClick={() => setScrappingSimilarityModalOpen(true)}
            >
              <LayoutGrid className="mr-2 h-4 w-4" aria-hidden />
              Revisar similitud
            </Button>
            {paso2Destacado ?
              <p className="mt-2 text-center text-[10px] text-muted-foreground">
                Paginación dentro del modal (100 filas por página).
              </p>
            : null}
          </div>

          <div className="flex flex-col rounded-md border border-dashed border-border bg-muted/10 p-4 opacity-90">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Paso 3 · Próximo</p>
            <p className="mt-1 text-sm font-medium text-foreground">Nuevos en catálogo</p>
            <p className="mt-2 flex-1 text-xs leading-relaxed text-muted-foreground">
              Productos sin homólogo: alta en maestro con sección/categoría (crear o reutilizar taxonomía), realocación
              manual después si hace falta.
            </p>
            <Button type="button" variant="outline" className="mt-4 h-9 w-full" disabled>
              Próximamente
            </Button>
          </div>
        </div>

        {exactMatchLast ?
          <p className="mt-4 rounded-md border border-border bg-background/80 px-3 py-2 text-xs text-muted-foreground tabular-nums">
            Último paso 1: {exactMatchLast.scrappingRowsRemoved.toLocaleString('es-CL')} fila(s) quitada(s) de scrapping
            · {exactMatchLast.distinctCatalogProducts.toLocaleString('es-CL')} maestro(s) tocado(s) ·{' '}
            {exactMatchLast.catalogProductsUpdated.toLocaleString('es-CL')} precio(s) actualizado(s) en catálogo ·
            quedaron {exactMatchLast.pendingScrappingRemaining.toLocaleString('es-CL')} pending
          </p>
        : null}
      </div>

      <ScrappingSimilarityReviewModal
        open={scrappingSimilarityModalOpen}
        onOpenChange={setScrappingSimilarityModalOpen}
        homologacionBloqueada={homologacionBloqueada}
        onApplied={async () => {
          await refreshScrappingPendingHomologacion()
          await reloadRuns()
        }}
      />
    </div>
  )
}
