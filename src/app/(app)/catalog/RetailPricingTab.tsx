'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ChevronRight,
  CloudDownload,
  History,
  Link2,
  Link2Off,
  Loader2,
  Play,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { CatalogTabHeader, CatalogSearchBox, SectionSearchCombo } from '@/app/(app)/catalog/catalog-ui'
import {
  fetchRetailBatchSummaryAction,
  fetchRetailListingsPage,
  fetchRetailMatchCandidatesAction,
  fetchRetailPriceHistory,
  fetchRetailReviewQueueAction,
  importRetailSnapshotsFromJsonAction,
  linkRetailListingAction,
  autoAssociateUnlinkedRetailAction,
  bulkExactTitleRetailLinksAction,
  processRetailCaptureBatchPageAction,
  recaptureHomologatedLinkedAction,
  runRetailCatalogSweepAction,
  runRetailHomologationAction,
  runRetailWebCaptureAction,
  startRetailCaptureBatchAction,
  unlinkRetailListingAction,
  type CaptureRetailer,
  type RetailCatalogSweepOkResult,
  type RetailListingRow,
  type RetailMatchCandidate,
  type RetailHistoryRow,
  type RetailReviewQueueRow,
  type RetailCaptureBatchRow,
} from '@/app/actions/catalog-retail'
import { searchCatalogProductsForPickerAction } from '@/app/actions/catalog'
import { GridRowIconButton } from '@/components/grid/grid-row-icon-button'
import { GridPagingRow } from '@/components/grid/grid-paging-row'
import { CATALOG_GRID_PAGE_SIZE } from '@/lib/catalog-grid'
import { normalizeSearchText } from '@/lib/search'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
type SectionOpt = { id: string; name: string; sort_order: number }
type CategoryOpt = {
  id: string
  name: string
  section_id: string
  sort_order: number
}

function retailerLabel(code: string): string {
  const m: Record<string, string> = {
    lider: 'Lider',
    jumbo: 'Jumbo',
    central_mayorista: 'Central Mayorista',
  }
  return m[code] ?? code
}

function captureJsonBasePlaceholder(retailer: CaptureRetailer): string {
  switch (retailer) {
    case 'jumbo':
      return 'https://www.jumbo.cl'
    case 'lider':
      return 'https://super.lider.cl'
    case 'central_mayorista':
      return 'URL pública del sitio'
    default:
      return 'https://www.jumbo.cl'
  }
}

function formatRetailImportToast(
  base: string,
  res: {
    exactTitleLinked?: number
    exactTitleSkippedAmbiguousCatalog?: number
    exactTitleSkippedNoCatalogProduct?: number
    exactTitleSkippedHeuristic?: number
    autoLinked: number
    autoLinkedByAi?: number
    autoAssociateCapped: boolean
    autoAssociateAttempted?: number
    autoAssociateFailed?: number
    autoAssociateSkippedNoMatch?: number
    autoAssociateDisabled?: boolean
  },
): string {
  let msg = base
  const exL = res.exactTitleLinked ?? 0
  const exAmb = res.exactTitleSkippedAmbiguousCatalog ?? 0
  const exNo = res.exactTitleSkippedNoCatalogProduct ?? 0
  const exHeu = res.exactTitleSkippedHeuristic ?? 0
  if (exL > 0 || exAmb > 0 || exNo > 0 || exHeu > 0) {
    msg += ` Mismo nombre en catálogo: ${exL} vínculos nuevos.`
    const detail: string[] = []
    if (exAmb > 0) detail.push(`${exAmb} nombre repetido en maestros`)
    if (exHeu > 0) detail.push(`${exHeu} pendientes por marca u otras reglas`)
    if (exNo > 0) detail.push(`${exNo} sin maestro con ese nombre`)
    if (detail.length > 0) msg += ` (${detail.join('; ')}).`
  }
  if (res.autoAssociateDisabled) {
    msg +=
      ' Paso automático de similitud desactivado en el servidor. Usa «Asociar automático» después si lo habilitas.'
    return msg
  }
  const attempted = res.autoAssociateAttempted ?? 0
  if (attempted === 0) return msg
  const aiN = res.autoLinkedByAi ?? 0
  const heuristicN = Math.max(0, res.autoLinked - aiN)
  msg += ` Enlaces automáticos: ${res.autoLinked} (${heuristicN} por reglas${aiN > 0 ? `, ${aiN} por IA` : ''}), hasta ${attempted} ítems sin vínculo revisados.`
  const skipped = res.autoAssociateSkippedNoMatch ?? 0
  const failed = res.autoAssociateFailed ?? 0
  if (skipped > 0) msg += ` ${skipped} sin coincidencia clara.`
  if (failed > 0) msg += ` ${failed} con error.`
  if (res.autoAssociateCapped) {
    msg += ' Se cortó el lote por rendimiento; puedes repetir «Asociar automático».'
  }
  return msg
}

const TOOLBAR_BTN = 'h-9 min-w-[200px] shrink-0'

function batchStatusLabel(s: string): string {
  switch (s) {
    case 'running':
      return 'En ejecución'
    case 'completed':
      return 'Completado'
    case 'cancelled':
      return 'Cancelado'
    default:
      return s
  }
}

function reviewRowAsListing(r: RetailReviewQueueRow): RetailListingRow {
  return {
    snapshot_id: r.id,
    retailer: r.retailer,
    external_ref: r.external_ref,
    source_url: null,
    title: r.title,
    price: Number(r.price ?? 0),
    category_hint: null,
    brand_hint: null,
    description_hint: null,
    captured_at: r.created_at,
    catalog_product_id: null,
    linked_product_name: null,
    total_count: 0,
  }
}

export function RetailPricingTab(props: { sections: SectionOpt[]; categories: CategoryOpt[] }) {
  const { sections, categories } = props

  const [retailerFilter, setRetailerFilter] = useState<string>('lider')
  const [unlinkedOnly, setUnlinkedOnly] = useState(false)
  const [searchDraft, setSearchDraft] = useState('')
  const [searchCommitted, setSearchCommitted] = useState('')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<RetailListingRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(true)
  const [listLoadError, setListLoadError] = useState<string | null>(null)

  const [batch, setBatch] = useState<RetailCaptureBatchRow | null>(null)
  const [batchLoading, setBatchLoading] = useState(true)
  const [batchActionBusy, setBatchActionBusy] = useState(false)
  const [reviewRows, setReviewRows] = useState<RetailReviewQueueRow[]>([])
  const [reviewLoading, setReviewLoading] = useState(false)

  const reloadList = useCallback(async () => {
    setLoading(true)
    const res = await fetchRetailListingsPage({
      retailer: retailerFilter,
      unlinkedOnly,
      search: searchCommitted,
      page,
    })
    setLoading(false)
    if (!res.ok) {
      setListLoadError(res.error)
      setRows([])
      setTotal(null)
      setHasNext(false)
      return
    }
    setListLoadError(null)
    setRows(res.rows)
    setTotal(res.total)
    setHasNext(res.hasNextPage)
  }, [page, retailerFilter, searchCommitted, unlinkedOnly])

  const reloadBatch = useCallback(async () => {
    setBatchLoading(true)
    const res = await fetchRetailBatchSummaryAction()
    setBatchLoading(false)
    if (!res.ok) {
      setBatch(null)
      return
    }
    setBatch(res.batch)
  }, [])

  const reloadReview = useCallback(async () => {
    setReviewLoading(true)
    const res = await fetchRetailReviewQueueAction({ limit: 40 })
    setReviewLoading(false)
    if (!res.ok) {
      setReviewRows([])
      return
    }
    setReviewRows(res.rows)
  }, [])

  useEffect(() => {
    void reloadList()
  }, [reloadList])

  useEffect(() => {
    void reloadBatch()
  }, [reloadBatch])

  useEffect(() => {
    setPage(0)
  }, [searchCommitted, retailerFilter, unlinkedOnly])

  const [recaptureBusy, setRecaptureBusy] = useState(false)
  const [autoAssocBusy, setAutoAssocBusy] = useState(false)
  const [exactBulkBusy, setExactBulkBusy] = useState(false)

  const [homologOpen, setHomologOpen] = useState(false)
  const [homologRow, setHomologRow] = useState<RetailListingRow | null>(null)
  const [sectionForMatch, setSectionForMatch] = useState<string>('all')
  const [categoryForMatchId, setCategoryForMatchId] = useState<string>('')
  const [candidates, setCandidates] = useState<RetailMatchCandidate[]>([])
  const [candidatesBusy, setCandidatesBusy] = useState(false)
  const [addAlias, setAddAlias] = useState(true)
  const [pickerQ, setPickerQ] = useState('')
  const [pickerOptions, setPickerOptions] = useState<{ id: string; name: string }[]>([])
  const [pickerBusy, setPickerBusy] = useState(false)

  const categoriesInSection = useMemo(() => {
    const sec = sectionForMatch === 'all' ? null : sectionForMatch
    const list = sec ? categories.filter((c) => c.section_id === sec) : categories
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
  }, [categories, sectionForMatch])

  useEffect(() => {
    async function loadCandidates() {
      if (!homologRow) {
        setCandidates([])
        return
      }
      setCandidatesBusy(true)
      const cat = categoryForMatchId && categoryForMatchId.length > 0 ? categoryForMatchId : null
      const res = await fetchRetailMatchCandidatesAction({
        title:
          homologRow.description_hint ?
            `${homologRow.title} ${homologRow.description_hint}`.trim()
          : homologRow.title,
        price: homologRow.price,
        categoryId: cat,
      })
      setCandidatesBusy(false)
      if (!res.ok) {
        toast.error(res.error)
        setCandidates([])
        return
      }
      setCandidates(res.rows)
    }
    void loadCandidates()
  }, [homologRow, categoryForMatchId])

  useEffect(() => {
    async function pick() {
      if (!homologOpen) return
      if (normalizeSearchText(pickerQ).length < 2) {
        setPickerOptions([])
        return
      }
      setPickerBusy(true)
      const res = await searchCatalogProductsForPickerAction(pickerQ, true)
      setPickerBusy(false)
      if (!res.ok || !Array.isArray(res.rows)) setPickerOptions([])
      else setPickerOptions(res.rows)
    }
    void pick()
  }, [homologOpen, pickerQ])

  function openHomolog(row: RetailListingRow) {
    setHomologRow(row)
    setSectionForMatch(sections[0]?.id ?? 'all')
    setCategoryForMatchId('')
    setPickerQ('')
    setPickerOptions([])
    setHomologOpen(true)
  }

  async function confirmLink(catalogProductId: string) {
    if (!homologRow) return
    const res = await linkRetailListingAction({
      retailer: homologRow.retailer,
      external_ref: homologRow.external_ref,
      catalog_product_id: catalogProductId,
      addTitleAlias: addAlias,
      listingTitle: homologRow.title,
    })
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Homologación guardada')
    setHomologOpen(false)
    setHomologRow(null)
    void reloadList()
    void reloadBatch()
    void reloadReview()
  }

  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyRow, setHistoryRow] = useState<RetailListingRow | null>(null)
  const [historyRows, setHistoryRows] = useState<RetailHistoryRow[]>([])
  const [historyBusy, setHistoryBusy] = useState(false)

  const [captureOpen, setCaptureOpen] = useState(false)
  const [captureRetailer, setCaptureRetailer] = useState<CaptureRetailer>('lider')
  const [captureQuery, setCaptureQuery] = useState('')
  const [captureMax, setCaptureMax] = useState(40)
  const [captureWebBusy, setCaptureWebBusy] = useState(false)
  const [jsonImportText, setJsonImportText] = useState('')
  const [jsonBaseUrl, setJsonBaseUrl] = useState('')
  const [jsonBusy, setJsonBusy] = useState(false)
  const [sweepBusy, setSweepBusy] = useState(false)
  const [storeForCapture, setStoreForCapture] = useState<CaptureRetailer>('lider')
  const [sweepMax, setSweepMax] = useState(600)
  const [captureEntireCatalog, setCaptureEntireCatalog] = useState(true)
  const [sweepSearchTerm, setSweepSearchTerm] = useState('')
  const [sweepSummaryOpen, setSweepSummaryOpen] = useState(false)
  const [lastSweepSummary, setLastSweepSummary] = useState<RetailCatalogSweepOkResult | null>(null)

  async function openHistory(row: RetailListingRow) {
    setHistoryRow(row)
    setHistoryOpen(true)
    setHistoryBusy(true)
    const res = await fetchRetailPriceHistory({
      retailer: row.retailer,
      external_ref: row.external_ref,
    })
    setHistoryBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      setHistoryRows([])
      return
    }
    setHistoryRows(res.rows)
  }

  async function confirmUnlink(row: RetailListingRow) {
    const res = await unlinkRetailListingAction({
      retailer: row.retailer,
      external_ref: row.external_ref,
    })
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Vínculo quitado')
    void reloadList()
  }

  async function submitWebCapture() {
    const q = normalizeSearchText(captureQuery)
    if (q.length < 2) {
      toast.error('Escribe al menos 2 caracteres para buscar.')
      return
    }
    setCaptureWebBusy(true)
    const res = await runRetailWebCaptureAction({
      retailer: captureRetailer,
      searchQuery: captureQuery,
      maxItems: captureMax,
    })
    setCaptureWebBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(
      formatRetailImportToast(
        `Se guardaron ${res.inserted} productos capturados en el historial de precios.`,
        res,
      ),
    )
    setCaptureOpen(false)
    setCaptureQuery('')
    void reloadList()
    void reloadBatch()
  }

  async function submitJsonImport() {
    setJsonBusy(true)
    const res = await importRetailSnapshotsFromJsonAction({
      retailer: captureRetailer,
      jsonText: jsonImportText,
      vtexBaseUrlOverride: jsonBaseUrl.trim() || null,
    })
    setJsonBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(
      formatRetailImportToast(
        `Se guardaron ${res.inserted} productos capturados en el historial de precios.`,
        res,
      ),
    )
    setCaptureOpen(false)
    setJsonImportText('')
    void reloadList()
    void reloadBatch()
  }

  async function submitRecaptureHomologated() {
    if (retailerFilter === 'all') {
      toast.error('Elige una cadena en el filtro (no «Todas») para actualizar precios homologados.')
      return
    }
    setRecaptureBusy(true)
    const res = await recaptureHomologatedLinkedAction({
      retailer: retailerFilter as CaptureRetailer,
      limit: 30,
    })
    setRecaptureBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(
      `Recaptura: ${res.inserted} precios nuevos · procesados ${res.processedLinks} vínculos · sin título ${res.skippedNoTitle} · sin coincidencia ${res.skippedNoMatch} · fallo red/API ${res.skippedFetch}.`,
    )
    void reloadList()
  }

  async function submitAutoAssociate() {
    setAutoAssocBusy(true)
    const res = await autoAssociateUnlinkedRetailAction({
      retailerFilter: retailerFilter === 'all' ? 'all' : (retailerFilter as CaptureRetailer),
      maxRows: 32,
    })
    setAutoAssocBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(
      `Asociación inteligente: ${res.linked} nuevos vínculos${res.linkedByAi > 0 ? ` (${res.linkedByAi} vía OpenRouter)` : ''} · omitidos ${res.skippedNotLink} · errores ${res.failed} (procesadas ${res.processed} filas).`,
    )
    void reloadList()
    void reloadBatch()
  }

  async function submitBulkExactHomologation() {
    if (retailerFilter === 'all') {
      toast.error('Elige una cadena en el filtro (no «Todas») para homologar por nombre exacto.')
      return
    }
    setExactBulkBusy(true)
    const res = await bulkExactTitleRetailLinksAction({
      retailer: retailerFilter as CaptureRetailer,
    })
    setExactBulkBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(
      `Nombre exacto masivo: ${res.exactTitleLinked} vínculos · catálogo ambiguo ${res.exactTitleSkippedAmbiguousCatalog} · sin maestro ${res.exactTitleSkippedNoCatalogProduct} · reglas marca/texto ${res.exactTitleSkippedHeuristic}.`,
    )
    void reloadList()
    void reloadBatch()
  }

  async function submitCatalogSweep() {
    setSweepBusy(true)
    const res = await runRetailCatalogSweepAction({
      retailer: storeForCapture,
      captureAll: captureEntireCatalog,
      maxTotalItems: captureEntireCatalog ? undefined : sweepMax,
      sweepSearchTerm: sweepSearchTerm.trim() || undefined,
    })
    setSweepBusy(false)
    if (!res.ok) {
      toast.error(res.error, { duration: 8000 })
      return
    }
    setLastSweepSummary(res)
    setSweepSummaryOpen(true)
    toast.success(
      formatRetailImportToast(
        `Barrido listo: ${res.inserted} ítems nuevos en historial · ${res.pagesFetched} páginas.`,
        res,
      ),
      { duration: 9000 },
    )
    void reloadList()
    void reloadBatch()
  }

  async function onStartLiderBatch() {
    setBatchActionBusy(true)
    const res = await startRetailCaptureBatchAction({ retailer: 'lider' })
    setBatchActionBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(`Lote creado (${res.totalPages} páginas planificadas). Usa «Continuar batch» para avanzar.`)
    await reloadBatch()
  }

  async function onContinueBatch() {
    if (!batch?.id) {
      toast.error('No hay un lote reciente. Iniciá una captura primero.')
      return
    }
    if (batch.status === 'completed') {
      toast.message('Este lote ya está completado. Podés iniciar uno nuevo.')
      return
    }
    setBatchActionBusy(true)
    const res = await processRetailCaptureBatchPageAction({ batchId: batch.id })
    setBatchActionBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    if (res.error) {
      toast.error(res.error)
    } else if (res.productsThisPage > 0) {
      toast.success(`Página ${res.pageIndex + 1}: ${res.productsThisPage} productos guardados.`)
    } else {
      toast.message('Página sin productos nuevos (la tienda puede haber devuelto listado vacío).')
    }
    await reloadBatch()
    void reloadList()
  }

  async function onHomologatePending() {
    setBatchActionBusy(true)
    const res = await runRetailHomologationAction({ batchId: batch?.id ?? null, limit: 48 })
    setBatchActionBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(`Homologación: ${res.processed} filas procesadas.`)
    await reloadBatch()
    void reloadList()
    void reloadReview()
  }

  async function onRefreshView() {
    await reloadBatch()
    void reloadList()
    void reloadReview()
    toast.success('Vista actualizada.')
  }

  async function onReviewRisks() {
    await reloadReview()
    const el = document.getElementById('retail-review-queue')
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const pagingMeta =
    total !== null ? (
      <>
        {' '}
        · Total filtrado: {total}
      </>
    ) : null

  return (
    <div className="space-y-4">
      <CatalogTabHeader
        title="Capturas retail"
        description="Flujo principal para Lider: lotes paginados en servidor, staging, homologación y precios en el catálogo maestro."
      />

      {listLoadError ?
        <div
          role="alert"
          className="flex gap-2 rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{listLoadError}</span>
        </div>
      : null}

      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold text-foreground">Lider — lote de captura</p>
            <p className="mt-1 max-w-2xl text-[12px] leading-snug text-muted-foreground">
              Cada paso descarga una sola página pública (acotado para Vercel), guarda staging, inserta historial de
              precios y luego podés homologar pendientes con reglas e IA solo en casos ambiguos.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-md border border-border bg-muted/25 px-3 py-2 text-[12px]">
            <p className="text-muted-foreground">Último batch</p>
            <p className="mt-0.5 font-mono text-[11px] text-foreground">
              {batchLoading ? '…' : batch?.id ?? '—'}
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/25 px-3 py-2 text-[12px]">
            <p className="text-muted-foreground">Estado</p>
            <p className="mt-0.5 font-medium text-foreground">
              {batchLoading ? '…' : batch ? batchStatusLabel(batch.status) : 'Sin lotes'}
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/25 px-3 py-2 text-[12px]">
            <p className="text-muted-foreground">Progreso página</p>
            <p className="mt-0.5 text-foreground">
              {batchLoading || !batch ?
                '—'
              : `${batch.current_page} / ${batch.total_pages ?? '—'}`}
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/25 px-3 py-2 text-[12px]">
            <p className="text-muted-foreground">Productos capturados (lote)</p>
            <p className="mt-0.5 font-medium tabular-nums">{batch?.total_inserted ?? 0}</p>
          </div>
          <div className="rounded-md border border-border bg-muted/25 px-3 py-2 text-[12px]">
            <p className="text-muted-foreground">Homologados por URL</p>
            <p className="mt-0.5 font-medium tabular-nums">{batch?.url_linked ?? 0}</p>
          </div>
          <div className="rounded-md border border-border bg-muted/25 px-3 py-2 text-[12px]">
            <p className="text-muted-foreground">Homologados exactos</p>
            <p className="mt-0.5 font-medium tabular-nums">{batch?.exact_linked ?? 0}</p>
          </div>
          <div className="rounded-md border border-border bg-muted/25 px-3 py-2 text-[12px]">
            <p className="text-muted-foreground">Homologados por reglas</p>
            <p className="mt-0.5 font-medium tabular-nums">{batch?.rule_linked ?? 0}</p>
          </div>
          <div className="rounded-md border border-border bg-muted/25 px-3 py-2 text-[12px]">
            <p className="text-muted-foreground">Homologados por IA</p>
            <p className="mt-0.5 font-medium tabular-nums">{batch?.ai_linked ?? 0}</p>
          </div>
          <div className="rounded-md border border-border bg-muted/25 px-3 py-2 text-[12px]">
            <p className="text-muted-foreground">Nuevos maestros</p>
            <p className="mt-0.5 font-medium tabular-nums">{batch?.new_master_created ?? 0}</p>
          </div>
          <div className="rounded-md border border-border bg-muted/25 px-3 py-2 text-[12px]">
            <p className="text-muted-foreground">Pendientes de revisión</p>
            <p className="mt-0.5 font-medium tabular-nums">{batch?.review_required ?? 0}</p>
          </div>
          <div className="rounded-md border border-border bg-muted/25 px-3 py-2 text-[12px]">
            <p className="text-muted-foreground">Riesgo duplicado</p>
            <p className="mt-0.5 font-medium tabular-nums">{batch?.duplicate_risk ?? 0}</p>
          </div>
        </div>

        {batch?.error_message ?
          <div
            role="status"
            className="mt-3 flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-foreground"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            <span>{batch.error_message}</span>
          </div>
        : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            className={TOOLBAR_BTN}
            disabled={batchActionBusy}
            onClick={() => void onStartLiderBatch()}
          >
            {batchActionBusy ?
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            : <Play className="h-4 w-4" aria-hidden />}
            Iniciar captura Lider
          </Button>
          <Button
            type="button"
            variant="secondary"
            className={TOOLBAR_BTN}
            disabled={batchActionBusy}
            onClick={() => void onContinueBatch()}
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
            Continuar batch
          </Button>
          <Button
            type="button"
            variant="secondary"
            className={TOOLBAR_BTN}
            disabled={batchActionBusy}
            onClick={() => void onHomologatePending()}
          >
            <Link2 className="h-4 w-4" aria-hidden />
            Homologar pendientes
          </Button>
          <Button
            type="button"
            variant="outline"
            className={TOOLBAR_BTN}
            disabled={batchActionBusy}
            onClick={() => void onReviewRisks()}
          >
            <ShieldAlert className="h-4 w-4" aria-hidden />
            Revisar riesgos
          </Button>
          <Button
            type="button"
            variant="outline"
            className={TOOLBAR_BTN}
            disabled={batchActionBusy}
            onClick={() => void onRefreshView()}
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Actualizar vista
          </Button>
        </div>
      </div>

      <div id="retail-review-queue" className="rounded-lg border border-border bg-muted/15 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-medium text-foreground">Cola de revisión (Lider)</p>
          {reviewLoading ?
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
          : null}
        </div>
        {reviewRows.length === 0 ?
          <p className="mt-2 text-[12px] text-muted-foreground">No hay ítems en revisión o riesgo duplicado.</p>
        : <div className="relative mt-2 overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  <th className="p-2 font-medium">Estado</th>
                  <th className="p-2 font-medium">Ítem</th>
                  <th className="p-2 font-medium">Precio</th>
                  <th className="p-2 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {reviewRows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="p-2 text-[12px]">{r.status}</td>
                    <td className="max-w-[280px] p-2 text-[13px] leading-snug">{r.title}</td>
                    <td className="p-2 tabular-nums">${Number(r.price ?? 0).toFixed(0)}</td>
                    <td className="p-2">
                      <div className="flex justify-end">
                        <GridRowIconButton
                          label="Homologar manualmente"
                          onClick={() => openHomolog(reviewRowAsListing(r))}
                        >
                          <Link2 />
                        </GridRowIconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        }
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[160px] space-y-1.5">
            <Label className="text-[12px]">Ver capturas</Label>
            <Select value={retailerFilter} onValueChange={setRetailerFilter}>
              <SelectTrigger className="app-input h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las cadenas</SelectItem>
                <SelectItem value="lider">Lider</SelectItem>
                <SelectItem value="jumbo">Jumbo</SelectItem>
                <SelectItem value="central_mayorista">Central Mayorista</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex cursor-pointer items-center gap-2 pb-2 text-[13px]">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={unlinkedOnly}
              onChange={(e) => setUnlinkedOnly(e.target.checked)}
            />
            Solo sin homologar
          </label>
          <div className="flex min-w-[min(100%,360px)] flex-[2] flex-col gap-1.5">
            <Label className="text-[12px]">Buscar en listado</Label>
            <CatalogSearchBox
              value={searchDraft}
              onChange={setSearchDraft}
              onSubmit={() => {
                setSearchCommitted(normalizeSearchText(searchDraft))
              }}
              placeholder="Nombre, referencia o rubro…"
              ariaLabel="Buscar en listado retail"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className={TOOLBAR_BTN}
            disabled={recaptureBusy || retailerFilter === 'all'}
            onClick={() => void submitRecaptureHomologated()}
          >
            {recaptureBusy ?
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            : <RefreshCw className="h-4 w-4" aria-hidden />}
            Actualizar homologados
          </Button>
          <Button
            type="button"
            variant="outline"
            className={TOOLBAR_BTN}
            disabled={exactBulkBusy || autoAssocBusy || retailerFilter === 'all'}
            onClick={() => void submitBulkExactHomologation()}
          >
            {exactBulkBusy ?
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            : <Link2 className="h-4 w-4" aria-hidden />}
            Homologar nombre exacto
          </Button>
          <Button
            type="button"
            variant="outline"
            className={TOOLBAR_BTN}
            disabled={autoAssocBusy || exactBulkBusy}
            onClick={() => void submitAutoAssociate()}
          >
            {autoAssocBusy ?
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            : <Link2 className="h-4 w-4" aria-hidden />}
            Asociar automático
          </Button>
        </div>
      </div>

      <GridPagingRow
        disablePrev={page <= 0 || loading}
        disableNext={!hasNext || loading}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => p + 1)}
        pageIndex={page}
        pageSize={CATALOG_GRID_PAGE_SIZE}
        metaSuffix={pagingMeta}
      />

      <div className="relative overflow-x-auto rounded-lg border border-border bg-card">
        {loading ?
          <p className="border-b border-border bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
            Cargando…
          </p>
        : null}
        <table className="w-full min-w-[920px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left">
              <th className="p-3 font-medium">Cadena</th>
              <th className="p-3 font-medium">Ítem</th>
              <th className="p-3 font-medium">Precio</th>
              <th className="p-3 font-medium">Rubro (origen)</th>
              <th className="p-3 font-medium">Homologado a</th>
              <th className="p-3 font-medium">Captura</th>
              <th className="p-3 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 ?
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                  No hay capturas retail con estos filtros. Iniciá un lote Lider o revisá permisos.
                </td>
              </tr>
            : rows.map((row) => (
                <tr key={`${row.retailer}:${row.external_ref}`} className="border-b border-border last:border-0">
                  <td className="p-3 text-[13px] font-medium">{retailerLabel(row.retailer)}</td>
                  <td className="max-w-[280px] p-3 text-[13px] leading-snug">
                    <div>{row.title}</div>
                    {row.description_hint ?
                      <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                        {row.description_hint}
                      </div>
                    : null}
                  </td>
                  <td className="p-3 tabular-nums text-[13px]">${Number(row.price).toFixed(0)}</td>
                  <td className="max-w-[200px] p-3 text-[12px] text-muted-foreground">
                    {row.category_hint ?? '—'}
                  </td>
                  <td className="max-w-[220px] p-3 text-[13px] text-muted-foreground">
                    {row.linked_product_name ?? (
                      <span className="text-amber-800 dark:text-amber-200">Sin homologar</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap p-3 text-[12px] text-muted-foreground">
                    {new Date(row.captured_at).toLocaleString('es-CL', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <GridRowIconButton
                        label="Historial de precios"
                        variant="outline"
                        onClick={() => void openHistory(row)}
                      >
                        <History />
                      </GridRowIconButton>
                      <GridRowIconButton label="Homologar a maestro" onClick={() => openHomolog(row)}>
                        <Link2 />
                      </GridRowIconButton>
                      {row.catalog_product_id ?
                        <GridRowIconButton
                          label="Quitar vínculo con maestro"
                          variant="ghost"
                          className="text-muted-foreground"
                          onClick={() => void confirmUnlink(row)}
                        >
                          <Link2Off />
                        </GridRowIconButton>
                      : null}
                    </div>
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      <GridPagingRow
        disablePrev={page <= 0 || loading}
        disableNext={!hasNext || loading}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => p + 1)}
        pageIndex={page}
        pageSize={CATALOG_GRID_PAGE_SIZE}
        metaSuffix={pagingMeta}
      />

      <details className="rounded-lg border border-dashed border-border/80 bg-card/60 p-4">
        <summary className="cursor-pointer text-[13px] font-medium text-foreground">
          Herramientas avanzadas (JSON, barrido legacy, búsqueda puntual)
        </summary>
        <div className="mt-4 space-y-6 text-[13px]">
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <p className="mb-2 text-[12px] font-medium">Barrido legacy por tienda (VTEX / HTML masivo)</p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[180px] space-y-1.5">
                <Label className="text-[12px]">Tienda</Label>
                <Select
                  value={storeForCapture}
                  onValueChange={(v) => setStoreForCapture(v as CaptureRetailer)}
                >
                  <SelectTrigger className="app-input h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="jumbo">Jumbo</SelectItem>
                    <SelectItem value="lider">Lider</SelectItem>
                    <SelectItem value="central_mayorista">Central Mayorista</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-[200px] max-w-[280px] flex-1 space-y-1.5">
                <Label className="text-[12px]">Término de barrido</Label>
                <Input
                  className="app-input h-9 font-mono text-[13px]"
                  placeholder="Vacío = valor por defecto del servidor"
                  value={sweepSearchTerm}
                  onChange={(e) => setSweepSearchTerm(e.target.value)}
                />
              </div>
              <label className="flex max-w-[220px] cursor-pointer items-start gap-2 pb-1 text-[13px] leading-snug">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-input"
                  checked={captureEntireCatalog}
                  onChange={(e) => setCaptureEntireCatalog(e.target.checked)}
                />
                <span>Barrido completo</span>
              </label>
              {!captureEntireCatalog ?
                <div className="min-w-[120px] space-y-1.5">
                  <Label className="text-[12px]">Máximo ítems</Label>
                  <Input
                    className="app-input h-9"
                    type="number"
                    min={50}
                    max={50000}
                    step={50}
                    value={sweepMax}
                    onChange={(e) =>
                      setSweepMax(Math.min(50_000, Math.max(50, Number(e.target.value) || 600)))
                    }
                  />
                </div>
              : null}
              <Button
                type="button"
                variant="outline"
                className="h-9 gap-2"
                disabled={sweepBusy}
                onClick={() => void submitCatalogSweep()}
              >
                {sweepBusy ?
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                : <CloudDownload className="h-4 w-4" aria-hidden />}
                Ejecutar barrido legacy
              </Button>
            </div>
          </div>

          <div className="rounded-md border border-border p-3">
            <p className="mb-2 text-[12px] font-medium">JSON o búsqueda puntual en tienda</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="h-9" onClick={() => setCaptureOpen(true)}>
                Abrir importación / búsqueda
              </Button>
            </div>
          </div>
        </div>
      </details>

      <Dialog open={homologOpen} onOpenChange={setHomologOpen}>
        <DialogContent className="max-h-[min(90vh,720px)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Homologar a catálogo maestro</DialogTitle>
            <DialogDescription>
              Elige el producto canónico que corresponde a este ítem de tienda. Puedes afinar sugerencias con
              sección/categoría del catálogo.
            </DialogDescription>
          </DialogHeader>

          {homologRow ?
            <div className="space-y-3 text-[13px]">
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <p className="font-medium text-foreground">{homologRow.title}</p>
                <p className="mt-1 text-muted-foreground">
                  {retailerLabel(homologRow.retailer)} · ${Number(homologRow.price).toFixed(0)}
                </p>
                {homologRow.category_hint ?
                  <p className="mt-1 text-[12px] text-muted-foreground">Origen: {homologRow.category_hint}</p>
                : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <SectionSearchCombo
                  label="Filtrar sugerencias — sección"
                  sections={sections}
                  value={sectionForMatch === '' || sectionForMatch === 'all' ? 'all' : sectionForMatch}
                  onChange={(v) => {
                    const next = v === 'all' ? 'all' : v
                    setSectionForMatch(next)
                    setCategoryForMatchId('')
                  }}
                />
                <div className="space-y-1.5">
                  <Label className="text-[12px]">Categoría (opcional)</Label>
                  <Select
                    value={categoryForMatchId || '__none__'}
                    onValueChange={(v) => setCategoryForMatchId(v === '__none__' ? '' : v)}
                  >
                    <SelectTrigger className="app-input h-9">
                      <SelectValue placeholder="Cualquiera" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="__none__">Cualquiera</SelectItem>
                      {categoriesInSection.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={addAlias}
                  onChange={(e) => setAddAlias(e.target.checked)}
                />
                Guardar el nombre del ítem como alias del maestro
              </label>

              <div>
                <p className="mb-2 text-[12px] font-medium text-muted-foreground">Sugerencias</p>
                {candidatesBusy ?
                  <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Calculando…
                  </p>
                : candidates.length === 0 ?
                  <p className="text-[12px] text-muted-foreground">Sin sugerencias con estos filtros.</p>
                : <ul className="max-h-44 space-y-1 overflow-auto rounded-md border border-border p-2">
                    {candidates.map((c) => (
                      <li key={c.catalog_product_id}>
                        <button
                          type="button"
                          className="flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-muted"
                          onClick={() => void confirmLink(c.catalog_product_id)}
                        >
                          <span className="font-medium">{c.product_name}</span>
                          <span className="text-[11px] text-muted-foreground">
                            Puntaje {Number(c.match_score).toFixed(2)} · Precio ref.{' '}
                            {c.default_reference_price != null ?
                              `$${Number(c.default_reference_price).toFixed(0)}`
                            : '—'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                }
              </div>

              <div className="space-y-2 border-t border-border pt-3">
                <Label className="text-[12px]">Buscar maestro manualmente (≥2 caracteres)</Label>
                <Input
                  className="app-input"
                  placeholder="Nombre en catálogo…"
                  value={pickerQ}
                  onChange={(e) => setPickerQ(e.target.value)}
                />
                {normalizeSearchText(pickerQ).length > 0 && normalizeSearchText(pickerQ).length < 2 ?
                  <p className="text-[12px] text-muted-foreground">Escribe al menos 2 caracteres para buscar.</p>
                : null}
                {pickerBusy ?
                  <p className="text-[12px] text-muted-foreground">Buscando…</p>
                : null}
                <ul className="max-h-36 overflow-auto rounded-md border border-border text-[13px]">
                  {pickerOptions.map((o) => (
                    <li key={o.id} className="border-b border-border last:border-0">
                      <button
                        type="button"
                        className="w-full px-2 py-1.5 text-left hover:bg-muted"
                        onClick={() => void confirmLink(o.id)}
                      >
                        {o.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setHomologOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Historial de capturas</DialogTitle>
            <DialogDescription>
              {historyRow ?
                <>
                  {retailerLabel(historyRow.retailer)} — {historyRow.title}
                </>
              : null}
            </DialogDescription>
          </DialogHeader>
          {historyBusy ?
            <p className="text-[13px] text-muted-foreground">Cargando…</p>
          : <div className="max-h-64 overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left">
                    <th className="p-2 font-medium">Fecha</th>
                    <th className="p-2 font-medium">Precio</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.length === 0 ?
                    <tr>
                      <td colSpan={2} className="p-4 text-muted-foreground">
                        Sin datos.
                      </td>
                    </tr>
                  : historyRows.map((h, i) => (
                      <tr key={`${h.captured_at}-${i}`} className="border-b border-border last:border-0">
                        <td className="whitespace-nowrap p-2 text-[12px] text-muted-foreground">
                          {new Date(h.captured_at).toLocaleString('es-CL', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </td>
                        <td className="p-2 tabular-nums">${Number(h.price).toFixed(0)}</td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>
          }
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setHistoryOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={captureOpen} onOpenChange={setCaptureOpen}>
        <DialogContent className="max-h-[min(92vh,760px)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Importación puntual / JSON</DialogTitle>
            <DialogDescription>
              Uso secundario: búsqueda por término o JSON desde DevTools. El flujo principal de Lider es el lote
              paginado arriba.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-[13px]">
            <div className="space-y-1.5">
              <Label className="text-[12px]">Cadena</Label>
              <Select value={captureRetailer} onValueChange={(v) => setCaptureRetailer(v as CaptureRetailer)}>
                <SelectTrigger className="app-input h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="jumbo">Jumbo</SelectItem>
                  <SelectItem value="lider">Lider</SelectItem>
                  <SelectItem value="central_mayorista">Central Mayorista</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="mb-2 text-[12px] font-medium">Búsqueda en la tienda</p>
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <Label className="text-[12px]">Término (≥2 caracteres)</Label>
                  <Input
                    className="app-input h-9"
                    placeholder="Ej. aceite maravilla"
                    value={captureQuery}
                    onChange={(e) => setCaptureQuery(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[12px]">Máximo de resultados</Label>
                  <Input
                    className="app-input h-9"
                    type="number"
                    min={1}
                    max={100}
                    value={captureMax}
                    onChange={(e) => setCaptureMax(Number(e.target.value) || 40)}
                  />
                </div>
                <Button
                  type="button"
                  className="w-full gap-2 sm:w-auto"
                  disabled={captureWebBusy}
                  onClick={() => void submitWebCapture()}
                >
                  {captureWebBusy ?
                    <Loader2 className="h-4 w-4 animate-spin" />
                  : <CloudDownload className="h-4 w-4" />}
                  Buscar e importar
                </Button>
              </div>
            </div>

            <div className="rounded-md border border-border p-3">
              <p className="mb-2 text-[12px] font-medium">Importar desde JSON</p>
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <Label className="text-[12px]">URL base del sitio (opcional)</Label>
                  <Input
                    className="app-input h-9 font-mono text-[12px]"
                    placeholder={captureJsonBasePlaceholder(captureRetailer)}
                    value={jsonBaseUrl}
                    onChange={(e) => setJsonBaseUrl(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[12px]">JSON</Label>
                  <textarea
                    className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[140px] w-full rounded-md border px-3 py-2 text-[13px] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    spellCheck={false}
                    placeholder='[{"productId":"…","productName":"…",…}]'
                    value={jsonImportText}
                    onChange={(e) => setJsonImportText(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-2 sm:w-auto"
                  disabled={jsonBusy}
                  onClick={() => void submitJsonImport()}
                >
                  {jsonBusy ?
                    <Loader2 className="h-4 w-4 animate-spin" />
                  : null}
                  Importar JSON
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCaptureOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sweepSummaryOpen} onOpenChange={setSweepSummaryOpen}>
        <DialogContent className="max-h-[min(92vh,680px)] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Resumen del barrido legacy</DialogTitle>
            <DialogDescription>Resultado de la última corrida masiva.</DialogDescription>
          </DialogHeader>
          {lastSweepSummary ?
            <div className="space-y-4 text-[13px]">
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-[12px]">
                <dt className="text-muted-foreground">Cadena</dt>
                <dd className="text-right font-medium">{retailerLabel(lastSweepSummary.retailer)}</dd>
                <dt className="text-muted-foreground">Páginas descargadas</dt>
                <dd className="text-right">{lastSweepSummary.pagesFetched}</dd>
                <dt className="text-muted-foreground">Ítems nuevos guardados</dt>
                <dd className="text-right font-semibold">{lastSweepSummary.inserted}</dd>
              </dl>
            </div>
          : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSweepSummaryOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
