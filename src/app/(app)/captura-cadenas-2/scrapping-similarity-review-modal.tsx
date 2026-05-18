'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, ClipboardCheck, Trophy, SkipForward } from 'lucide-react'
import { toast } from 'sonner'
import {
  cancelScrappingSimilarityBulkJobAction,
  confirmScrappingSimilarityLinksBatchAction,
  countScrappingSimilarityPendingAction,
  getScrappingSimilarityBulkConfigAction,
  getScrappingSimilarityBulkJobProgressAction,
  getScrappingSimilarityCandidatesAction,
  getScrappingSimilarityPrepSummaryAction,
  listScrappingSimilarityReviewPageAction,
  processScrappingSimilarityBulkBatchAction,
  recordHomologationUserFeedbackAction,
  rejectScrappingSimilarityToPendingNewBatchAction,
  startScrappingSimilarityBulkJobAction,
} from '@/app/actions/retail-scrapping'
import type { ScrappingSimilarityPrepSummary } from '@/server/retail/scrapping/scrapping-similarity-bulk-summary'
import {
  ScrappingSimilarityBulkProgress,
  type SimilarityBulkProgressState,
} from '@/app/(app)/captura-cadenas-2/scrapping-similarity-bulk-progress'
import { GridPagingRow } from '@/components/grid/grid-paging-row'
import { Button } from '@/components/ui/button'
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
import type { ScrappingProductRow } from '@/server/retail/scrapping/lider-scrapping-service'
import type { ScrappingSimilarityManualCandidate } from '@/server/retail/scrapping/scrapping-similarity-manual'

const FOOTER_ACTION_BTN = 'h-9 shrink-0'
const CANDIDATE_PREFETCH_CONCURRENCY = 6
const APPLY_BATCH_SIZE = 120

function formatSimilarityScore(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toFixed(4)
}

function shortUuid(id: string | null | undefined): string {
  const s = id?.trim()
  if (!s) return '—'
  return `${s.slice(0, 8)}…`
}

function sameProductLabel(v: boolean | null | undefined): string {
  if (v === true) return 'Sí'
  if (v === false) return 'No'
  return 'Sin declarar'
}

type ModalPhase = 'bulk' | 'review' | 'empty'

const BULK_POLL_MS = 2000

const EMPTY_BULK_PROGRESS: SimilarityBulkProgressState = {
  step: 'homologate',
  total: 0,
  processed: 0,
  purgedDuplicates: 0,
  autoLinked: 0,
  iaHintsStored: 0,
  autoPendingNew: 0,
  leftForReview: 0,
  failed: 0,
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export type ScrappingSimilarityReviewModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  homologacionBloqueada: boolean
  onApplied: () => Promise<void>
}

export function ScrappingSimilarityReviewModal({
  open,
  onOpenChange,
  homologacionBloqueada,
  onApplied,
}: ScrappingSimilarityReviewModalProps) {
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<ScrappingProductRow[]>([])
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(100)
  const [gridBusy, setGridBusy] = useState(false)
  const [applyBusy, setApplyBusy] = useState(false)
  const [phase, setPhase] = useState<ModalPhase>('bulk')
  const [bulkProgress, setBulkProgress] = useState<SimilarityBulkProgressState>(EMPTY_BULK_PROGRESS)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [bulkSessionStartedAtMs, setBulkSessionStartedAtMs] = useState<number | null>(null)
  const [prepSummary, setPrepSummary] = useState<ScrappingSimilarityPrepSummary | null>(null)
  const [prepSummaryLoading, setPrepSummaryLoading] = useState(false)

  const [candidatesCache, setCandidatesCache] = useState<Record<string, ScrappingSimilarityManualCandidate[]>>({})
  const [candBusyByRow, setCandBusyByRow] = useState<Record<string, boolean>>({})
  const [draftLinks, setDraftLinks] = useState<Record<string, string>>({})
  const [pendingRejects, setPendingRejects] = useState<Record<string, true>>({})

  const prefetchGenRef = useRef(0)
  const bulkAbortRef = useRef(false)
  const bulkJobIdRef = useRef<string | null>(null)
  const sessionStartedRef = useRef(false)
  const candidatesCacheRef = useRef(candidatesCache)
  const pendingRejectsRef = useRef(pendingRejects)
  const onAppliedRef = useRef(onApplied)

  useEffect(() => {
    onAppliedRef.current = onApplied
  }, [onApplied])

  useEffect(() => {
    candidatesCacheRef.current = candidatesCache
  }, [candidatesCache])

  useEffect(() => {
    pendingRejectsRef.current = pendingRejects
  }, [pendingRejects])

  const resetSession = useCallback(() => {
    prefetchGenRef.current += 1
    setPage(0)
    setRows([])
    setTotal(0)
    setCandidatesCache({})
    setCandBusyByRow({})
    setDraftLinks({})
    setPendingRejects({})
    setBulkProgress(EMPTY_BULK_PROGRESS)
    setBulkError(null)
    setPrepSummary(null)
    setPrepSummaryLoading(false)
    setPhase('bulk')
    bulkAbortRef.current = false
    bulkJobIdRef.current = null
    setBulkSessionStartedAtMs(null)
  }, [])

  const prefetchCandidatesForRows = useCallback(async (loadedRows: ScrappingProductRow[], gen: number) => {
    const cache = candidatesCacheRef.current
    const toFetch = loadedRows.filter((row) => cache[row.id] === undefined)
    if (toFetch.length === 0) return

    setCandBusyByRow((m) => {
      const next = { ...m }
      for (const row of toFetch) next[row.id] = true
      return next
    })

    let errorRows = 0
    for (let i = 0; i < toFetch.length; i += CANDIDATE_PREFETCH_CONCURRENCY) {
      if (gen !== prefetchGenRef.current) return
      const slice = toFetch.slice(i, i + CANDIDATE_PREFETCH_CONCURRENCY)
      await Promise.all(
        slice.map(async (row) => {
          try {
            const cr = await getScrappingSimilarityCandidatesAction({ scrappingId: row.id })
            if (gen !== prefetchGenRef.current) return
            if (!cr.ok) {
              errorRows++
              setCandidatesCache((m) => ({ ...m, [row.id]: [] }))
              return
            }
            if (cr.autoResolvedAsPendingNew) {
              setRows((prev) => prev.filter((r) => r.id !== row.id))
              setTotal((prev) => Math.max(0, prev - 1))
              return
            }
            const list = cr.candidates
            setCandidatesCache((m) => ({ ...m, [row.id]: list }))
            if (list.length > 0 && !pendingRejectsRef.current[row.id]) {
              setDraftLinks((m) => (m[row.id] ? m : { ...m, [row.id]: list[0]!.catalogProductId }))
            }
          } catch {
            if (gen === prefetchGenRef.current) {
              errorRows++
              setCandidatesCache((m) => ({ ...m, [row.id]: [] }))
            }
          } finally {
            if (gen === prefetchGenRef.current) {
              setCandBusyByRow((m) => ({ ...m, [row.id]: false }))
            }
          }
        }),
      )
    }

    if (gen !== prefetchGenRef.current) return

    if (errorRows > 0) {
      toast.error(
        `No se pudieron cargar candidatos en ${errorRows.toLocaleString('es-CL')} fila(s). Podés seguir revisando el resto.`,
      )
    }
  }, [])

  const loadPage = useCallback(
    async (pageIndex: number) => {
      prefetchGenRef.current += 1
      const gen = prefetchGenRef.current
      setGridBusy(true)
      let listOk: { rows: ScrappingProductRow[]; total: number; pageSize: number } | null = null
      try {
        const r = await listScrappingSimilarityReviewPageAction({ page: pageIndex })
        if (!r.ok) {
          toast.error(r.error)
          setRows([])
          setTotal(0)
          return
        }
        listOk = { rows: r.rows, total: r.total, pageSize: r.pageSize }
        setRows(r.rows)
        setTotal(r.total)
        setPageSize(r.pageSize)
        setPage(pageIndex)
      } finally {
        setGridBusy(false)
      }
      if (gen === prefetchGenRef.current && listOk && listOk.rows.length > 0) {
        await prefetchCandidatesForRows(listOk.rows, gen)
      }
    },
    [prefetchCandidatesForRows],
  )

  const finishBulkSession = useCallback(
    async (acc: SimilarityBulkProgressState) => {
      if (bulkAbortRef.current) {
        toast.message('Pasada automática omitida. Revisá y confirmá en la grilla.')
        setPhase('review')
        await loadPage(0)
        return
      }

      await onAppliedRef.current()

      if (acc.processed > 0) {
        const iaPart =
          (acc.iaHintsStored ?? 0) > 0 ?
            ` (${(acc.iaHintsStored ?? 0).toLocaleString('es-CL')} con sugerencia IA para revisión)`
          : ''
        toast.success(
          `Paso 2: ${acc.autoLinked.toLocaleString('es-CL')} vinculada(s)${iaPart}, ${acc.autoPendingNew.toLocaleString('es-CL')} a producto nuevo, ${acc.leftForReview.toLocaleString('es-CL')} para tu revisión.`,
        )
      }

      const reviewR = await countScrappingSimilarityPendingAction()
      if (reviewR.ok && reviewR.total === 0) {
        setPhase('empty')
        return
      }

      setPhase('review')
      await loadPage(0)
    },
    [loadPage],
  )

  const skipBulkToReview = useCallback(async () => {
    bulkAbortRef.current = true
    const jobId = bulkJobIdRef.current
    if (jobId) {
      await cancelScrappingSimilarityBulkJobAction({ jobId })
      bulkJobIdRef.current = null
    }
    setPhase('review')
    await loadPage(0)
  }, [loadPage])

  const runBulkPrepLegacy = useCallback(async () => {
    setPhase('bulk')
    setBulkError(null)
    setBulkProgress(EMPTY_BULK_PROGRESS)
    setBulkSessionStartedAtMs(Date.now())
    setPrepSummary(null)
    setPrepSummaryLoading(true)

    const summaryR = await getScrappingSimilarityPrepSummaryAction()
    setPrepSummaryLoading(false)
    if (summaryR.ok) {
      setPrepSummary(summaryR.summary)
    } else {
      setPrepSummary(null)
      setBulkError(summaryR.error)
      toast.error(summaryR.error)
      setPhase('review')
      await loadPage(0)
      return
    }

    const countR = await countScrappingSimilarityPendingAction()
    const total = countR.ok ? countR.total : summaryR.summary.totalPending
    if (!countR.ok) {
      toast.message('No se pudo refrescar el total exacto; se usa el valor del resumen en base.')
    }
    if (total === 0) {
      setPhase('empty')
      return
    }

    setBulkProgress((p) => ({ ...p, total, processed: 0 }))

    let afterId: string | null = null
    const acc: SimilarityBulkProgressState = { ...EMPTY_BULK_PROGRESS, total }

    try {
      for (;;) {
        if (bulkAbortRef.current) break

        const r = await processScrappingSimilarityBulkBatchAction({ afterId })
        if (!r.ok) {
          setBulkError(r.error)
          toast.error(r.error)
          break
        }
        const s = r.stats
        acc.processed += s.processed
        acc.autoLinked += s.autoLinked
        acc.iaHintsStored = (acc.iaHintsStored ?? 0) + s.iaHintsStored
        acc.autoPendingNew += s.autoPendingNew
        acc.leftForReview += s.leftForReview
        acc.failed += s.failed
        setBulkProgress({ ...acc, step: 'homologate', total })

        if (!s.hasMore || !s.lastId) break
        afterId = s.lastId
      }

      await finishBulkSession(acc)
    } catch {
      setBulkError('No se pudo completar la homologación automática. Intenta nuevamente.')
      setPhase('review')
      await loadPage(0)
    }
  }, [finishBulkSession, loadPage])

  const runBulkPrepBackground = useCallback(async () => {
    setPhase('bulk')
    setBulkError(null)
    setBulkProgress(EMPTY_BULK_PROGRESS)
    setBulkSessionStartedAtMs(Date.now())
    setPrepSummary(null)
    setPrepSummaryLoading(true)

    const summaryR = await getScrappingSimilarityPrepSummaryAction()
    setPrepSummaryLoading(false)
    if (summaryR.ok) {
      setPrepSummary(summaryR.summary)
    } else {
      setPrepSummary(null)
      setBulkError(summaryR.error)
      toast.error(summaryR.error)
      setPhase('review')
      await loadPage(0)
      return
    }

    const startR = await startScrappingSimilarityBulkJobAction()
    if (!startR.ok) {
      if (startR.error.includes('No hay filas pending')) {
        setPhase('empty')
        return
      }
      setBulkError(startR.error)
      toast.error(startR.error)
      setPhase('review')
      await loadPage(0)
      return
    }

    bulkJobIdRef.current = startR.jobId
    const acc: SimilarityBulkProgressState = {
      ...EMPTY_BULK_PROGRESS,
      total: startR.total,
    }
    setBulkProgress(acc)

    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

    try {
      for (;;) {
        if (bulkAbortRef.current) break

        const pr = await getScrappingSimilarityBulkJobProgressAction({ jobId: startR.jobId })
        if (!pr.ok) {
          setBulkError(pr.error)
          toast.error(pr.error)
          break
        }

        const job = pr.job
        acc.processed = job.processed
        acc.autoLinked = job.autoLinked
        acc.iaHintsStored = job.iaHintsStored
        acc.autoPendingNew = job.autoPendingNew
        acc.leftForReview = job.leftForReview
        acc.failed = job.failed
        acc.total = job.total
        setBulkProgress({ ...acc, step: 'homologate' })

        if (job.status === 'done') break
        if (job.status === 'cancelled') break
        if (job.status === 'error') {
          const msg = job.error ?? 'No se pudo completar la homologación automática.'
          setBulkError(msg)
          toast.error(msg)
          break
        }

        await sleep(BULK_POLL_MS)
      }

      bulkJobIdRef.current = null
      await finishBulkSession(acc)
    } catch {
      bulkJobIdRef.current = null
      setBulkError('No se pudo completar la homologación automática. Intenta nuevamente.')
      setPhase('review')
      await loadPage(0)
    }
  }, [finishBulkSession, loadPage])

  const runBulkPrep = useCallback(async () => {
    const cfg = await getScrappingSimilarityBulkConfigAction()
    if (cfg.skipAutoOnOpen) {
      setPhase('review')
      await loadPage(0)
      return
    }
    if (cfg.useBackgroundJob) {
      await runBulkPrepBackground()
    } else {
      await runBulkPrepLegacy()
    }
  }, [loadPage, runBulkPrepBackground, runBulkPrepLegacy])

  useEffect(() => {
    if (!open) {
      sessionStartedRef.current = false
      return
    }
    if (homologacionBloqueada) return
    if (sessionStartedRef.current) return
    sessionStartedRef.current = true
    resetSession()
    void runBulkPrep()
  }, [open, homologacionBloqueada, resetSession, runBulkPrep])

  function onSelectMaster(rowId: string, catalogProductId: string) {
    setDraftLinks((m) => ({ ...m, [rowId]: catalogProductId }))
    setPendingRejects((m) => {
      if (!m[rowId]) return m
      const next = { ...m }
      delete next[rowId]
      return next
    })
  }

  function onMarkPendingNew(rowId: string) {
    setPendingRejects((m) => ({ ...m, [rowId]: true }))
    setDraftLinks((m) => {
      if (!m[rowId]) return m
      const next = { ...m }
      delete next[rowId]
      return next
    })
  }

  function onUndoPendingNew(rowId: string) {
    setPendingRejects((m) => {
      if (!m[rowId]) return m
      const next = { ...m }
      delete next[rowId]
      return next
    })
    const cand = candidatesCacheRef.current[rowId]
    if (cand && cand.length > 0) {
      setDraftLinks((m) => ({ ...m, [rowId]: cand[0]!.catalogProductId }))
    }
  }

  const pendingLinkCount = Object.keys(draftLinks).length
  const pendingRejectCount = Object.keys(pendingRejects).length
  const pendingTotal = pendingLinkCount + pendingRejectCount

  async function onApplyAllPending() {
    if (pendingTotal === 0) {
      toast.error('No hay homologaciones en cola. Revisá filas o marcá «Producto nuevo».')
      return
    }

    const linkEntries = Object.entries(draftLinks).map(([scrappingId, catalogProductId]) => ({
      scrappingId,
      catalogProductId,
    }))
    const rejectIds = Object.keys(pendingRejects)

    setApplyBusy(true)
    let linksApplied = 0
    let rejectsApplied = 0
    const linkFailedIds = new Set<string>()
    const rejectFailedIds = new Set<string>()

    try {
      for (const batch of chunk(linkEntries, APPLY_BATCH_SIZE)) {
        const r = await confirmScrappingSimilarityLinksBatchAction({ links: batch })
        if (!r.ok) {
          toast.error(r.error)
          return
        }
        linksApplied += r.applied
        for (const f of r.failed) linkFailedIds.add(f.scrappingId)
      }

      for (const batch of chunk(rejectIds, APPLY_BATCH_SIZE)) {
        const r = await rejectScrappingSimilarityToPendingNewBatchAction({ scrappingIds: batch })
        if (!r.ok) {
          toast.error(r.error)
          return
        }
        rejectsApplied += r.applied
        for (const f of r.failed) rejectFailedIds.add(f.scrappingId)
        const okInBatch = batch.filter((id) => !(r.failed ?? []).some((f) => f.scrappingId === id))
        await Promise.all(
          okInBatch.map((id) =>
            recordHomologationUserFeedbackAction({
              scrappingId: id,
              reasonCode: 'USER_MARK_PENDING_NEW',
              penaltyDelta: -0.06,
            }),
          ),
        )
      }

      const okLinkIds = linkEntries.map((x) => x.scrappingId).filter((id) => !linkFailedIds.has(id))
      const okRejectIds = rejectIds.filter((id) => !rejectFailedIds.has(id))
      const clearedIds = new Set([...okLinkIds, ...okRejectIds])

      setDraftLinks((m) => {
        const next = { ...m }
        for (const id of okLinkIds) delete next[id]
        return next
      })
      setPendingRejects((m) => {
        const next = { ...m }
        for (const id of okRejectIds) delete next[id]
        return next
      })
      setCandidatesCache((m) => {
        const next = { ...m }
        for (const id of clearedIds) delete next[id]
        return next
      })

      if (linksApplied + rejectsApplied > 0) {
        const parts: string[] = []
        if (linksApplied > 0) parts.push(`${linksApplied.toLocaleString('es-CL')} vínculo(s)`)
        if (rejectsApplied > 0) parts.push(`${rejectsApplied.toLocaleString('es-CL')} como producto nuevo`)
        toast.success(`Se aplicaron ${parts.join(' y ')}.`)
      }
      const failedTotal = linkFailedIds.size + rejectFailedIds.size
      if (failedTotal > 0) {
        toast.warning(
          `${failedTotal.toLocaleString('es-CL')} fila(s) no se pudieron. Revisá y volvé a intentar.`,
        )
      }

      if (linksApplied + rejectsApplied > 0) {
        await onApplied()
      }
      if (linksApplied + rejectsApplied > 0 || failedTotal > 0) {
        await loadPage(page)
      }
    } finally {
      setApplyBusy(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  const metaSuffix =
    total > 0 ?
      <>
        {' '}
        · {total.toLocaleString('es-CL')} fila(s) en revisión humana{' '}
        <span className="font-mono">USER_REVIEW</span>
        {pendingTotal > 0 ?
          <>
            {' '}
            · cola: {pendingLinkCount.toLocaleString('es-CL')} vínculo(s),{' '}
            {pendingRejectCount.toLocaleString('es-CL')} nuevo(s)
          </>
        : null}
      </>
    : null

  const anyRowStillLoadingCandidates =
    rows.length > 0 &&
    rows.some((row) => candBusyByRow[row.id] === true && candidatesCache[row.id] === undefined)

  const uiLocked = gridBusy || applyBusy || phase === 'bulk'

  const pagingTrailing =
    anyRowStillLoadingCandidates ?
      <span className="flex items-center gap-1.5 text-amber-800 dark:text-amber-200">
        <Loader2 className="size-3.5 animate-spin shrink-0" aria-hidden />
        Cargando candidatos nuevos de esta página…
      </span>
    : null

  const sharedHeader = (
    <DialogHeader className="shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-violet-600 shadow-md shadow-primary/20">
          <ClipboardCheck className="h-4.5 w-4.5 text-white" />
        </div>
        <div>
          <DialogTitle className="text-base font-bold tracking-tight">
            Revisión de similitud
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {phase === 'bulk' ? 'Pasada automática en curso. Pods saltarte a revisión manual cuando quieras.'
            : phase === 'empty' ? 'Clasificación completada sin filas pendientes.'
            : 'Grilla de filas en revisión humana. Homologá candidatos, elegí otro maestro o marcá producto nuevo.'}
          </DialogDescription>
        </div>
      </div>
    </DialogHeader>
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && phase === 'bulk') return
        onOpenChange(next)
      }}
    >
      <DialogContent
        showCloseButton={phase !== 'bulk'}
        className="flex max-h-[min(92vh,960px)] min-h-0 w-[min(98vw,1440px)] max-w-[min(98vw,1440px)] flex-col gap-4 overflow-hidden p-6 sm:max-w-[min(98vw,1440px)]"
      >
        {sharedHeader}

        {homologacionBloqueada ?
          <div className="flex flex-1 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/5 px-6 py-8">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              No se puede revisar mientras haya scrapping en curso o barrido activo en esta vista.
            </p>
          </div>
        : phase === 'bulk' ?
          <ScrappingSimilarityBulkProgress
            progress={bulkProgress}
            bulkSessionStartedAtMs={bulkSessionStartedAtMs}
            prepSummary={prepSummary}
            prepSummaryLoading={prepSummaryLoading}
          />
        : phase === 'empty' ?
          <div className="flex flex-1 flex-col items-center justify-center gap-6 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-6 py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg shadow-emerald-500/25">
              <Trophy className="h-8 w-8 text-white" />
            </div>
            <div>
              <p className="text-xl font-bold tracking-tight text-foreground">¡Todo clasificado!</p>
              <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
                La pasada automática resolvió todo el universo pendiente.
                {bulkProgress.autoLinked + bulkProgress.autoPendingNew > 0 ?
                  ` Se procesaron ${(bulkProgress.autoLinked + bulkProgress.autoPendingNew + bulkProgress.leftForReview).toLocaleString('es-CL')} fila(s) en total.`
                : null}
              </p>
            </div>
            {bulkError ?
              <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2 text-xs text-amber-800 dark:text-amber-200">{bulkError}</p>
            : null}
          </div>
        : (
          <SimilarityReviewGrid
            page={page}
            pageSize={pageSize}
            totalPages={totalPages}
            rows={rows}
            gridBusy={gridBusy}
            uiLocked={uiLocked}
            metaSuffix={metaSuffix}
            pagingTrailing={pagingTrailing}
            candidatesCache={candidatesCache}
            candBusyByRow={candBusyByRow}
            draftLinks={draftLinks}
            pendingRejects={pendingRejects}
            onPrev={() => void loadPage(page - 1)}
            onNext={() => void loadPage(page + 1)}
            onSelectMaster={onSelectMaster}
            onMarkPendingNew={onMarkPendingNew}
            onUndoPendingNew={onUndoPendingNew}
          />
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            className={`btn-close ${FOOTER_ACTION_BTN}`}
            disabled={applyBusy || phase === 'bulk'}
            onClick={() => onOpenChange(false)}
          >
            Cerrar
          </Button>
          {!homologacionBloqueada && phase === 'bulk' ?
            <Button
              type="button"
              className={`btn-skip gap-2 ${FOOTER_ACTION_BTN}`}
              onClick={() => void skipBulkToReview()}
            >
              <SkipForward className="h-4 w-4" />
              Ir a revisión manual
            </Button>
          : !homologacionBloqueada && phase === 'review' ?
            <Button
              type="button"
              className={`btn-violet gap-2 ${FOOTER_ACTION_BTN}`}
              disabled={uiLocked || pendingTotal === 0}
              onClick={() => void onApplyAllPending()}
            >
              {applyBusy ?
                <Loader2 className="size-4 animate-spin" aria-hidden />
              : null}
              Aplicar cola ({pendingTotal.toLocaleString('es-CL')})
            </Button>
          : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type ReviewGridProps = {
  page: number
  pageSize: number
  totalPages: number
  rows: ScrappingProductRow[]
  gridBusy: boolean
  uiLocked: boolean
  metaSuffix: React.ReactNode
  pagingTrailing: React.ReactNode
  candidatesCache: Record<string, ScrappingSimilarityManualCandidate[]>
  candBusyByRow: Record<string, boolean>
  draftLinks: Record<string, string>
  pendingRejects: Record<string, true>
  onPrev: () => void
  onNext: () => void
  onSelectMaster: (rowId: string, catalogProductId: string) => void
  onMarkPendingNew: (rowId: string) => void
  onUndoPendingNew: (rowId: string) => void
}

function SimilarityReviewGrid(props: ReviewGridProps) {
  const {
    page,
    pageSize,
    totalPages,
    rows,
    gridBusy,
    uiLocked,
    metaSuffix,
    pagingTrailing,
    candidatesCache,
    candBusyByRow,
    draftLinks,
    pendingRejects,
    onPrev,
    onNext,
    onSelectMaster,
    onMarkPendingNew,
    onUndoPendingNew,
  } = props

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <GridPagingRow
        pageIndex={page}
        pageSize={pageSize}
        disablePrev={uiLocked || page <= 0}
        disableNext={uiLocked || page + 1 >= totalPages}
        onPrev={onPrev}
        onNext={onNext}
        metaSuffix={metaSuffix}
        className="mb-0 flex shrink-0 flex-wrap items-center gap-3 text-[13px] text-muted-foreground"
        trailing={pagingTrailing}
      />

      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto rounded-md border border-border">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
              <th className="px-2 py-2">Producto (scrapping)</th>
              <th className="px-2 py-2">Marca</th>
              <th className="px-2 py-2 tabular-nums">Precio</th>
              <th className="px-2 py-2 tabular-nums">Score base</th>
              <th className="px-2 py-2 tabular-nums">GAP</th>
              <th className="px-2 py-2 tabular-nums">Score IA</th>
              <th className="px-2 py-2">Estado</th>
              <th className="min-w-[240px] px-2 py-2">Maestro sugerido</th>
              <th className="w-[140px] px-2 py-2">Cola</th>
            </tr>
          </thead>
          <tbody>
            {gridBusy ?
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                  <Loader2 className="mx-auto mb-2 size-6 animate-spin" aria-hidden />
                  Cargando listado…
                </td>
              </tr>
            : rows.length === 0 ?
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                  No hay filas en revisión humana (<span className="font-mono">USER_REVIEW</span>) en esta página.
                </td>
              </tr>
            : (
              rows.map((row) => {
                const price = typeof row.price === 'string' ? Number(row.price) : Number(row.price)
                const priceTxt = Number.isFinite(price) ? `$${Math.round(price).toLocaleString('es-CL')}` : '—'
                const cand = candidatesCache[row.id]
                const candBusy = candBusyByRow[row.id] === true
                const candLoading = candBusy && cand === undefined
                const isReject = pendingRejects[row.id] === true
                const draftSel = draftLinks[row.id]
                const effectiveSel = isReject ? undefined : (draftSel ?? cand?.[0]?.catalogProductId)
                const hasCand = cand !== undefined && cand.length > 0
                const noCandLoaded = cand !== undefined && cand.length === 0
                const inLinkQueue = !isReject && draftSel != null && hasCand
                const hint = row.similarity_ia_hint
                const showHintPanel =
                  (hint &&
                    (hint.base_best_score != null ||
                      Boolean(hint.base_best_catalog_product_id?.trim()) ||
                      Boolean(hint.ai_hint?.trim()) ||
                      hint.ai_score != null ||
                      hint.same_product != null ||
                      Boolean(hint.reason?.trim()))) ||
                  row.base_score != null ||
                  row.ai_score != null
                const blockedAutolink =
                  hint?.ia_rejected_pair === true && hint?.ia_context === 'autolink_validation'

                return (
                  <tr
                    key={row.id}
                    className={
                      isReject ?
                        'border-b border-border bg-amber-500/5 last:border-b-0'
                      : inLinkQueue ?
                        'border-b border-border bg-emerald-500/5 last:border-b-0'
                      : 'border-b border-border last:border-b-0'
                    }
                  >
                    <td className="max-w-[min(28vw,380px)] px-2 py-2 align-top text-foreground">
                      <span className="line-clamp-4">{row.product_name}</span>
                      {showHintPanel ?
                        <div className="mt-1.5 space-y-1 rounded border border-sky-500/30 bg-sky-500/10 px-2 py-1.5 text-[11px] leading-snug text-sky-900 dark:text-sky-100">
                          {(row.base_score != null || row.base_gap != null || row.base_decision) ?
                            <p className="tabular-nums">
                              <span className="font-semibold">Motor DB (columnas): </span>
                              score {formatSimilarityScore(
                                row.base_score != null ? Number(row.base_score) : null,
                              )}
                              {' · '}
                              GAP {formatSimilarityScore(row.base_gap != null ? Number(row.base_gap) : null)}
                              {row.base_decision ?
                                <>
                                  {' · '}
                                  {row.base_decision}
                                </>
                              : null}
                            </p>
                          : null}
                          {(row.ai_score != null || row.ai_decision) ?
                            <p className="tabular-nums">
                              <span className="font-semibold">IA (columnas): </span>
                              score {formatSimilarityScore(
                                row.ai_score != null ? Number(row.ai_score) : null,
                              )}
                              {row.ai_decision ?
                                <>
                                  {' · '}
                                  {row.ai_decision}
                                </>
                              : null}
                            </p>
                          : null}
                          {hint ?
                            <>
                              {(hint.base_best_score != null ||
                                hint.base_second_score != null ||
                                hint.base_gap != null ||
                                hint.base_best_catalog_product_id) ?
                                <p className="tabular-nums">
                                  <span className="font-semibold">Coincidencia: </span>
                                  mejor {formatSimilarityScore(hint.base_best_score)}
                                  {' · '}
                                  2.º {formatSimilarityScore(hint.base_second_score)}
                                  {' · '}
                                  diferencia {formatSimilarityScore(hint.base_gap)}
                                </p>
                              : null}
                              {(hint.ai_score != null || hint.same_product != null || hint.reason?.trim()) ?
                                <p className="tabular-nums">
                                  <span className="font-semibold">Evaluación IA: </span>
                                  confianza {formatSimilarityScore(hint.ai_score)}
                                  {' · '}
                                  mismo producto {sameProductLabel(hint.same_product)}
                                  {hint.reason?.trim() ?
                                    <>
                                      {' · '}
                                      <span className="text-foreground/90">{hint.reason.trim()}</span>
                                    </>
                                  : null}
                                </p>
                              : null}
                              {blockedAutolink ?
                                <p className="font-medium text-amber-900 dark:text-amber-200">
                                  La coincidencia automática fue bloqueada por la IA para tu revisión.
                                </p>
                              : null}
                              {hint.ai_hint?.trim() ?
                                <p>
                                  <span className="font-semibold">Nota IA: </span>
                                  {hint.ai_hint.trim()}
                                </p>
                              : null}
                            </>
                          : null}
                        </div>
                      : null}
                    </td>
                    <td className="px-2 py-2 align-top text-muted-foreground">{row.brand?.trim() || '—'}</td>
                    <td className="px-2 py-2 align-top tabular-nums text-foreground">{priceTxt}</td>
                    <td className="px-2 py-2 align-top tabular-nums text-xs text-muted-foreground">
                      {formatSimilarityScore(
                        row.base_score != null && row.base_score !== '' ?
                          Number(row.base_score)
                        : null,
                      )}
                    </td>
                    <td className="px-2 py-2 align-top tabular-nums text-xs text-muted-foreground">
                      {formatSimilarityScore(
                        row.base_gap != null && row.base_gap !== '' ? Number(row.base_gap) : null,
                      )}
                    </td>
                    <td className="px-2 py-2 align-top tabular-nums text-xs text-muted-foreground">
                      {formatSimilarityScore(
                        row.ai_score != null && row.ai_score !== '' ? Number(row.ai_score) : null,
                      )}
                    </td>
                    <td className="max-w-[140px] px-2 py-2 align-top text-[11px] leading-tight text-muted-foreground">
                      <span className="font-mono text-[10px] text-foreground/90">
                        {row.homolog_final_status?.trim() || '—'}
                      </span>
                    </td>
                    <td className="px-2 py-2 align-top">
                      {candLoading ?
                        <p className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
                          Cargando candidatos…
                        </p>
                      : isReject ?
                        <span className="text-xs text-muted-foreground">— (producto nuevo)</span>
                      : cand === undefined ?
                        <span className="text-xs text-muted-foreground">—</span>
                      : (
                        <Select
                          value={hasCand && effectiveSel ? effectiveSel : undefined}
                          onValueChange={(v) => onSelectMaster(row.id, v)}
                          disabled={uiLocked}
                        >
                          <SelectTrigger
                            size="sm"
                            className="h-9 w-full min-w-[240px] max-w-[520px] justify-between"
                            aria-label="Elegir maestro del catálogo"
                          >
                            <SelectValue
                              placeholder={
                                noCandLoaded ? 'Sin candidatos en rango' : 'Elegir maestro del catálogo'
                              }
                            />
                          </SelectTrigger>
                          <SelectContent position="popper" className="max-w-[min(90vw,560px)]">
                            {cand.length === 0 ?
                              <SelectItem value="__empty__" disabled>
                                Sin candidatos (marca + nombre + ±3000 CLP)
                              </SelectItem>
                            : (
                              cand.map((c) => (
                                <SelectItem key={c.catalogProductId} value={c.catalogProductId}>
                                  <span className="line-clamp-2">{c.label}</span>
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className="px-2 py-2 align-top">
                      {isReject ?
                        <div className="flex flex-col gap-2">
                          <span className="text-xs font-medium text-amber-800 dark:text-amber-200">Nuevo</span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-9 min-w-[120px]"
                            disabled={uiLocked}
                            onClick={() => onUndoPendingNew(row.id)}
                          >
                            Deshacer
                          </Button>
                        </div>
                      : inLinkQueue ?
                        <div className="flex flex-col gap-2">
                          <span className="text-xs font-medium text-emerald-800 dark:text-emerald-200">Vincular</span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-9 min-w-[120px]"
                            disabled={uiLocked || candLoading}
                            onClick={() => onMarkPendingNew(row.id)}
                          >
                            Producto nuevo
                          </Button>
                        </div>
                      : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-9 min-w-[120px]"
                          disabled={uiLocked || candLoading || !hasCand}
                          onClick={() => onMarkPendingNew(row.id)}
                        >
                          Producto nuevo
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <GridPagingRow
        pageIndex={page}
        pageSize={pageSize}
        disablePrev={uiLocked || page <= 0}
        disableNext={uiLocked || page + 1 >= totalPages}
        onPrev={onPrev}
        onNext={onNext}
        metaSuffix={metaSuffix}
        className="mt-0 flex shrink-0 flex-wrap items-center gap-3 text-[13px] text-muted-foreground"
        trailing={pagingTrailing}
      />
    </div>
  )
}
