'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Play, Square } from 'lucide-react'
import { toast } from 'sonner'
import {
  listRetailTargetsAction,
  listScrappingRunsAction,
  persistScrappingRunBarridoOutcomeIfRunningAction,
  processLiderScrappingRunPageAction,
  startLiderScrappingRunAction,
  stopLiderScrappingAction,
} from '@/app/actions/retail-scrapping'
import type { RetailTargetRow, ScrappingRunRow } from '@/types/retail-scrapping-ui'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
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

function scrappingRunStatusLabel(status: string): string {
  const s = (status ?? '').toLowerCase()
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

  const canStopScrapping = useMemo(() => {
    return fullSweepBusy || runs.some((r) => r.status === 'running')
  }, [fullSweepBusy, runs])

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
    const res = await listScrappingRunsAction()
    setRunsBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setRuns(res.runs)
  }, [])

  const reloadRetails = useCallback(async () => {
    setRetailsBusy(true)
    const res = await listRetailTargetsAction()
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
      const res = await stopLiderScrappingAction()
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

  async function onBarrido() {
    if (fullSweepBusy) return
    if (!selectedRetailId) {
      toast.error('Seleccioná un retail antes de ejecutar el barrido.')
      return
    }
    const retailLabelAtStart = retails.find((x) => x.id === selectedRetailId)?.name ?? ''

    setFullSweepBusy(true)
    resetMetricBoxesOnly()
    setSweepStartedAt(new Date().toISOString())

    let sweepRunId: string | null = null
    let warnedContinue = false
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
      const started = await startLiderScrappingRunAction({ retailId: selectedRetailId })
      if (!started.ok) {
        startError = started.error
        toast.error(started.error)
        return
      }

      sweepRunId = started.runId
      finalRetailName = started.retailName
      setCurrentRetailLabel(started.retailName)
      setRetailMaxPages(started.retailMaxPages)
      setRetailMaxProducts(started.retailMaxProducts)
      setQueuePagesTotal(started.totalPages)
      setQueuePagesProcessed(0)
      setQueuePagesOk(0)
      setQueuePagesFailed(0)
      setScraperRowsTotal(0)
      await reloadRuns()

      toast.message(`Cola inicial: ${started.totalPages} listado(s) · ${started.retailName}.`)

      for (;;) {
        let res: Awaited<ReturnType<typeof processLiderScrappingRunPageAction>>
        try {
          res = await processLiderScrappingRunPageAction({ runId: started.runId })
        } catch (e) {
          browserError = e instanceof Error ? e.message : String(e)
          break
        }
        if (!res.ok) {
          actionError = res.error
          toast.error(res.error)
          break
        }
        lastOk = res
        setQueuePagesTotal(res.queuePagesTotal)
        setQueuePagesProcessed(res.queuePagesProcessed)
        setQueuePagesOk(res.queuePagesOk)
        setQueuePagesFailed(res.queuePagesFailed)
        setScraperRowsTotal(res.scrappingRowsTally)
        setRetailMaxPages(res.retailMaxPages)
        setRetailMaxProducts(res.retailMaxProducts)

        if (res.error) {
          if (!warnedContinue) {
            warnedContinue = true
            toast.warning(
              'Algunos listados pueden fallar (p. ej. HTTP 404). Se omiten y el barrido sigue hasta vaciar la cola.',
            )
          }
        }

        if (typeof res.scrappingRowsTotal === 'number') {
          resolvedScrappingRowTotal = res.scrappingRowsTotal
        }
        if (res.done) {
          if (typeof res.scrappingRowsTotal === 'number') {
            setScraperRowsTotal(res.scrappingRowsTotal)
          }
          if (res.cancelled) {
            toast.message('Barrido detenido.')
          } else {
            toast.success(
              `Proceso finalizado · ${finalRetailName || 'Retail'} · páginas ok ${res.queuePagesOk} · fallidas ${res.queuePagesFailed} · productos en scrapping ${(res.scrappingRowsTotal ?? res.scrappingRowsTally).toLocaleString('es-CL')} · total en cola ${res.queuePagesTotal}.`,
            )
          }
          break
        }
      }
    } finally {
      const finishedAtIso = new Date().toISOString()
      let persistedRun: CapturaCadenas2SweepDiagnostic['persistedRun']

      if (sweepRunId) {
        const listBefore = await listScrappingRunsAction()
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
          const pr = await persistScrappingRunBarridoOutcomeIfRunningAction({
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
        const listAfter = await listScrappingRunsAction()
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

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">Scraper retail (motor Lider)</p>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              Podés usar el botón <span className="font-medium text-foreground">Detener scrapping</span> para
              cancelar la cola en curso. Cada <span className="font-medium text-foreground">Barrido</span> nuevo cancela
              cualquier corrida previa, vacía <code className="rounded bg-muted px-1">scrapping</code> y{' '}
              <code className="rounded bg-muted px-1">scrapping_pages</code>, y crea un registro nuevo en{' '}
              <code className="rounded bg-muted px-1">scrapping_runs</code> (cada barrido crea un registro nuevo; las
              corridas anteriores siguen en la tabla de abajo).
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
              disabled={fullSweepBusy || retailsBusy || retails.length === 0}
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
            onClick={() => void onBarrido()}
            disabled={fullSweepBusy || runsBusy || retailsBusy || !selectedRetailId}
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
                        {scrappingRunStatusLabel(r.status)}
                      </td>
                      <td className="px-3 py-2 align-top tabular-nums text-foreground">
                        {r.total_pages ?? '—'}
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
    </div>
  )
}
