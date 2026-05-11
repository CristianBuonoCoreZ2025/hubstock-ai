'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CloudDownload,
  History,
  Link2,
  Link2Off,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { CatalogSearchBox, SectionSearchCombo } from '@/app/(app)/catalog/catalog-ui'
import {
  fetchRetailBatchSummaryAction,
  fetchRetailLiderReviewGroupsAction,
  fetchRetailListingsPage,
  fetchRetailMatchCandidatesAction,
  fetchRetailPriceHistory,
  importRetailSnapshotsFromJsonAction,
  linkRetailListingAction,
  autoAssociateUnlinkedRetailAction,
  bulkExactTitleRetailLinksAction,
  processRetailCaptureBatchPageAction,
  recaptureHomologatedLinkedAction,
  runRetailHomologationAction,
  runRetailWebCaptureAction,
  startRetailCaptureBatchAction,
  unlinkRetailListingAction,
  type CaptureRetailer,
  type RetailListingRow,
  type RetailMatchCandidate,
  type RetailHistoryRow,
  type RetailReviewQueueRow,
  type RetailCaptureBatchRow,
  type RetailLiderReviewGroupSummary,
} from '@/app/actions/catalog-retail'
import { LiderMassCapturePanel } from '@/app/(app)/catalog/LiderMassCapturePanel'
import { LiderTaxonomyMatrix } from '@/app/(app)/catalog/LiderTaxonomyMatrix'
import { searchCatalogProductsForPickerAction } from '@/app/actions/catalog'
import { fetchLiderRetailTaxonomyBlockingAction } from '@/app/actions/retail-taxonomy'
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

const TOOLBAR_BTN = 'h-9 min-w-[280px] shrink-0'

/** Vista fijada a Lider (dashboard operativo). */
const RETAILER_LIDER = 'lider' as const satisfies CaptureRetailer

const PIPELINE_MAX_CAPTURE_STEPS = 8000
const PIPELINE_MAX_HOMOLOG_ROUNDS = 600
const PIPELINE_MAX_AUTO_ASSOC_ROUNDS = 48

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
    description_hint: r.description_hint ?? null,
    captured_at: r.created_at,
    catalog_product_id: null,
    linked_product_name: null,
    total_count: 0,
  }
}

export function RetailPricingTab(props: { sections: SectionOpt[]; categories: CategoryOpt[] }) {
  const { sections, categories } = props

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
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const [pipelineStatusText, setPipelineStatusText] = useState<string | null>(null)
  const [pipelineDetailText, setPipelineDetailText] = useState<string | null>(null)
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const [liderPanelTick, setLiderPanelTick] = useState(0)
  const [taxonomyBlocking, setTaxonomyBlocking] = useState(false)
  const [reviewGroups, setReviewGroups] = useState<RetailLiderReviewGroupSummary[]>([])
  const [advOpen, setAdvOpen] = useState(false)
  const advancedDetailsRef = useRef<HTMLDetailsElement>(null)
  const [productsDetailOpen, setProductsDetailOpen] = useState(false)

  const reloadList = useCallback(async () => {
    setLoading(true)
    const res = await fetchRetailListingsPage({
      retailer: RETAILER_LIDER,
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
  }, [page, searchCommitted, unlinkedOnly])

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

  useEffect(() => {
    void reloadList()
  }, [reloadList])

  useEffect(() => {
    void reloadBatch()
  }, [reloadBatch])

  useEffect(() => {
    let cancelled = false
    async function loadGroups() {
      if (!batch?.id) {
        setReviewGroups([])
        return
      }
      const res = await fetchRetailLiderReviewGroupsAction({ batchId: batch.id })
      if (cancelled) return
      if (!res.ok) {
        setReviewGroups([])
        return
      }
      setReviewGroups(res.groups)
    }
    void loadGroups()
    return () => {
      cancelled = true
    }
  }, [batch?.id, liderPanelTick])

  useEffect(() => {
    void fetchLiderRetailTaxonomyBlockingAction().then((r) => {
      if (r.ok) setTaxonomyBlocking(r.blocking)
    })
  }, [liderPanelTick])

  useEffect(() => {
    setPage(0)
  }, [searchCommitted, unlinkedOnly])

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
    setLiderPanelTick((x) => x + 1)
  }

  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyRow, setHistoryRow] = useState<RetailListingRow | null>(null)
  const [historyRows, setHistoryRows] = useState<RetailHistoryRow[]>([])
  const [historyBusy, setHistoryBusy] = useState(false)

  const [captureOpen, setCaptureOpen] = useState(false)
  const [captureQuery, setCaptureQuery] = useState('')
  const [captureMax, setCaptureMax] = useState(40)
  const [captureWebBusy, setCaptureWebBusy] = useState(false)
  const [jsonImportText, setJsonImportText] = useState('')
  const [jsonBaseUrl, setJsonBaseUrl] = useState('')
  const [jsonBusy, setJsonBusy] = useState(false)

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
      retailer: RETAILER_LIDER,
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
      retailer: RETAILER_LIDER,
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
    setRecaptureBusy(true)
    const res = await recaptureHomologatedLinkedAction({
      retailer: RETAILER_LIDER,
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
      retailerFilter: RETAILER_LIDER,
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
    setExactBulkBusy(true)
    const res = await bulkExactTitleRetailLinksAction({
      retailer: RETAILER_LIDER,
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

  async function onContinueBatch() {
    if (!batch?.id) {
      toast.error('No hay un lote reciente. Iniciá una captura primero.')
      return
    }
    if (batch.status === 'completed') {
      toast.message(
        'La captura de páginas ya finalizó. Continuá con homologación desde la acción principal o el panel avanzado.',
      )
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
    setLiderPanelTick((x) => x + 1)
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
    setLiderPanelTick((x) => x + 1)
  }

  async function runLiderFullPipeline() {
    if (pipelineRunning || batchActionBusy) return
    if (taxonomyBlocking) {
      toast.error(
        'Hay categorías Lider pendientes de homologar. Completá el paso de taxonomía antes de crear productos o actualizar precios.',
      )
      return
    }
    setPipelineRunning(true)
    setPipelineError(null)
    setPipelineStatusText('Preparando…')
    setPipelineDetailText(null)
    setBatchActionBusy(true)
    try {
      setPipelineStatusText('Creando lote y plan de captura…')
      const start = await startRetailCaptureBatchAction({ retailer: 'lider' })
      if (!start.ok) {
        setPipelineError(start.error)
        toast.error(start.error)
        return
      }
      setPipelineDetailText(
        'Lectura nueva: se reemplazó el staging y los precios descargados previos de Lider. Los vínculos y el catálogo maestro no cambian.',
      )
      const batchId = start.batchId

      setPipelineStatusText('Capturando listados…')
      for (let i = 0; i < PIPELINE_MAX_CAPTURE_STEPS; i++) {
        const res = await processRetailCaptureBatchPageAction({ batchId })
        if (!res.ok) {
          setPipelineError(res.error)
          toast.error(res.error)
          return
        }
        if (res.error) {
          setPipelineError(res.error)
          toast.error(res.error)
        }
        setPipelineDetailText(`Avance: ${res.nextPageIndex} / ${res.totalPages} páginas`)
        await reloadBatch()
        if (res.done) break
      }

      setPipelineStatusText('Homologando (URL, texto, reglas; IA solo en ambiguos)…')
      setPipelineDetailText(null)
      for (let j = 0; j < PIPELINE_MAX_HOMOLOG_ROUNDS; j++) {
        const h = await runRetailHomologationAction({ batchId, limit: 80 })
        if (!h.ok) {
          setPipelineError(h.error)
          toast.error(h.error)
          return
        }
        await reloadBatch()
        if (h.processed === 0) break
      }

      setPipelineStatusText('Homologación por nombre exacto…')
      const exact = await bulkExactTitleRetailLinksAction({ retailer: RETAILER_LIDER })
      if (!exact.ok) {
        setPipelineError(exact.error)
        toast.error(exact.error)
      }

      setPipelineStatusText('Asociación automática (candidatos seguros)…')
      for (let k = 0; k < PIPELINE_MAX_AUTO_ASSOC_ROUNDS; k++) {
        const a = await autoAssociateUnlinkedRetailAction({ retailerFilter: RETAILER_LIDER, maxRows: 40 })
        if (!a.ok) break
        await reloadBatch()
        if (a.linked === 0) break
      }

      setPipelineStatusText('Completado')
      setPipelineDetailText(null)
      toast.success('Captura y análisis finalizados. Revisá solo las decisiones pendientes.')
      setLiderPanelTick((x) => x + 1)
      await reloadBatch()
      void reloadList()
    } finally {
      setBatchActionBusy(false)
      setPipelineRunning(false)
    }
  }

  async function onRefreshView() {
    await reloadBatch()
    void reloadList()
    setLiderPanelTick((x) => x + 1)
    toast.success('Vista actualizada.')
  }

  const metrics = useMemo(() => {
    const captured = batch?.total_found ?? 0
    const clean = batch?.total_inserted ?? 0
    const discarded = batch?.capture_discarded_total ?? 0
    const homologados = batch
      ? batch.url_linked +
        batch.exact_linked +
        batch.rule_linked +
        batch.ai_linked +
        batch.new_master_created
      : 0
    const sinCambio = batch?.snapshot_skipped_same_price_total ?? 0
    const preciosAct = batch?.snapshot_inserted_total ?? 0

    let nuevosCandidatos = 0
    let manualHom = 0
    let descartables = 0
    for (const g of reviewGroups) {
      const n = g.product_count
      const t = g.review_tray
      if (t === 'new_master_candidate') nuevosCandidatos += n
      else if (t === 'discarded_candidate') descartables += n
      else if (
        t === 'duplicate_risk' ||
        t === 'format_conflict' ||
        t === 'category_uncertain' ||
        t === 'low_confidence'
      ) {
        manualHom += n
      }
    }

    return [
      { label: 'Capturados', value: captured },
      { label: 'Limpios', value: clean },
      { label: 'Descartados por limpieza', value: discarded },
      { label: 'Homologados automáticos', value: homologados },
      { label: 'Sin cambio de precio', value: sinCambio },
      { label: 'Precios actualizados', value: preciosAct },
      { label: 'Nuevos candidatos', value: nuevosCandidatos },
      { label: 'Requieren homologación manual', value: manualHom },
      { label: 'Descartables sugeridos', value: descartables },
    ]
  }, [batch, reviewGroups])

  const pipelineHeadlineStatus = useMemo(() => {
    if (pipelineError) return 'Con errores'
    if (pipelineRunning) return 'Procesando'
    if (pipelineStatusText === 'Completado') return 'Completado'
    if (batch?.error_message) return 'Con advertencias'
    return 'Listo'
  }, [pipelineError, pipelineRunning, pipelineStatusText, batch?.error_message])

  const pagingMeta =
    total !== null ? (
      <>
        {' '}
        · Total filtrado: {total}
      </>
    ) : null

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <p className="max-w-prose text-[13px] leading-snug text-muted-foreground">
          Primero resolvé la taxonomía Lider contra el catálogo maestro. Después podés ejecutar la captura, la creación de
          maestros y la actualización de precios en un solo paso.
        </p>
      </header>

      <LiderTaxonomyMatrix
        sections={sections}
        refreshToken={liderPanelTick}
        onBlockingChanged={(blocking) => setTaxonomyBlocking(blocking)}
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
        <Button
          type="button"
          className={TOOLBAR_BTN}
          disabled={pipelineRunning || batchActionBusy || taxonomyBlocking}
          onClick={() => void runLiderFullPipeline()}
        >
          {pipelineRunning || batchActionBusy ?
            <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" aria-hidden />
          : null}
          Crear productos y actualizar precios
        </Button>
        <p className="mt-3 max-w-prose text-[12px] leading-snug text-muted-foreground">
          Crea el lote, descarga listados, homologa, enlaza candidatos seguros y actualiza precios cuando cambian. Este
          botón permanece deshabilitado mientras existan categorías Lider pendientes, sugeridas sin aprobar o faltantes en
          el bloque de taxonomía.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted/25 px-4 py-3">
        <p className="text-[12px] font-medium text-muted-foreground">Estado</p>
        <p className="mt-1 text-[15px] font-semibold text-foreground">{pipelineHeadlineStatus}</p>
        {pipelineStatusText ?
          <p className="mt-1 text-[13px] text-muted-foreground">{pipelineStatusText}</p>
        : null}
        {pipelineDetailText ?
          <p className="mt-0.5 text-[12px] font-mono text-muted-foreground">{pipelineDetailText}</p>
        : null}
        {pipelineError ?
          <p className="mt-2 text-[13px] text-destructive">{pipelineError}</p>
        : null}
        {!pipelineError && batch?.error_message ?
          <p className="mt-2 text-[12px] text-amber-800 dark:text-amber-200">{batch.error_message}</p>
        : null}
      </div>

      <div>
        <p className="mb-2 text-[12px] font-medium text-muted-foreground">Resumen (último lote)</p>
        <dl className="grid grid-cols-2 gap-3 border border-border bg-card px-3 py-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {metrics.map((m) => (
            <div key={m.label}>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{m.label}</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                {batchLoading && !batch ? '…' : m.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <LiderMassCapturePanel
        batch={batch}
        batchActionBusy={batchActionBusy}
        showDecisionTrays
        showDebugToolbar={false}
        refreshToken={liderPanelTick}
        onContinueBatch={onContinueBatch}
        onHomologate={onHomologatePending}
        onRefreshAll={onRefreshView}
        onBatchChanged={async () => {
          await reloadBatch()
          void reloadList()
          setLiderPanelTick((x) => x + 1)
        }}
        onOpenHomolog={(r) => openHomolog(reviewRowAsListing(r))}
      />

      <details
        ref={advancedDetailsRef}
        open={advOpen}
        onToggle={(e) => setAdvOpen(e.currentTarget.open)}
        className="rounded-lg border border-border bg-card"
      >
        <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-foreground">
          Herramientas avanzadas
        </summary>
        <div className="space-y-4 border-t border-border px-4 pb-4 pt-4 text-[13px]">
          <LiderMassCapturePanel
            batch={batch}
            batchActionBusy={batchActionBusy}
            showDecisionTrays={false}
            showDebugToolbar
            refreshToken={liderPanelTick}
            onContinueBatch={onContinueBatch}
            onHomologate={onHomologatePending}
            onRefreshAll={onRefreshView}
            onBatchChanged={async () => {
              await reloadBatch()
              void reloadList()
              setLiderPanelTick((x) => x + 1)
            }}
            onOpenHomolog={(r) => openHomolog(reviewRowAsListing(r))}
          />

          <details className="rounded-md border border-dashed border-border/70 bg-muted/10">
            <summary className="cursor-pointer px-3 py-2 text-[12px] font-medium text-muted-foreground">
              Diagnóstico técnico (semillas opcionales)
            </summary>
            <p className="mt-2 px-3 pb-3 text-[12px] leading-snug text-muted-foreground">
              El plan principal usa sitemap, página de inicio y semillas internas; no requiere configuración. Las
              variables <span className="font-mono text-[11px]">RETAIL_LIDER_STOREFRONT_BROWSE_URLS</span> o{' '}
              <span className="font-mono text-[11px]">RETAIL_LIDER_BROWSE_URLS</span> son solo un refuerzo opcional en
              servidor (rutas separadas por coma).
            </p>
          </details>

          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className={TOOLBAR_BTN}
                disabled={recaptureBusy}
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
                disabled={exactBulkBusy || autoAssocBusy}
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

          <p className="rounded-md border border-border bg-muted/15 px-3 py-2 text-[12px] text-muted-foreground">
            Otras cadenas (Jumbo, Central Mayorista): sin flujo automático en esta pantalla por ahora.
          </p>

          <div className="rounded-md border border-border p-3">
            <p className="mb-2 text-[12px] font-medium">JSON o búsqueda puntual en tienda</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="h-9" onClick={() => setCaptureOpen(true)}>
                Abrir importación / búsqueda
              </Button>
            </div>
          </div>

      <details
        open={productsDetailOpen}
        onToggle={(e) => setProductsDetailOpen(e.currentTarget.open)}
        className="rounded-lg border border-border bg-card"
      >
        <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-foreground">
          Detalle de productos
        </summary>
        <div className="space-y-4 border-t border-border px-4 pb-4 pt-4">
          <div className="flex flex-wrap items-end gap-3">
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
        </div>
      </details>
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
            <p className="rounded-md border border-border bg-muted/20 px-3 py-2 text-[12px] text-muted-foreground">
              Cadena fija: <span className="font-medium text-foreground">Lider</span> (super.lider.cl).
            </p>

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
                    placeholder={captureJsonBasePlaceholder(RETAILER_LIDER)}
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
    </div>
  )
}
