'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Loader2, CircleCheck, LayoutGrid, Link2, Play, Square, Trash2, Zap, Sparkles, PackagePlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { getMaxScrappingPages } from '@/lib/max-scrapping-pages'
import {
  barridoApiBarridoContext,
  barridoApiInit,
  barridoApiListRetails,
  barridoApiListRuns,
  barridoApiPersistOutcome,
  barridoApiPhase1Enqueue,
  barridoApiPhase2Seal,
  barridoApiPrepareRun,
  barridoApiProcessRunPage,
  barridoApiPurgeIfIdle,
  barridoApiRequeueFailedLatest,
  barridoApiSubmitPageHtml,
  barridoApiResumeBarrido,
  barridoApiStop,
} from '@/lib/retail-scrapping-barrido-api'
import {
  applyScrappingExactCatalogMatchesAction,
  forceFinalizeScrappingRunForRetailAction,
  getScrappingHomologationDashboardAction,
  type ScrappingExactCatalogMatchStats,
} from '@/app/actions/retail-scrapping'
import type { RetailTargetRow, ScrappingRunRow } from '@/types/retail-scrapping-ui'
import type {
  BarridoContextResponse,
  ProcessLiderScrappingRunPageResult,
  BarridoPhase2SealResponse,
} from '@/types/retail-scrapping-barrido-api'
import { ScrappingSimilarityReviewModal } from '@/app/(app)/captura-cadenas-2/scrapping-similarity-review-modal'
import { HomologationWizardModal } from '@/app/(app)/captura-cadenas-2/homologation-wizard-modal'
import { CreateNewProductsModal } from '@/app/(app)/captura-cadenas-2/create-new-products-modal'
import { Button } from '@/components/ui/button'
import { ScrappingProgressBar } from '@/components/scrapping/ScrappingProgressBar'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { requestLogger, withLogging } from '@/lib/request-logger'
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
      return 'Salida antes de tiempo (revisa pendientes y estado en base)'
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
    'El bucle terminó sin marcar cierre explícito. Revisa pendientes en base, tiempo máximo del servidor o pestaña en segundo plano.'

  if (input.startError) {
    outcome = 'sin_inicio'
    outcomeHint = input.startError
  } else if (input.browserError) {
    outcome = 'corte_navegador_o_red'
    outcomeHint =
      'Falló la llamada desde el navegador (red, pestaña cerrada, suspensión del dispositivo o límite de tiempo del proveedor de hosting). Si usas Vercel u otro serverless, revisa maxDuration y el plan.'
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
  if (s === 'paused') return 'Pausada'
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
  const syncRef = useRef<{
    stop: boolean
    abortController: AbortController
    antiBotGate: {
      active: boolean
      resolve: (() => void) | null
      promise: Promise<void> | null
    }
  } | null>(null)
  const stopInFlightRef = useRef(false)

  const [queuePagesTotal, setQueuePagesTotal] = useState(0)
  const [queuePagesProcessed, setQueuePagesProcessed] = useState(0)
  const [queuePagesFailed, setQueuePagesFailed] = useState(0)
  const [queuePagesOk, setQueuePagesOk] = useState(0)
  const [scraperRowsTotal, setScraperRowsTotal] = useState(0)
  const [retailMaxPages, setRetailMaxPages] = useState(0)
  const [retailMaxProducts, setRetailMaxProducts] = useState(0)
  const [sweepDiagnostic, setSweepDiagnostic] = useState<CapturaCadenas2SweepDiagnostic | null>(null)

  /** Panel visible cuando el retail bloquea con anti-bot y el navegador del usuario debe resolverlo. */
  const [humanAntiBotPanel, setHumanAntiBotPanel] = useState<{
    open: boolean
    runId: string
    pageId: string
    pageUrl: string
    error: string
    attempts: number
  } | null>(null)

  const [barridoPlanOpen, setBarridoPlanOpen] = useState(false)
  const [barridoPlanLoading, setBarridoPlanLoading] = useState(false)
  const [barridoPlanCtx, setBarridoPlanCtx] = useState<BarridoContextResponse | null>(null)
  const [barridoPlanActionBusy, setBarridoPlanActionBusy] = useState(false)
  const [modalRetailId, setModalRetailId] = useState<string>('')
  const [purgeIdleBusy, setPurgeIdleBusy] = useState(false)
  const [exactMatchBusy, setExactMatchBusy] = useState(false)
  const [exactMatchLast, setExactMatchLast] = useState<ScrappingExactCatalogMatchStats | null>(null)
  const [scrappingSimilarityModalOpen, setScrappingSimilarityModalOpen] = useState(false)
  const [scrappingPendingHomologacion, setScrappingPendingHomologacion] = useState<number | null>(null)
  const [homologDash, setHomologDash] = useState<{
    pendingAny: number
    grayIaQueued: number
    userReview: number
    pendingNew: number
  } | null>(null)
  const [createNewBusy, setCreateNewBusy] = useState(false)
  const [createNewResult, setCreateNewResult] = useState<string | null>(null)
  const [createNewModalOpen, setCreateNewModalOpen] = useState(false)
  const [homologWizardOpen, setHomologWizardOpen] = useState(false)
  const [forceFinalizeBusy, setForceFinalizeBusy] = useState(false)

  /** 
   * Detener scrapping solo cuando hay una sesión activa (fullSweepBusy) 
   * o una corrida running del retail seleccionado actualmente.
   * Evita mostrar el botón activo por corridas "huérfanas" de otros retails o sesiones previas.
   */
  const canStopScrapping = useMemo(() => {
    // Si hay un barrido activo en esta sesión, siempre permitir detener
    if (fullSweepBusy) return true
    
    // Si no hay retail seleccionado, no permitir detener
    if (!selectedRetailId) return false
    
    // Solo permitir detener si hay una corrida running del retail seleccionado
    return runs.some((r) => r.status === 'running' && r.retail_id === selectedRetailId)
  }, [fullSweepBusy, runs, selectedRetailId])

  /** Homologación solo con scrapping cerrado (sin corrida `running` en base; sin barrido activo en esta sesión). */
  const homologacionBloqueada = useMemo(() => {
    return runsBusy || fullSweepBusy || runs.some((r) => r.status === 'running')
  }, [runsBusy, fullSweepBusy, runs])

  const lastDashboardCallRef = useRef(0)
  const refreshScrappingPendingHomologacion = useCallback(async () => {
    const now = Date.now()
    if (now - lastDashboardCallRef.current < 15000) {
      requestLogger.logUI('getScrappingHomologationDashboardAction - skipped (llamada reciente)')
      return
    }
    lastDashboardCallRef.current = now
    
    const logId = requestLogger.startLog('api', 'getScrappingHomologationDashboardAction')
    const d = await getScrappingHomologationDashboardAction()
    requestLogger.endLog(logId, d.ok ? 'success' : 'error', d.ok ? { pendingAny: d.pendingAny, grayIaQueued: d.grayIaQueued, userReview: d.userReview, pendingNew: d.pendingNew } : undefined, d.ok ? undefined : d.error)
    if (d.ok) {
      setScrappingPendingHomologacion(d.pendingAny)
      setHomologDash({
        pendingAny: d.pendingAny,
        grayIaQueued: d.grayIaQueued,
        userReview: d.userReview,
        pendingNew: d.pendingNew,
      })
    }
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

  const reloadRuns = useCallback(async (): Promise<ScrappingRunRow[]> => {
    setRunsBusy(true)
    const logId = requestLogger.startLog('api', 'barridoApiListRuns')
    const res = await barridoApiListRuns()
    setRunsBusy(false)
    if (!res.ok) {
      requestLogger.endLog(logId, 'error', undefined, res.error)
      toast.error(res.error)
      return []
    }
    requestLogger.endLog(logId, 'success', { runsCount: res.runs.length })
    setRuns(res.runs)
    return res.runs
  }, [])

  const reloadRetails = useCallback(async () => {
    setRetailsBusy(true)
    const res = await withLogging('api', 'barridoApiListRetails', () => barridoApiListRetails())
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

  const reloadInit = useCallback(async () => {
    setRetailsBusy(true)
    setRunsBusy(true)
    const logId = requestLogger.startLog('api', 'barridoApiInit')
    const res = await barridoApiInit()
    setRetailsBusy(false)
    setRunsBusy(false)
    if (!res.ok) {
      requestLogger.endLog(logId, 'error', undefined, res.error)
      toast.error(res.error)
      return
    }
    requestLogger.endLog(logId, 'success', { retailsCount: res.retails.length, runsCount: res.runs.length })
    setRetails(res.retails)
    setRuns(res.runs)
    setSelectedRetailId((prev) => {
      if (prev && res.retails.some((r) => r.id === prev)) return prev
      return res.retails[0]?.id ?? ''
    })
  }, [])

  // Carga inicial de datos - usa flag para evitar warnings
  const initializedRef = useRef(false)
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    // Limpiar logs anteriores al cargar la página
    requestLogger.logUI('CapturaCadenas2 - Página cargada, cargando retails y corridas')
    // Cargar retails + runs en una sola llamada combinada para evitar serverless tax doble.
    // El dashboard de homologacion se carga bajo demanda.
    requestAnimationFrame(() => {
      void reloadInit()
    })
  }, []) // Solo ejecutar una vez al montar - funciones son estables


  // Polling del contexto del modal: recarga cada 5s SOLO si hay una corrida running.
  // Se detiene automáticamente cuando el contexto indica que no hay nada corriendo.
  useEffect(() => {
    if (!barridoPlanOpen || !modalRetailId) return

    // Si ya tenemos contexto y no hay nada corriendo, no hace falta polling.
    if (
      barridoPlanCtx?.ok &&
      !barridoPlanCtx.anyRunningGlobally &&
      !barridoPlanCtx.runningForRetail
    ) {
      return
    }

    const id = setInterval(() => {
      void loadBarridoContextForModal(modalRetailId)
    }, 5000)
    return () => clearInterval(id)
  }, [barridoPlanOpen, modalRetailId, barridoPlanCtx])

  /** Porcentaje de barra: solo cola real (max_pages no acota); monótono para no retroceder si crece la cola. */
  const [progressBarPercent, setProgressBarPercent] = useState(0)

  useEffect(() => {
    requestAnimationFrame(() => {
      if (!fullSweepBusy || queuePagesTotal <= 0) {
        setProgressBarPercent(0)
      } else {
        const denom = Math.max(queuePagesTotal, 1)
        const raw = Math.min(100, Math.round((queuePagesProcessed / denom) * 100))
        setProgressBarPercent((prev) => Math.max(prev, raw))
      }
    })
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
    if (!canStopScrapping || stopBusy || stopInFlightRef.current) return
    stopInFlightRef.current = true
    setStopBusy(true)
    
    // 1. Abortar llamadas HTTP en curso y detener workers
    if (syncRef.current) {
      syncRef.current.stop = true
      syncRef.current.abortController?.abort()
      syncRef.current = null
    }
    
    // 2. Resetear UI inmediatamente sin esperar workers
    resetMetricBoxesOnly()
    setFullSweepBusy(false)
    setSweepStartedAt(null)
    setCurrentRetailLabel('')
    toast.message('Deteniendo scrapping…')
    
    const runningRun = runs.find((r) => r.status === 'running')
    console.info('[STOP] Solicitud de detención', { runId: runningRun?.id ?? null, previousStatus: runningRun?.status ?? null })

    // 3. Notificar al backend (fire and forget, no bloquea UI)
    const logId = requestLogger.startLog('api', 'barridoApiStop')
    try {
      const res = await barridoApiStop()
      requestLogger.endLog(logId, res.ok ? 'success' : 'error', res.ok ? { stopped: true } : undefined, res.ok ? undefined : res.error)
      if (!res.ok) {
        toast.error(res.error)
      } else {
        toast.success('Scrapping detenido.')
      }
      await reloadRuns()
    } catch (e) {
      requestLogger.endLog(logId, 'error', undefined, e instanceof Error ? e.message : String(e))
    } finally {
      setStopBusy(false)
      stopInFlightRef.current = false
    }
  }

  type BarridoPreparedOkLocal = {
    runId: string
    retailId: string
    retailName: string
    retailMaxPages: number
    retailMaxProducts: number
  }

  async function openBarridoPlanModal() {
    // Asegurar que los retails estén cargados antes de abrir el modal
    let currentRetails = retails
    if (retails.length === 0 && !retailsBusy) {
      const res = await barridoApiListRetails()
      if (res.ok && res.retails.length > 0) {
        currentRetails = res.retails
        setRetails(res.retails)
      }
    }
    
    // Inicializar el retail del modal - usar seleccionado o el primero disponible
    const initialModalRetail = selectedRetailId || currentRetails[0]?.id || ''
    setModalRetailId(initialModalRetail)
    setBarridoPlanOpen(true)
    setBarridoPlanLoading(true)
    setBarridoPlanCtx(null)
    
    // Si hay un retail seleccionado, cargar el contexto inmediatamente
    if (initialModalRetail) {
      const ctx = await withLogging('api', 'barridoApiBarridoContext', () => barridoApiBarridoContext(initialModalRetail), { retailId: initialModalRetail })
      setBarridoPlanLoading(false)
      if (!ctx.ok) {
        toast.error(ctx.error)
        return
      }
      setBarridoPlanCtx(ctx)
    } else {
      setBarridoPlanLoading(false)
    }
  }

  async function loadBarridoContextForModal(retailId: string) {
    if (!retailId) {
      setBarridoPlanCtx(null)
      return
    }
    setBarridoPlanLoading(true)
    try {
      const ctx = await withLogging('api', 'barridoApiBarridoContext', () => barridoApiBarridoContext(retailId), { retailId })
      if (!ctx.ok) {
        toast.error(ctx.error)
        setBarridoPlanCtx(null)
        return
      }
      setBarridoPlanCtx(ctx)
    } catch (e) {
      toast.error('Error al cargar el contexto del retail')
      setBarridoPlanCtx(null)
    } finally {
      setBarridoPlanLoading(false)
    }
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
      toast.success('Datos de captura vaciados. El historial de corridas se mantiene.')
      await reloadRuns()
      await refreshScrappingPendingHomologacion()
      // Cerrar el modal y limpiar el contexto para forzar selección de retail nuevamente
      setBarridoPlanOpen(false)
      setBarridoPlanCtx(null)
      setModalRetailId('')
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
      const r = await withLogging('api', 'applyScrappingExactCatalogMatchesAction', () => applyScrappingExactCatalogMatchesAction())
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setExactMatchLast(r.result)
      setScrappingPendingHomologacion(r.result.pendingScrappingRemaining)
      const {
        scrappingDuplicatesPurged,
        scrappingRowsRemoved,
        distinctCatalogProducts,
        catalogProductsUpdated,
        pendingScrappingRemaining,
      } = r.result
      const parts: string[] = []
      if (scrappingDuplicatesPurged > 0) {
        parts.push(
          `${scrappingDuplicatesPurged.toLocaleString('es-CL')} ya homologada(s) en catálogo (quitadas de scrapping)`,
        )
      }
      parts.push(
        `${distinctCatalogProducts.toLocaleString('es-CL')} maestro(s) · ${scrappingRowsRemoved.toLocaleString('es-CL')} por nombre exacto`,
      )
      if (catalogProductsUpdated > 0) {
        parts.push(`${catalogProductsUpdated.toLocaleString('es-CL')} precio(s) actualizado(s)`)
      }
      toast.success(
        `Paso 1 · ${parts.join(' · ')}. Quedan ${pendingScrappingRemaining.toLocaleString('es-CL')} pending.${pendingScrappingRemaining > 0 ? ' Usá paso 2 sobre el resto.' : ''}`,
      )
      await reloadRuns()
      await refreshScrappingPendingHomologacion()
    } finally {
      setExactMatchBusy(false)
    }
  }

  async function onForceFinalizeScrappingFromModal() {
    const effectiveRetailId = modalRetailId || selectedRetailId
    if (!effectiveRetailId || forceFinalizeBusy || fullSweepBusy || barridoPlanActionBusy) return
    const confirmed = window.confirm(
      '¿Cerrar esta corrida forzosamente?\n\nEsta acción es IRREVERSIBLE: todas las páginas pendientes o en proceso se marcarán como completadas sin descargar. No se podrá retomar el barrido después.',
    )
    if (!confirmed) return
    setForceFinalizeBusy(true)
    try {
      const r = await forceFinalizeScrappingRunForRetailAction({ retailId: effectiveRetailId })
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
    const effectiveRetailId = modalRetailId || selectedRetailId
    if (!effectiveRetailId) {
      toast.error('Seleccioná un retail para iniciar el barrido.')
      return
    }
    const retailLabelAtStart = retails.find((x) => x.id === effectiveRetailId)?.name ?? ''
    setBarridoPlanActionBusy(true)
    try {
      const prepared = await barridoApiPrepareRun(effectiveRetailId)
      if (!prepared.ok) {
        toast.error(prepared.error)
        return
      }
      await executeBarridoWithPrepared(prepared, retailLabelAtStart, true)
    } finally {
      setBarridoPlanActionBusy(false)
    }
  }

  async function retryHumanAntiBotPage() {
    if (!humanAntiBotPanel?.open) return
    const { runId, pageId, pageUrl } = humanAntiBotPanel
    try {
      requestLogger.logUI('[Browser fallback] Reintentando desde navegador del usuario')
      const browserRes = await fetch(pageUrl, { credentials: 'include' })
      if (browserRes.ok) {
        const html = await browserRes.text()
        if (html.length > 500) {
          const submit = await barridoApiSubmitPageHtml({ runId, pageId, pageUrl, html })
          if (submit.ok) {
            requestLogger.logUI('[Browser fallback] OK tras intervencion humana')
            setHumanAntiBotPanel(null)
            toast.success('Pagina capturada desde el navegador. Reanudando barrido...')
            if (syncRef.current && syncRef.current.antiBotGate.active && syncRef.current.antiBotGate.resolve) {
              syncRef.current.antiBotGate.active = false
              syncRef.current.antiBotGate.resolve()
              syncRef.current.antiBotGate.resolve = null
              syncRef.current.antiBotGate.promise = null
            }
            return
          }
        }
      }
      toast.error('La pagina sigue bloqueada. Abrila en una pestaña nueva, resolve el desafio, y volve a Reintentar.')
    } catch (e) {
      toast.error('Error al reintentar. Proba abrir la URL manualmente en tu navegador.')
    }
  }

  async function skipHumanAntiBotPage() {
    if (!humanAntiBotPanel?.open) return
    setHumanAntiBotPanel(null)
    toast.message('Pagina omitida. Continuando con el barrido...')
    if (syncRef.current && syncRef.current.antiBotGate.active && syncRef.current.antiBotGate.resolve) {
      syncRef.current.antiBotGate.active = false
      syncRef.current.antiBotGate.resolve()
      syncRef.current.antiBotGate.resolve = null
      syncRef.current.antiBotGate.promise = null
    }
  }

  async function resumeBarridoFromModal(runId: string) {
    const effectiveRetailId = modalRetailId || selectedRetailId
    if (!effectiveRetailId) {
      toast.error('Seleccioná un retail para continuar el barrido.')
      return
    }
    const retailLabelAtStart = retails.find((x) => x.id === effectiveRetailId)?.name ?? ''
    setBarridoPlanActionBusy(true)
    try {
      const prepared = await barridoApiResumeBarrido({ runId, retailId: effectiveRetailId })
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
    const effectiveRetailId = modalRetailId || selectedRetailId
    if (!effectiveRetailId) {
      toast.error('Seleccioná un retail para reencolar fallidas.')
      return
    }
    const retailLabelAtStart = retails.find((x) => x.id === effectiveRetailId)?.name ?? ''
    setBarridoPlanActionBusy(true)
    try {
      const prepared = await barridoApiRequeueFailedLatest(effectiveRetailId)
      if (!prepared.ok) {
        toast.error(prepared.error)
        return
      }
      toast.message(`Se reencolaron ${prepared.requeued} listado(s) fallidos para volver a leerlos.`)
      await executeBarridoWithPrepared(
        {
          runId: prepared.runId,
          retailId: prepared.retailId,
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
    // Mantener modal abierto y cambiar a vista de ejecución
    setFullSweepBusy(true)
    resetMetricBoxesOnly()
    setSweepStartedAt(new Date().toISOString())
    const barridoLogId = requestLogger.startLog('api', 'executeBarrido', { runId: prepared.runId, retail: retailLabelAtStart, fresh: isFreshRun })

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
        retailId: prepared.retailId,
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

      const parallelLiderWorkers = 1

      // Mensaje más descriptivo sobre el estado
      toast.message(
        phase1.alreadyPhase1 ?
          `Retomando: ${phase1.phase1Pages} listados · ${parallelLiderWorkers} workers en paralelo. El modal se puede cerrar, el barrido continúa en segundo plano.`
        : `Iniciando: ${phase1.phase1Pages} listados · ${parallelLiderWorkers} workers en paralelo. El modal se puede cerrar, el barrido continúa en segundo plano.`,
      )

      type ProcessPageOk = Extract<ProcessLiderScrappingRunPageResult, { ok: true }>
      const abortController = new AbortController()
      const sync = {
        stop: false,
        error: undefined as string | undefined,
        browserErr: undefined as string | undefined,
        warnedListings: false,
        /** Evita toasts duplicados cuando varios workers reciben `done` casi a la vez. */
        finishedUi: false,
        lastOk: undefined as ProcessPageOk | undefined,
        abortController,
        /** Gate que bloquea workers cuando hay anti-bot, hasta que el usuario actue. */
        antiBotGate: {
          active: false,
          resolve: null as (() => void) | null,
          promise: null as Promise<void> | null,
        },
      }
      syncRef.current = sync

      const phase2Promise = barridoApiPhase2Seal({
        runId: prepared.runId,
        retailId: prepared.retailId,
        maxPages: getMaxScrappingPages(),
      }, sync.abortController.signal).catch(() => ({ ok: false as const, error: 'Fase 2 cancelada por el usuario.' } as BarridoPhase2SealResponse))

      const runWorker = async () => {
        while (!sync.stop) {
          let res: ProcessLiderScrappingRunPageResult
          try {
            res = await barridoApiProcessRunPage(prepared.runId, sync.abortController.signal)
          } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') {
              sync.stop = true
              return
            }
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
          if (okRes.__diagnostic) {
            const diagStr = typeof okRes.__diagnostic === 'string' ? okRes.__diagnostic : JSON.stringify(okRes.__diagnostic)
            requestLogger.logUI(
              `[Captura página ${okRes.pageIndex}] Diagnóstico técnico: ${diagStr}`,
            )
          }
          setQueuePagesTotal(okRes.queuePagesTotal)
          setQueuePagesProcessed(okRes.queuePagesProcessed)
          setQueuePagesOk(okRes.queuePagesOk)
          setQueuePagesFailed(okRes.queuePagesFailed)
          setScraperRowsTotal(okRes.scrappingRowsTally)
          setRetailMaxPages(okRes.retailMaxPages)
          setRetailMaxProducts(okRes.retailMaxProducts)

          // Browser fallback: si el servidor detecto anti-bot, intentamos desde el navegador del usuario
          const isAntiBotError = okRes.error && okRes.pageUrl && okRes.pageId &&
            (okRes.error.toLowerCase().includes('anti-bot') || okRes.error.toLowerCase().includes('akamai') ||
             okRes.error.toLowerCase().includes('perimeter') || okRes.error.toLowerCase().includes('robot or human') ||
             okRes.error.toLowerCase().includes('bloqueo') || okRes.error.toLowerCase().includes('blocked') ||
             (okRes.pageUrl?.toLowerCase().includes('jumbo.cl') && okRes.error.toLowerCase().includes('no se encontraron productos')))

          if (isAntiBotError) {
            try {
              requestLogger.logUI("[Browser fallback] Capturando desde navegador")
              const browserRes = await fetch(okRes.pageUrl!, { credentials: 'omit' })
              if (browserRes.ok) {
                const html = await browserRes.text()
                if (html.length > 500) {
                  const submit = await barridoApiSubmitPageHtml({
                    runId: prepared.runId,
                    pageId: okRes.pageId!,
                    pageUrl: okRes.pageUrl!,
                    html,
                  })
                  if (submit.ok) {
                    requestLogger.logUI("[Browser fallback] OK: productos guardados")
                    setHumanAntiBotPanel(null)
                    continue
                  }
                }
              }
            } catch (e) {
              requestLogger.logUI("[Browser fallback] Error en fetch")
            }
            // Fetch automatico fallo. Activar gate y bloquear workers hasta intervencion humana.
            if (!sync.antiBotGate.active) {
              sync.antiBotGate.active = true
              sync.antiBotGate.promise = new Promise<void>(r => { sync.antiBotGate.resolve = r })
              if (!humanAntiBotPanel?.open) {
                setHumanAntiBotPanel({
                  open: true,
                  runId: prepared.runId,
                  pageId: okRes.pageId!,
                  pageUrl: okRes.pageUrl!,
                  error: okRes.error || '',
                  attempts: (humanAntiBotPanel?.attempts ?? 0) + 1,
                })
              }
              toast.error('Lider bloqueo la peticion. Abrila en tu navegador, resolve el desafio, y toca Reintentar.')
            }
            await sync.antiBotGate.promise
            continue
          }

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

        const freshRuns = await reloadRuns()
        if (typeof resolvedScrappingRowTotal === 'number') {
          setScraperRowsTotal(resolvedScrappingRowTotal)
        }

        const rowAfter = freshRuns.find((x) => x.id === sweepRunId)
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

      requestLogger.endLog(barridoLogId, actionError || browserError || startError ? 'error' : 'success', {
        runId: sweepRunId,
        pagesProcessed: lastOk?.queuePagesProcessed,
        pagesTotal: lastOk?.queuePagesTotal,
        error: actionError || browserError || startError || undefined,
      })
      syncRef.current = null
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
        <DialogContent className="modal-lg">
          <DialogHeader>
            <DialogTitle>Plan del barrido</DialogTitle>
            {selectedRetailName && !modalRetailId ?
              <DialogDescription>
                Retail: <span className="font-medium text-foreground">{selectedRetailName}</span>
              </DialogDescription>
            : <DialogDescription>Elige cómo continuar con la corrida de scrapping.</DialogDescription>}
          </DialogHeader>

          {/* Selector de retail dentro del modal */}
          <div className="space-y-2 mb-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="modal-retail-select">Retail a consultar</Label>
              {barridoPlanLoading && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Cargando…
                </span>
              )}
            </div>
            <Select
              value={modalRetailId}
              onValueChange={(value) => {
                setModalRetailId(value)
                void loadBarridoContextForModal(value)
              }}
              disabled={barridoPlanActionBusy || fullSweepBusy || retailsBusy}
            >
              <SelectTrigger id="modal-retail-select" className="w-full">
                <SelectValue placeholder={retailsBusy ? 'Cargando retails…' : 'Elige un retail'} />
              </SelectTrigger>
              <SelectContent>
                {retails.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {barridoPlanCtx && barridoPlanCtx.ok ?
            <div className="space-y-4 text-sm">
              {(() => {
                const isActive = fullSweepBusy || barridoPlanCtx?.runningForRetail
                /**
                 * Pausado: corrida con status `paused` (Detener) o `cancelled` legacy con páginas
                 * reanudables (compat con corridas detenidas antes de migrar a `paused`).
                 */
                const latestRunStatus = barridoPlanCtx.latestRun?.status
                const latestFailedPages = barridoPlanCtx.latestRun?.failedPages ?? 0
                const latestPendingPages = barridoPlanCtx.latestRun?.pagesPending ?? 0
                const isPausedReanudable =
                  !isActive &&
                  (latestRunStatus === 'paused' ||
                    (latestRunStatus === 'cancelled' &&
                      (latestFailedPages > 0 || latestPendingPages > 0)))
                const isConcluded = !isActive && !isPausedReanudable
                const isPaused = isPausedReanudable

                if (isActive) {
                  const progressPct =
                    queuePagesTotal > 0 ?
                      Math.round((queuePagesProcessed / queuePagesTotal) * 100)
                    : 0
                  return (
                    <div className="space-y-4">
                      <div className="scrapping-state-header scrapping-state-header--active">
                        <Loader2 className="h-4 w-4 animate-spin text-blue-600" aria-hidden />
                        Barrido en ejecución · {currentRetailLabel || 'Cargando…'}
                      </div>

                      <div className="scrapping-metrics-grid">
                        <div className="scrapping-metric scrapping-metric--lg scrapping-metric--blue">
                          <p className="scrapping-metric-value scrapping-metric-value--lg">{queuePagesTotal.toLocaleString('es-CL')}</p>
                          <p className="scrapping-metric-label">Páginas total</p>
                        </div>
                        <div className="scrapping-metric scrapping-metric--lg scrapping-metric--blue">
                          <p className="scrapping-metric-value scrapping-metric-value--lg">
                            {Math.max(scraperRowsTotal, barridoPlanCtx.runningForRetail?.rowsInserted ?? 0).toLocaleString('es-CL')}
                          </p>
                          <p className="scrapping-metric-label">Productos</p>
                        </div>
                        <div className="scrapping-metric scrapping-metric--lg scrapping-metric--amber">
                          <p className="scrapping-metric-value scrapping-metric-value--lg">{Math.max(0, queuePagesTotal - queuePagesProcessed).toLocaleString('es-CL')}</p>
                          <p className="scrapping-metric-label">Restantes</p>
                        </div>
                        <div className="scrapping-metric scrapping-metric--lg scrapping-metric--emerald">
                          <p className="scrapping-metric-value scrapping-metric-value--lg">{queuePagesOk.toLocaleString('es-CL')}</p>
                          <p className="scrapping-metric-label">Ok</p>
                        </div>
                        <div className="scrapping-metric scrapping-metric--lg scrapping-metric--rose">
                          <p className="scrapping-metric-value scrapping-metric-value--lg">{queuePagesFailed.toLocaleString('es-CL')}</p>
                          <p className="scrapping-metric-label">Fallidas</p>
                        </div>
                        <div className="scrapping-metric scrapping-metric--lg scrapping-metric--sky">
                          <p className="scrapping-metric-value scrapping-metric-value--lg">{Math.max(0, queuePagesProcessed).toLocaleString('es-CL')}</p>
                          <p className="scrapping-metric-label">Procesadas</p>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="scrapping-progress-labels">
                          <span>{queuePagesProcessed.toLocaleString('es-CL')} de {queuePagesTotal.toLocaleString('es-CL')}</span>
                          <span>{progressPct}%</span>
                        </div>
                        <ScrappingProgressBar
                          percent={progressPct}
                          active={queuePagesTotal > 0}
                        />
                      </div>

                      <div className="scrapping-action-box scrapping-action-box--wide scrapping-action-box--amber">
                        <p className="scrapping-action-box-title scrapping-action-box-title--amber">Detener</p>
                        <Button
                          type="button"
                          className="btn-warn btn-lg-block"
                          disabled={stopBusy}
                          onClick={() => {
                            requestLogger.logClick('Detener scrapping (desde modal)')
                            void onDetenerScrapping()
                          }}
                        >
                          {stopBusy ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                          ) : (
                            <Square className="mr-2 h-4 w-4" aria-hidden />
                          )}
                          Detener
                        </Button>
                        <p className="scrapping-action-hint">Pausa la corrida; podés reanudar después</p>
                      </div>

                      <p className="scrapping-footnote scrapping-footnote--active">
                        El barrido continúa en segundo plano si cerrás este modal.
                      </p>
                    </div>
                  )
                }

                if (isPaused) {
                  return (
                    <div className="space-y-4">
                      <div className="scrapping-state-header scrapping-state-header--paused">
                        <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
                        Corrida pausada · {currentRetailLabel || 'Cargando…'}
                      </div>

                      {(() => {
                        const lr = barridoPlanCtx.latestRun
                        if (!lr) return null
                        const total = lr.pagesTotal
                        const pendingResumable = lr.pagesPending
                        const okPages = Math.max(0, lr.pagesDone - lr.failedPages)
                        return (
                          <div className="scrapping-metrics-grid">
                            <div className="scrapping-metric scrapping-metric--lg scrapping-metric--blue">
                              <p className="scrapping-metric-value scrapping-metric-value--lg">{total.toLocaleString('es-CL')}</p>
                              <p className="scrapping-metric-label">Páginas total</p>
                            </div>
                            <div className="scrapping-metric scrapping-metric--lg scrapping-metric--blue">
                              <p className="scrapping-metric-value scrapping-metric-value--lg">{lr.rowsInserted.toLocaleString('es-CL')}</p>
                              <p className="scrapping-metric-label">Productos</p>
                            </div>
                            <div className="scrapping-metric scrapping-metric--lg scrapping-metric--amber">
                              <p className="scrapping-metric-value scrapping-metric-value--lg">{pendingResumable.toLocaleString('es-CL')}</p>
                              <p className="scrapping-metric-label">Reanudables</p>
                            </div>
                            <div className="scrapping-metric scrapping-metric--lg scrapping-metric--emerald">
                              <p className="scrapping-metric-value scrapping-metric-value--lg">{okPages.toLocaleString('es-CL')}</p>
                              <p className="scrapping-metric-label">Ok</p>
                            </div>
                            <div className="scrapping-metric scrapping-metric--lg scrapping-metric--rose">
                              <p className="scrapping-metric-value scrapping-metric-value--lg">{lr.failedPages.toLocaleString('es-CL')}</p>
                              <p className="scrapping-metric-label">Fallidas</p>
                            </div>
                            <div className="scrapping-metric scrapping-metric--lg scrapping-metric--sky">
                              <p className="scrapping-metric-value scrapping-metric-value--lg">{lr.pagesDone.toLocaleString('es-CL')}</p>
                              <p className="scrapping-metric-label">Procesadas</p>
                            </div>
                          </div>
                        )
                      })()}

                      <div className="scrapping-actions-row">
                        <div className="scrapping-action-box scrapping-action-box--emerald">
                          <p className="scrapping-action-box-title scrapping-action-box-title--emerald">Reanudar</p>
                          <Button
                            type="button"
                            className="btn-emerald btn-lg-block"
                            disabled={barridoPlanActionBusy}
                            onClick={() => {
                              const runId = barridoPlanCtx?.latestRun?.runId
                              if (runId) void resumeBarridoFromModal(runId)
                            }}
                          >
                            {barridoPlanActionBusy ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                            ) : (
                              <Play className="mr-2 h-4 w-4" aria-hidden />
                            )}
                            Reanudar
                          </Button>
                          <p className="scrapping-action-hint">Continúa con las páginas pendientes</p>
                        </div>

                        <div className="scrapping-action-box scrapping-action-box--rose">
                          <p className="scrapping-action-box-title scrapping-action-box-title--rose">Terminar</p>
                          <Button
                            type="button"
                            className="btn-danger btn-lg-block"
                            disabled={forceFinalizeBusy}
                            onClick={() => void onForceFinalizeScrappingFromModal()}
                          >
                            {forceFinalizeBusy ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                            ) : (
                              <AlertTriangle className="mr-2 h-4 w-4" aria-hidden />
                            )}
                            Terminar
                          </Button>
                          <p className="scrapping-action-hint">Cierra la corrida sin descargar más</p>
                        </div>
                      </div>

                      <div className="scrapping-warning-box">
                        <AlertTriangle className="inline mr-1 h-3 w-3" aria-hidden />
                        <strong>Advertencia:</strong> &ldquo;Terminar&rdquo; marca todas las páginas pendientes o en proceso como completadas sin descargar. No se podrá retomar el barrido después. Es irreversible.
                      </div>
                    </div>
                  )
                }

                return (
                  <div className="space-y-4">
                    {barridoPlanCtx.anyRunningGlobally && !barridoPlanCtx.runningForRetail && (
                      <p className="homolog-callout homolog-callout--amber">
                        Hay una corrida en curso en otro retail. Detené el scrapping antes de iniciar un barrido nuevo
                        o vaciar tablas desde acá.
                      </p>
                    )}

                    {barridoPlanCtx.latestRun ? (
                      <>
                        <div className="scrapping-info-panel">
                          <p className="font-medium">Última corrida registrada</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Estado: {barridoPlanCtx.latestRun.status}
                          </p>
                        </div>

                        {(() => {
                          const lr = barridoPlanCtx.latestRun
                          if (!lr) return null
                          const total = lr.pagesTotal
                          const okPages = Math.max(0, lr.pagesDone - lr.failedPages)
                          const restantes = Math.max(0, total - lr.pagesDone)
                          return (
                            <div className="scrapping-metrics-grid">
                              <div className="scrapping-metric scrapping-metric--md scrapping-metric--blue">
                                <p className="scrapping-metric-value scrapping-metric-value--md">{total.toLocaleString('es-CL')}</p>
                                <p className="scrapping-metric-label">Páginas total</p>
                              </div>
                              <div className="scrapping-metric scrapping-metric--md scrapping-metric--blue">
                                <p className="scrapping-metric-value scrapping-metric-value--md">{lr.rowsInserted.toLocaleString('es-CL')}</p>
                                <p className="scrapping-metric-label">Productos</p>
                              </div>
                              <div className="scrapping-metric scrapping-metric--md scrapping-metric--rose">
                                <p className="scrapping-metric-value scrapping-metric-value--md">{lr.failedPages.toLocaleString('es-CL')}</p>
                                <p className="scrapping-metric-label">Fallidas</p>
                              </div>
                              <div className="scrapping-metric scrapping-metric--md scrapping-metric--emerald">
                                <p className="scrapping-metric-value scrapping-metric-value--md">{okPages.toLocaleString('es-CL')}</p>
                                <p className="scrapping-metric-label">Ok</p>
                              </div>
                              <div className="scrapping-metric scrapping-metric--md scrapping-metric--sky">
                                <p className="scrapping-metric-value scrapping-metric-value--md">{lr.pagesDone.toLocaleString('es-CL')}</p>
                                <p className="scrapping-metric-label">Procesadas</p>
                              </div>
                              <div className="scrapping-metric scrapping-metric--md scrapping-metric--amber">
                                <p className="scrapping-metric-value scrapping-metric-value--md">{restantes.toLocaleString('es-CL')}</p>
                                <p className="scrapping-metric-label">Restantes</p>
                              </div>
                            </div>
                          )
                        })()}
                      </>
                    ) : (
                      <p className="text-muted-foreground">No hay corridas previas para este retail.</p>
                    )}

                    <div className="scrapping-actions-row">
                      <div className="scrapping-action-box scrapping-action-box--neutral">
                        <p className="scrapping-action-box-title">Nuevo barrido</p>
                        <Button
                          type="button"
                          className="btn-new btn-lg-block"
                          disabled={
                            barridoPlanActionBusy ||
                            (barridoPlanCtx.anyRunningGlobally && !barridoPlanCtx.runningForRetail)
                          }
                          onClick={() => void startBarridoFreshFromModal()}
                        >
                          {barridoPlanActionBusy ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                          ) : (
                            <Play className="mr-2 h-4 w-4" aria-hidden />
                          )}
                          Nuevo
                        </Button>
                        <p className="scrapping-action-hint">Empieza una corrida desde cero</p>
                      </div>

                      {barridoPlanCtx.globalScrappingProducts > 0 || barridoPlanCtx.globalScrappingPages > 0 ? (
                        <div className="scrapping-action-box scrapping-action-box--danger">
                          <p className="scrapping-action-box-title">Borrar</p>
                          <Button
                            type="button"
                            className="btn-danger btn-lg-block"
                            disabled={
                              purgeIdleBusy ||
                              barridoPlanActionBusy ||
                              barridoPlanCtx.anyRunningGlobally
                            }
                            onClick={() => void onPurgeScrappingIdle()}
                          >
                            {purgeIdleBusy ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                            ) : (
                              <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                            )}
                            Borrar
                          </Button>
                          <p className="scrapping-action-hint tabular-nums">
                            {barridoPlanCtx.globalScrappingProducts.toLocaleString('es-CL')} prod · {barridoPlanCtx.globalScrappingPages.toLocaleString('es-CL')} pág
                          </p>
                        </div>
                      ) : (
                        <div className="scrapping-action-box scrapping-action-box--muted-disabled">
                          <p className="scrapping-action-box-title--muted">Borrar</p>
                          <Button
                            type="button"
                            className="btn-danger btn-lg-block"
                            disabled
                          >
                            <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                            Borrar
                          </Button>
                          <p className="scrapping-action-hint">Sin datos para borrar</p>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })()}
            </div>
          : !barridoPlanLoading && (!barridoPlanCtx || !barridoPlanCtx.ok) ?
            <div className="py-8 text-center text-sm text-muted-foreground">
              {!modalRetailId ?
                <p>Selecciona un retail arriba para ver las opciones disponibles.</p>
              :
                <p>No se pudo cargar el contexto del retail. Intenta seleccionar otro retail o recarga la página.</p>
              }
            </div>
          : null}

          <DialogFooter className="sm:justify-end">
            <Button
              type="button"
              className="btn-close btn-sm"
              onClick={() => {
                setBarridoPlanOpen(false)
                setBarridoPlanCtx(null)
              }}
            >
              <X className="mr-1 h-4 w-4" aria-hidden />
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">Scraper retail (motor Lider)</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Durante un barrido activo aparecerá <span className="font-medium text-foreground">Detener scrapping</span>.
              Al pulsar <span className="font-medium text-foreground">Barrido</span> se abre el plan de corrida:
              si hay una corrida en curso podés <span className="font-medium text-foreground">Continuar</span>,
              <span className="font-medium text-foreground">Detener</span> o
              <span className="font-medium text-foreground">Concluir forzado</span> (irreversible).
              Una vez concluida (completada, cancelada o forzada) podés iniciar un
              <span className="font-medium text-foreground">Nuevo</span> barrido o
              <span className="font-medium text-foreground">Limpiar</span> los datos capturados.
              Elige el retail en el modal de Barrido.
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

        <div className="mt-4">
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Log</p>
            <p className="mt-1 wrap-break-word font-mono text-xs leading-relaxed text-muted-foreground">{logReference}</p>
            <p className="mt-1 wrap-break-word font-mono text-xs leading-relaxed text-foreground">{logCurrent}</p>
            {referenceRun?.error_message && !fullSweepBusy ? (
              <p className="mt-1 font-mono text-[11px] text-amber-700 dark:text-amber-300">
                Aviso: {referenceRun.error_message}
              </p>
            ) : null}
          </div>
        </div>

        {/* Barra de progreso - full width */}
        <div className="mt-4 space-y-1">
          <div className="scrapping-progress-host-labels">
            <span>
              Avance: páginas procesadas del total en cola. La barra no retrocede si la cola crece.
            </span>
            <span className="tabular-nums">{fullSweepBusy ? `${progressBarPercent}%` : '—'}</span>
          </div>
          <div
            className={cn('scrapping-progress-host', fullSweepBusy && 'scrapping-progress-host--active')}
            role={fullSweepBusy ? 'progressbar' : undefined}
            aria-valuenow={fullSweepBusy ? progressBarPercent : undefined}
            aria-valuemin={fullSweepBusy ? 0 : undefined}
            aria-valuemax={fullSweepBusy ? 100 : undefined}
            aria-label={
              fullSweepBusy ?
                'Avance del barrido según páginas procesadas respecto al total de la cola'
              : 'Barra inactiva: solo muestra avance durante un barrido en curso'
            }
          >
            <ScrappingProgressBar
              percent={progressBarPercent}
              active={fullSweepBusy}
              tone="primary"
            />
          </div>
          {fullSweepBusy && retailMaxPages > 0 ? (
            <p className="text-[10px] text-muted-foreground">
              Referencia histórica: {retailMaxPages} páginas (informativo, no limita la captura).
            </p>
          ) : null}
          {!fullSweepBusy ? (
            <p className="text-[10px] text-muted-foreground">
              Los valores de páginas y productos máximos son solo referencia histórica.
            </p>
          ) : null}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-border bg-background/80 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cola de páginas</p>
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
            <p className="mt-1 text-xs text-muted-foreground">Productos capturados en esta corrida</p>
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
              Al terminar un barrido (exitoso, con error o detención) aparece aquí el detalle. El mismo resumen
              se guarda en la columna «Mensaje» del historial de corridas.
            </p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {runsBusy ? <p className="text-sm text-muted-foreground">Cargando corridas…</p> : null}
          
          {/* Mostrar warning si hay corrida running en otro retail */}
          {!runsBusy && runs.some((r) => r.status === 'running' && r.retail_id !== selectedRetailId) && (
            <span className="inline-flex items-center rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-800 dark:text-amber-200">
              Hay scrapping en curso en otro retail
            </span>
          )}
          
          {/* Solo mostrar botón Detener cuando hay algo que detener */}
          {(canStopScrapping || stopBusy) && (
            <Button
              type="button"
              className="btn-warn btn-sm"
              onClick={() => {
                requestLogger.logClick('Detener scrapping')
                void onDetenerScrapping()
              }}
              disabled={!canStopScrapping || stopBusy || runsBusy}
              title="Pausa la corrida en curso; podés reanudarla después"
              aria-label="Detener scrapping"
            >
              {stopBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Square className="mr-2 h-4 w-4" aria-hidden />
              )}
              Detener scrapping
            </Button>
          )}
          <Button
            type="button"
            className="btn-run btn-sm"
            onClick={() => {
              requestLogger.logClick('Barrido - Abrir Modal Plan')
              void openBarridoPlanModal()
            }}
            disabled={retailsBusy}
          >
            {fullSweepBusy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Play className="mr-2 h-4 w-4" aria-hidden />
            )}
            {fullSweepBusy ? 'Ver barrido' : 'Barrido'}
          </Button>
        </div>


      </div>

      {/* Panel de anti-bot humano: cuando el retail bloquea el servidor, el usuario resuelve desde su navegador */}
      {humanAntiBotPanel?.open && (
        <div className="rounded-md border border-amber-300 bg-amber-50/70 p-4 dark:border-amber-800 dark:bg-amber-950/30">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 shrink-0">
              <svg className="h-5 w-5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="flex-1 space-y-3 text-sm text-amber-900 dark:text-amber-100">
              <p className="font-medium">Lider bloqueo la captura automatica</p>
              <p className="text-amber-800/80 dark:text-amber-200/80">
                La tienda detecto que la peticion viene de un servidor. Abrila en tu navegador, resolve el desafio de seguridad (captcha / "Press & Hold"), y volve aca para continuar.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.open(humanAntiBotPanel.pageUrl, '_blank', 'noopener,noreferrer')}
                  className="inline-flex items-center gap-1.5 rounded-md bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-200 dark:bg-amber-800 dark:text-amber-100 dark:hover:bg-amber-700"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Abrir URL en nueva pestaña
                </button>
                <button
                  type="button"
                  onClick={() => void retryHumanAntiBotPage()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Reintentar
                </button>
                <button
                  type="button"
                  onClick={() => void skipHumanAntiBotPage()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-800"
                >
                  Omitir pagina
                </button>
              </div>
              <p className="text-xs text-amber-700/70 dark:text-amber-300/70">
                {humanAntiBotPanel.error} · Intentos: {humanAntiBotPanel.attempts}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <p className="text-sm font-medium text-foreground">Corridas recientes</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Historial de las últimas 32 corridas de captura. La columna Mensaje muestra
          resúmenes de fallas, detenciones manuales o interrupciones del proceso.
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
                        : (r.total_pages != null && r.total_pages >= 0 ?
                            r.total_pages.toLocaleString('es-CL')
                          : r.status === 'paused' || r.status === 'completed' || r.status === 'cancelled' ?
                            (r.pages_done ?? 0).toLocaleString('es-CL')
                          : '—')}
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
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">Análisis de homologación al catálogo</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Estos pasos solo se ejecutan cuando no hay una captura en curso (finalizada automáticamente o cerrada
              manualmente). Los productos ya vinculados a tu catálogo no se procesan de nuevo.
              El paso 1 identifica productos que ya están en tu catálogo antes de buscar coincidencias por nombre.
            </p>
          </div>
        </div>

        {homologacionBloqueada ?
          <p className="homolog-callout homolog-callout--amber">
            {runsBusy ?
              'Cargando estado de corridas…'
            : fullSweepBusy ?
              'Hay un barrido en ejecución en esta pestaña. Esperá el cierre o detené el scrapping antes de homologar.'
            : 'Hay una corrida en curso en la base. Finalizá el scrapping antes de usar los pasos de homologación.'}
          </p>
        : null}

        {!homologacionBloqueada && scrappingPendingHomologacion !== null ?
          <p className="mt-3 text-xs text-muted-foreground tabular-nums">
            Productos pendientes de procesar:{' '}
            <span className="font-medium text-foreground">
              {scrappingPendingHomologacion.toLocaleString('es-CL')}
            </span>
          </p>
        : null}

        {paso2Destacado ?
          <p className="homolog-callout homolog-callout--sky">
            Hay productos pendientes de clasificar. Abrí el paso 2 para revisar los candidatos más parecidos
            por marca, nombre y precio. Si ninguno corresponde, marcá «No / nuevo» para crear un producto nuevo.
          </p>
        : !homologacionBloqueada && scrappingPendingHomologacion === 0 ?
          <p className="homolog-callout homolog-callout--emerald">
            Todos los productos capturados fueron procesados. No quedan pendientes.
          </p>
        : null}

        <div className="homolog-steps-grid">
          <div className="homolog-step-card homolog-step-card--sky">
            <div className="homolog-step-card__accent homolog-step-card__accent--sky" />
            <div className="homolog-step-card__head">
              <div className="homolog-step-card__icon-wrap homolog-step-card__icon-wrap--sky">
                <Link2 className="homolog-step-card__icon homolog-step-card__icon--on-color" />
              </div>
              <div>
                <p className="homolog-step-card__kicker">Paso 1</p>
                <p className="homolog-step-card__title">Coincidencias exactas</p>
              </div>
            </div>
            <p className="homolog-step-card__body">
              Quita de scrapping lo que ya está en tu catálogo y homologa por nombre + marca exactos al maestro.
            </p>
            <Button
              type="button"
              className="btn-run homolog-step-card__btn"
              onClick={() => void onApplyExactCatalogMatches()}
              disabled={homologacionBloqueada || exactMatchBusy}
              title={
                homologacionBloqueada ?
                  'Finalizá el scrapping (ninguna corrida en curso) antes de homologar.'
                : 'Ejecuta el paso 1 en base (RPC)'
              }
            >
              {exactMatchBusy ?
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              : <Link2 className="h-4 w-4" aria-hidden />}
              Ejecutar paso 1
            </Button>
          </div>

          <div
            className={cn(
              'homolog-step-card',
              paso2Destacado ? 'homolog-step-card--violet-active' : 'homolog-step-card--violet',
            )}
          >
            <div
              className={cn(
                'homolog-step-card__accent homolog-step-card__accent--violet',
                paso2Destacado && 'homolog-step-card__accent--violet-active',
              )}
            />
            <div className="homolog-step-card__head">
              <div
                className={cn(
                  'homolog-step-card__icon-wrap',
                  paso2Destacado ?
                    'homolog-step-card__icon-wrap--violet-active'
                  : 'homolog-step-card__icon-wrap--violet',
                )}
              >
                <Sparkles
                  className={cn(
                    'homolog-step-card__icon',
                    paso2Destacado ? 'homolog-step-card__icon--on-color' : 'homolog-step-card__icon--muted',
                  )}
                />
              </div>
              <div>
                <p className="homolog-step-card__kicker">
                  {paso2Destacado ? 'Paso 2 · Disponible' : 'Paso 2 · Sin cola'}
                </p>
                <p className="homolog-step-card__title">Homologación inteligente</p>
              </div>
            </div>
            <p className="homolog-step-card__body">
              Clasificación automática de productos con asistencia de IA y revisión de casos dudosos.
            </p>

            {homologDash ?
              <div className="mb-2 mt-3 flex flex-1 flex-wrap content-start gap-2">
                <span className="inline-flex items-center gap-1 rounded-md border border-primary/15 bg-primary/5 px-2 py-0.5 text-[10px] font-bold tabular-nums text-primary">
                  {homologDash.pendingAny.toLocaleString('es-CL')} <span className="font-normal opacity-70">pending</span>
                </span>
                <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/15 bg-amber-500/5 px-2 py-0.5 text-[10px] font-bold tabular-nums text-amber-700">
                  {homologDash.grayIaQueued.toLocaleString('es-CL')} <span className="font-normal opacity-70">gris IA</span>
                </span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold tabular-nums',
                    homologDash.userReview > 0 ?
                      'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300'
                    : 'border-violet-500/15 bg-violet-500/5 text-violet-700',
                  )}
                >
                  {homologDash.userReview.toLocaleString('es-CL')} <span className="font-normal opacity-70">revisar</span>
                </span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold tabular-nums',
                    homologDash.pendingNew > 0 ?
                      'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-emerald-500/15 bg-emerald-500/5 text-emerald-700',
                  )}
                >
                  {homologDash.pendingNew.toLocaleString('es-CL')} <span className="font-normal opacity-70">nuevos</span>
                </span>
              </div>
            : <div className="flex-1" />}

            {homologDash && homologDash.userReview > 0 ?
              <Button
                type="button"
                className="btn-violet-alt homolog-step-card__btn"
                disabled={homologacionBloqueada}
                onClick={() => setScrappingSimilarityModalOpen(true)}
              >
                <LayoutGrid className="h-4 w-4" aria-hidden />
                Revisar {homologDash.userReview.toLocaleString('es-CL')} caso(s)
              </Button>
            :
              <Button
                type="button"
                className="btn-violet homolog-step-card__btn"
                disabled={
                  homologacionBloqueada ||
                  exactMatchBusy ||
                  fullSweepBusy ||
                  runsBusy ||
                  scrappingPendingHomologacion === null ||
                  scrappingPendingHomologacion === 0
                }
                onClick={() => setHomologWizardOpen(true)}
              >
                <Zap className="h-4 w-4" aria-hidden />
                Iniciar homologación
              </Button>
            }
          </div>

          <div
            className={cn(
              'homolog-step-card',
              (homologDash?.pendingNew ?? 0) > 0 ?
                'homolog-step-card--emerald-active'
              : 'homolog-step-card--emerald',
            )}
          >
            <div
              className={cn(
                'homolog-step-card__accent homolog-step-card__accent--emerald',
                (homologDash?.pendingNew ?? 0) > 0 && 'homolog-step-card__accent--emerald-active',
              )}
            />
            <div className="homolog-step-card__head">
              <div
                className={cn(
                  'homolog-step-card__icon-wrap',
                  (homologDash?.pendingNew ?? 0) > 0 ?
                    'homolog-step-card__icon-wrap--emerald-active'
                  : 'homolog-step-card__icon-wrap--emerald',
                )}
              >
                <PackagePlus
                  className={cn(
                    'homolog-step-card__icon',
                    (homologDash?.pendingNew ?? 0) > 0 ?
                      'homolog-step-card__icon--on-color'
                    : 'homolog-step-card__icon--muted',
                  )}
                />
              </div>
              <div>
                <p className="homolog-step-card__kicker">
                  {(homologDash?.pendingNew ?? 0) > 0 ? 'Paso 3 · Disponible' : 'Paso 3 · Sin cola'}
                </p>
                <p className="homolog-step-card__title">Nuevos en catálogo</p>
              </div>
            </div>
            <p className="homolog-step-card__body">
              Productos sin homólogo: alta en maestro con sección y categoría, imagen y taxonomía automática.
            </p>

            {homologDash ?
              <div className="mt-3 mb-2 flex flex-1 flex-wrap content-start gap-2">
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold tabular-nums',
                    homologDash.pendingNew > 0 ?
                      'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-emerald-500/15 bg-emerald-500/5 text-emerald-700',
                  )}
                >
                  {homologDash.pendingNew.toLocaleString('es-CL')} <span className="font-normal opacity-70">nuevos</span>
                </span>
                {createNewResult ?
                  <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-normal tabular-nums text-muted-foreground">
                    {createNewResult}
                  </span>
                : null}
              </div>
            : <div className="flex-1" />}

            <Button
              type="button"
              className="btn-create homolog-step-card__btn"
              disabled={
                createNewBusy ||
                homologacionBloqueada ||
                homologDash === null ||
                (homologDash?.pendingNew ?? 0) === 0
              }
              onClick={() => setCreateNewModalOpen(true)}
            >
              <PackagePlus className="h-4 w-4" aria-hidden />
              {(homologDash?.pendingNew ?? 0) > 0 ?
                `Crear ${homologDash!.pendingNew.toLocaleString('es-CL')} productos`
              : 'Sin pendientes'}
            </Button>
          </div>
        </div>

        {exactMatchLast ?
          <p className="mt-4 rounded-md border border-border bg-background/80 px-3 py-2 text-xs text-muted-foreground tabular-nums">
            Último paso 1:{' '}
            {exactMatchLast.scrappingDuplicatesPurged > 0 ?
              `${exactMatchLast.scrappingDuplicatesPurged.toLocaleString('es-CL')} ya en catálogo · `
            : null}
            {exactMatchLast.scrappingRowsRemoved.toLocaleString('es-CL')} por nombre exacto ·{' '}
            {exactMatchLast.distinctCatalogProducts.toLocaleString('es-CL')} maestro(s) · quedaron{' '}
            {exactMatchLast.pendingScrappingRemaining.toLocaleString('es-CL')} pending
          </p>
        : null}

      </div>

      <HomologationWizardModal
        open={homologWizardOpen}
        onOpenChange={setHomologWizardOpen}
        pendingCount={scrappingPendingHomologacion ?? 0}
        grayIaQueued={homologDash?.grayIaQueued ?? 0}
        onFinished={async () => {
          await refreshScrappingPendingHomologacion()
        }}
        onOpenReview={() => {
          setHomologWizardOpen(false)
          setScrappingSimilarityModalOpen(true)
        }}
      />

      <ScrappingSimilarityReviewModal
        open={scrappingSimilarityModalOpen}
        onOpenChange={setScrappingSimilarityModalOpen}
        homologacionBloqueada={homologacionBloqueada}
        onApplied={async () => {
          await refreshScrappingPendingHomologacion()
          await reloadRuns()
        }}
      />

      <CreateNewProductsModal
        open={createNewModalOpen}
        onOpenChange={setCreateNewModalOpen}
        pendingNew={homologDash?.pendingNew ?? 0}
        onFinished={async () => {
          setCreateNewResult(null)
          await refreshScrappingPendingHomologacion()
        }}
      />

    </div>
  )
}
