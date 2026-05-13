'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Loader2,
  Play,
  RefreshCw,
  History,
  Link2,
  Unlink,
  ChevronDown,
  AlertTriangle,
  Ban,
  Search,
  FileText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
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
import { LiderTaxonomyMatrix } from './LiderTaxonomyMatrix'
import {
  fetchRetailListingsPage,
  fetchRetailBatchSummaryAction,
  fetchRetailLiderReviewGroupsAction,
  fetchRetailMatchCandidatesAction,
  linkRetailListingAction,
  unlinkRetailListingAction,
  fetchRetailPriceHistory,
  runRetailWebCaptureAction,
  importRetailSnapshotsFromJsonAction,
  recaptureHomologatedLinkedAction,
  autoAssociateUnlinkedRetailAction,
  bulkExactTitleRetailLinksAction,
  processRetailCaptureBatchPageAction,
  runRetailHomologationAction,
  startRetailCaptureBatchAction,
  type RetailCaptureBatchRow,
  type RetailLiderReviewGroupSummary,
} from '@/app/actions/catalog-retail'
import { fetchLiderRetailTaxonomyBlockingAction, generateLiderDiscoveryPreviewLogAction } from '@/app/actions/retail-taxonomy'
import { normalizeSearchText } from '@/lib/search'
import { CATALOG_GRID_PAGE_SIZE } from '@/lib/catalog-grid'
import { GridPagingRow } from '@/components/grid/grid-paging-row'

type CaptureRetailer = 'lider' | 'jumbo' | 'central_mayorista'

type SectionOpt = {
  id: string
  name: string
  sort_order: number
}

type CategoryOpt = {
  id: string
  name: string
  section_id: string
}

type RetailListingRow = {
  snapshot_id: string
  retailer: string
  external_ref: string
  source_url: string | null
  title: string
  price: number
  category_hint: string | null
  brand_hint: string | null
  description_hint: string | null
  captured_at: string
  catalog_product_id: string | null
  linked_product_name: string | null
  total_count: number
}

type RetailMatchCandidateLike = {
  catalog_product_id?: string
  product_name?: string
  category_id?: string
  default_reference_price?: number | null
  match_score?: number
  id?: string
  name?: string
}

type RetailHistoryLike = {
  price: number
  captured_at: string
}

function retailerLabel(code: string): string {
  const labels: Record<string, string> = {
    lider: 'Lider',
    jumbo: 'Jumbo',
    central_mayorista: 'Central Mayorista',
  }

  return labels[code] ?? code
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

    if (detail.length > 0) {
      msg += ` (${detail.join(', ')}).`
    }
  }

  if (res.autoAssociateDisabled) {
    msg += ' Paso automático de similitud desactivado en el servidor. Usa Asociar automático después si lo habilitas.'
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
    msg += ' Se cortó el lote por rendimiento. Puedes repetir Asociar automático.'
  }

  return msg
}

const TOOLBAR_BTN = 'h-9 min-w-[280px] shrink-0'

const RETAILER_LIDER = 'lider' as const satisfies CaptureRetailer

const PIPELINE_MAX_CAPTURE_STEPS = 8000
const PIPELINE_MAX_HOMOLOG_ROUNDS = 600
const PIPELINE_MAX_AUTO_ASSOC_ROUNDS = 48

export function RetailPricingTab(props: {
  sections: SectionOpt[]
  categories: CategoryOpt[]
}) {
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

  const [recaptureBusy, setRecaptureBusy] = useState(false)
  const [discoveryLogBusy, setDiscoveryLogBusy] = useState(false)
  const [autoAssocBusy, setAutoAssocBusy] = useState(false)
  const [exactBulkBusy, setExactBulkBusy] = useState(false)

  const [homologOpen, setHomologOpen] = useState(false)
  const [homologRow, setHomologRow] = useState<RetailListingRow | null>(null)
  const [sectionForMatch, setSectionForMatch] = useState('all')
  const [categoryForMatchId, setCategoryForMatchId] = useState('all')
  const [candidates, setCandidates] = useState<RetailMatchCandidateLike[]>([])
  const [candidatesBusy, setCandidatesBusy] = useState(false)
  const [addAlias, setAddAlias] = useState(true)
  const [pickerQ, setPickerQ] = useState('')
  const [pickerOptions, setPickerOptions] = useState<{ id: string; name: string }[]>([])
  const [pickerBusy, setPickerBusy] = useState(false)

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
    const id = window.setTimeout(() => {
      void reloadList()
    }, 0)
    return () => window.clearTimeout(id)
  }, [reloadList])

  useEffect(() => {
    const id = window.setTimeout(() => {
      void reloadBatch()
    }, 0)
    return () => window.clearTimeout(id)
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
    void fetchLiderRetailTaxonomyBlockingAction().then((res) => {
      if (res.ok) {
        setTaxonomyBlocking(res.blocking)
      }
    })
  }, [liderPanelTick])

  useEffect(() => {
    const id = window.setTimeout(() => {
      setPage(0)
    }, 0)
    return () => window.clearTimeout(id)
  }, [searchCommitted, unlinkedOnly])

  const categoriesInSection = useMemo(() => {
    const sec = sectionForMatch === 'all' ? null : sectionForMatch
    const list = sec ? categories.filter((c) => c.section_id === sec) : categories

    return [...list].sort((a, b) =>
      a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }),
    )
  }, [categories, sectionForMatch])

  useEffect(() => {
    async function loadCandidates() {
      if (!homologRow) {
        setCandidates([])
        return
      }

      setCandidatesBusy(true)

      const cat = categoryForMatchId !== 'all' ? categoryForMatchId : null

      const res = await fetchRetailMatchCandidatesAction({
        title: homologRow.description_hint
          ? `${homologRow.title} ${homologRow.description_hint}`.trim()
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

      setCandidates(res.rows as RetailMatchCandidateLike[])
    }

    void loadCandidates()
  }, [homologRow, categoryForMatchId])

  useEffect(() => {
    async function pick() {
      if (!homologOpen) return

      const q = normalizeSearchText(pickerQ)

      if (q.length < 2) {
        setPickerOptions([])
        return
      }

      setPickerBusy(true)

      const res = await fetchRetailMatchCandidatesAction({
        title: pickerQ,
        price: null,
        categoryId: null,
      })

      setPickerBusy(false)

      if (!res.ok) {
        setPickerOptions([])
        return
      }

      const options = (res.rows as RetailMatchCandidateLike[])
        .map((row) => {
          const id = row.catalog_product_id ?? row.id
          const name = row.product_name ?? row.name

          if (!id || !name) return null

          return { id, name }
        })
        .filter((row): row is { id: string; name: string } => row !== null)

      setPickerOptions(options)
    }

    void pick()
  }, [homologOpen, pickerQ])

  function openHomolog(row: RetailListingRow) {
    setHomologRow(row)
    setSectionForMatch(sections[0]?.id ?? 'all')
    setCategoryForMatchId('all')
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
  const [historyRows, setHistoryRows] = useState<RetailHistoryLike[]>([])
  const [historyBusy, setHistoryBusy] = useState(false)

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

    setHistoryRows(res.rows as RetailHistoryLike[])
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

  const [captureQuery, setCaptureQuery] = useState('')
  const [captureMax, setCaptureMax] = useState(40)
  const [captureWebBusy, setCaptureWebBusy] = useState(false)
  const [jsonImportText, setJsonImportText] = useState('')
  const [jsonBaseUrl, setJsonBaseUrl] = useState('')
  const [jsonBusy, setJsonBusy] = useState(false)

  async function submitWebCapture() {
    if (taxonomyBlocking) {
      toast.error('Hay taxonomía Lider pendiente. Resuelve las secciones y categorías antes de capturar productos.')
      return
    }

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

    setCaptureQuery('')

    void reloadList()
    void reloadBatch()
  }

  async function submitJsonImport() {
    if (taxonomyBlocking) {
      toast.error('Hay taxonomía Lider pendiente. Resuelve las secciones y categorías antes de importar productos.')
      return
    }

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

    setJsonImportText('')

    void reloadList()
    void reloadBatch()
  }

  async function submitRecaptureHomologated() {
    if (taxonomyBlocking) {
      toast.error('Hay taxonomía Lider pendiente. Resuelve antes de recapturar.')
      return
    }

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
      toast.error('No hay un lote reciente. Inicia una captura primero.')
      return
    }

    if (batch.status === 'completed') {
      toast.message('La captura de páginas ya finalizó. Continúa con homologación desde la acción principal o el panel avanzado.')
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
      toast.message('Página sin productos nuevos. La tienda puede haber devuelto listado vacío.')
    }

    await reloadBatch()

    void reloadList()

    setLiderPanelTick((x) => x + 1)
  }

  async function onHomologatePending() {
    setBatchActionBusy(true)

    const res = await runRetailHomologationAction({
      batchId: batch?.id ?? null,
      limit: 48,
    })

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

  function downloadTextAsFile(text: string, filename: string) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function onDownloadDiscoveryLog() {
    if (discoveryLogBusy || pipelineRunning) return
    setDiscoveryLogBusy(true)
    const res = await generateLiderDiscoveryPreviewLogAction()
    setDiscoveryLogBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    const fname = `lider-discovery-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`
    downloadTextAsFile(res.text, fname)
    toast.success('Se descargó el log de secciones y categorías (sin productos).')
    if (res.savedRelativePath) {
      toast.message(`En desarrollo también se guardó: ${res.savedRelativePath}`)
    }
  }

  async function runLiderFullPipeline() {
    if (pipelineRunning || batchActionBusy) return

    const blockCheck = await fetchLiderRetailTaxonomyBlockingAction()

    if (!blockCheck.ok || blockCheck.blocking) {
      toast.error('Hay secciones o categorías Lider pendientes. Completa el paso de taxonomía antes de ejecutar la captura.')
      setTaxonomyBlocking(true)
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

      for (let i = 0; i < PIPELINE_MAX_CAPTURE_STEPS; i += 1) {
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

      setPipelineStatusText('Homologando por URL, texto y reglas. IA solo en ambiguos.')
      setPipelineDetailText(null)

      for (let j = 0; j < PIPELINE_MAX_HOMOLOG_ROUNDS; j += 1) {
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

      setPipelineStatusText('Asociación automática con candidatos seguros…')

      for (let k = 0; k < PIPELINE_MAX_AUTO_ASSOC_ROUNDS; k += 1) {
        const a = await autoAssociateUnlinkedRetailAction({
          retailerFilter: RETAILER_LIDER,
          maxRows: 40,
        })

        if (!a.ok) break

        await reloadBatch()

        if (a.linked === 0) break
      }

      setPipelineStatusText('Completado')
      setPipelineDetailText(null)

      toast.success('Captura y análisis finalizados. Revisa solo las decisiones pendientes.')

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

    for (const group of reviewGroups) {
      const n = group.product_count
      const tray = group.review_tray

      if (tray === 'new_master_candidate') {
        nuevosCandidatos += n
      } else if (tray === 'discarded_candidate') {
        descartables += n
      } else if (
        tray === 'duplicate_risk' ||
        tray === 'format_conflict' ||
        tray === 'category_uncertain' ||
        tray === 'low_confidence'
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
    <div className="space-y-6">
      <LiderTaxonomyMatrix
        sections={sections}
        refreshToken={liderPanelTick}
        onBlockingChanged={(blocking) => setTaxonomyBlocking(blocking)}
      />

      <div className="border-t border-border" />

      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Qué botón usar</p>
          <ul className="mt-2 list-inside list-disc space-y-1">
            <li>
              <span className="text-foreground">Detectar taxonomía</span> (bloque de arriba): lee Lider y
              llena la grilla para homologar secciones y categorías. Es el primer paso operativo.
            </li>
            <li>
              <span className="text-foreground">Exportar diagnóstico .txt</span>: solo descarga un archivo de
              texto con secciones, categorías y una muestra de URLs del plan. No guarda en base ni captura
              productos. Úsalo para revisar rutas sin tocar datos.
            </li>
            <li>
              <span className="text-foreground">Ejecutar pipeline completo</span>: crea el lote y ejecuta
              captura y homologación. Requiere que la taxonomía no esté bloqueando.
            </li>
          </ul>
        </div>

        {taxonomyBlocking ? (
          <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <Ban className="h-5 w-5 shrink-0 text-amber-600" aria-hidden />
            <div>
              <p className="font-semibold">Captura de productos bloqueada</p>
              <p className="text-amber-800">
                Hay secciones o categorías Lider pendientes de homologar. Completa el paso de taxonomía antes de crear productos o actualizar precios.
              </p>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={runLiderFullPipeline}
            disabled={pipelineRunning || batchActionBusy || taxonomyBlocking}
            className={TOOLBAR_BTN}
          >
            {pipelineRunning ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Play className="mr-2 h-4 w-4" aria-hidden />
            )}
            {pipelineRunning ? 'Procesando…' : 'Ejecutar pipeline completo'}
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => void onDownloadDiscoveryLog()}
            disabled={pipelineRunning || discoveryLogBusy}
            className="h-9 gap-2"
            title="Descarga secciones, categorías y muestra de URLs del descubrimiento. No sustituye Detectar taxonomía ni ejecuta captura."
            aria-label="Exportar diagnóstico de rutas Lider en archivo de texto"
          >
            {discoveryLogBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <FileText className="h-4 w-4" aria-hidden />
            )}
            Exportar diagnóstico .txt
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={onRefreshView}
            disabled={pipelineRunning}
            className="h-9 gap-2"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Actualizar vista
          </Button>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 text-sm shadow-sm">
          <div className="flex items-center gap-2">
            <span className="font-medium">Estado:</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                pipelineError
                  ? 'bg-red-100 text-red-800'
                  : pipelineRunning
                    ? 'bg-blue-100 text-blue-800'
                    : pipelineStatusText === 'Completado'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-800'
              }`}
            >
              {pipelineHeadlineStatus}
            </span>
          </div>

          {pipelineStatusText ? (
            <p className="mt-1 text-muted-foreground">{pipelineStatusText}</p>
          ) : null}

          {pipelineDetailText ? (
            <p className="mt-1 text-xs text-muted-foreground">{pipelineDetailText}</p>
          ) : null}

          {pipelineError ? (
            <p className="mt-1 text-xs text-red-600">{pipelineError}</p>
          ) : null}

          {!pipelineError && batch?.error_message ? (
            <p className="mt-1 text-xs text-amber-600">{batch.error_message}</p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="rounded-lg border border-border bg-card p-3 shadow-sm"
            >
              <p className="text-xs text-muted-foreground">{metric.label}</p>
              <p className="text-lg font-semibold">
                {batchLoading && !batch ? '…' : metric.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      <details
        ref={advancedDetailsRef}
        open={advOpen}
        onToggle={(event) => setAdvOpen(event.currentTarget.open)}
        className="rounded-lg border border-border bg-card"
      >
        <summary className="flex cursor-pointer items-center gap-2 p-4 text-sm font-medium">
          <ChevronDown
            className={`h-4 w-4 transition-transform ${advOpen ? 'rotate-180' : ''}`}
            aria-hidden
          />
          Herramientas avanzadas
        </summary>

        <div className="space-y-3 border-t border-border p-4">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onContinueBatch}
              disabled={batchActionBusy || !batch || batch.status === 'completed'}
              className="h-9"
            >
              {batchActionBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              Continuar lote
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={onHomologatePending}
              disabled={batchActionBusy}
              className="h-9"
            >
              {batchActionBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              Homologar pendientes
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={submitBulkExactHomologation}
              disabled={exactBulkBusy}
              className="h-9"
            >
              {exactBulkBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              Nombre exacto masivo
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={submitAutoAssociate}
              disabled={autoAssocBusy}
              className="h-9"
            >
              {autoAssocBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              Asociar automático
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={submitRecaptureHomologated}
              disabled={recaptureBusy || taxonomyBlocking}
              className="h-9"
            >
              {recaptureBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              Recapturar homologados
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            El plan de captura usa sitemap, página de inicio y semillas internas. El archivo de diagnóstico
            (botón «Exportar diagnóstico .txt» arriba) lista lo que ve el descubrimiento de rutas, sin productos;
            en desarrollo también puede guardarse en{' '}
            <code className="rounded bg-muted px-1">logs/lider-discovery-latest.txt</code>.
          </p>
        </div>
      </details>

      <details
        open={productsDetailOpen}
        onToggle={(event) => setProductsDetailOpen(event.currentTarget.open)}
        className="rounded-lg border border-border bg-card"
      >
        <summary className="flex cursor-pointer items-center gap-2 p-4 text-sm font-medium">
          <ChevronDown
            className={`h-4 w-4 transition-transform ${productsDetailOpen ? 'rotate-180' : ''}`}
            aria-hidden
          />
          Captura puntual / JSON
        </summary>

        <div className="space-y-4 border-t border-border p-4">
          {taxonomyBlocking ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden />
              Captura bloqueada. Resuelve la taxonomía Lider primero.
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Búsqueda en tienda Lider</Label>

              <Input
                placeholder="Término, mínimo 2 caracteres"
                value={captureQuery}
                onChange={(event) => setCaptureQuery(event.target.value)}
                disabled={captureWebBusy || taxonomyBlocking}
              />

              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Máx. resultados</Label>

                <Input
                  type="number"
                  className="h-8 w-20"
                  value={captureMax}
                  onChange={(event) => setCaptureMax(Number(event.target.value) || 40)}
                  disabled={captureWebBusy || taxonomyBlocking}
                />
              </div>

              <Button
                type="button"
                onClick={submitWebCapture}
                disabled={captureWebBusy || taxonomyBlocking}
                className="h-9"
              >
                {captureWebBusy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Search className="mr-2 h-4 w-4" aria-hidden />
                )}
                Capturar
              </Button>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Importar desde JSON</Label>

              <Input
                placeholder="URL base del sitio, opcional"
                value={jsonBaseUrl}
                onChange={(event) => setJsonBaseUrl(event.target.value)}
                disabled={jsonBusy || taxonomyBlocking}
              />

              <textarea
                className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Pega aquí el JSON de productos…"
                value={jsonImportText}
                onChange={(event) => setJsonImportText(event.target.value)}
                disabled={jsonBusy || taxonomyBlocking}
              />

              <Button
                type="button"
                onClick={submitJsonImport}
                disabled={jsonBusy || taxonomyBlocking || !jsonImportText.trim()}
                className="h-9"
              >
                {jsonBusy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                ) : null}
                Importar JSON
              </Button>
            </div>
          </div>
        </div>
      </details>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              checked={unlinkedOnly}
              onChange={(event) => setUnlinkedOnly(event.target.checked)}
            />
            Solo sin homologar
          </label>

          <div className="flex items-center gap-2">
            <Input
              className="h-9 w-64"
              placeholder="Buscar en listado…"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setSearchCommitted(normalizeSearchText(searchDraft))
                }
              }}
            />

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => setSearchCommitted(normalizeSearchText(searchDraft))}
            >
              <Search className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>

        <GridPagingRow
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() => setPage((p) => p + 1)}
          disablePrev={page === 0}
          disableNext={!hasNext}
          pageIndex={page}
          pageSize={CATALOG_GRID_PAGE_SIZE}
          metaSuffix={pagingMeta}
        />

        {listLoadError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {listLoadError}
          </div>
        ) : null}

        <div className="rounded-lg border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3">Cadena</th>
                <th className="px-4 py-3">Ítem</th>
                <th className="px-4 py-3">Precio</th>
                <th className="px-4 py-3">Rubro</th>
                <th className="px-4 py-3">Homologado a</th>
                <th className="px-4 py-3">Captura</th>
                <th className="px-4 py-3">Acciones</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border">
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden />
                    Cargando…
                  </td>
                </tr>
              ) : null}

              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No hay capturas retail con estos filtros. Inicia un lote Lider o revisa permisos.
                  </td>
                </tr>
              ) : null}

              {rows.map((row) => (
                <tr key={`${row.retailer}-${row.external_ref}`} className="hover:bg-muted/30">
                  <td className="px-4 py-3">{retailerLabel(row.retailer)}</td>

                  <td className="px-4 py-3">
                    <p className="font-medium">{row.title}</p>

                    {row.description_hint ? (
                      <p className="text-xs text-muted-foreground">{row.description_hint}</p>
                    ) : null}
                  </td>

                  <td className="px-4 py-3 font-medium">
                    ${Number(row.price).toFixed(0)}
                  </td>

                  <td className="px-4 py-3 text-muted-foreground">
                    {row.category_hint ?? '—'}
                  </td>

                  <td className="px-4 py-3">
                    {row.linked_product_name ? (
                      <span className="text-green-700">{row.linked_product_name}</span>
                    ) : (
                      <span className="text-muted-foreground">Sin homologar</span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(row.captured_at).toLocaleString('es-CL', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => openHistory(row)}
                      >
                        <History className="h-3.5 w-3.5" aria-hidden />
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => openHomolog(row)}
                      >
                        <Link2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>

                      {row.catalog_product_id ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => void confirmUnlink(row)}
                        >
                          <Unlink className="h-3.5 w-3.5 text-red-400" aria-hidden />
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <GridPagingRow
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() => setPage((p) => p + 1)}
          disablePrev={page === 0}
          disableNext={!hasNext}
          pageIndex={page}
          pageSize={CATALOG_GRID_PAGE_SIZE}
          metaSuffix={pagingMeta}
        />
      </div>

      <Dialog open={homologOpen} onOpenChange={setHomologOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Homologar a catálogo maestro</DialogTitle>
          </DialogHeader>

          {homologRow ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/50 p-3">
                <p className="font-medium">{homologRow.title}</p>

                <p className="text-sm text-muted-foreground">
                  {retailerLabel(homologRow.retailer)} · ${Number(homologRow.price).toFixed(0)}
                </p>

                {homologRow.category_hint ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Origen: {homologRow.category_hint}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Sección</Label>

                  <Select
                    value={sectionForMatch}
                    onValueChange={(value) => {
                      setSectionForMatch(value)
                      setCategoryForMatchId('all')
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>

                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>

                      {sections.map((section) => (
                        <SelectItem key={section.id} value={section.id}>
                          {section.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Categoría opcional</Label>

                  <Select value={categoryForMatchId} onValueChange={setCategoryForMatchId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Todas" />
                    </SelectTrigger>

                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>

                      {categoriesInSection.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  checked={addAlias}
                  onChange={(event) => setAddAlias(event.target.checked)}
                />
                Guardar el nombre del ítem como alias del maestro
              </label>

              <div>
                <Label className="text-sm font-medium">Sugerencias</Label>

                {candidatesBusy ? (
                  <div className="py-4 text-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden />
                    Calculando…
                  </div>
                ) : candidates.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    Sin sugerencias con estos filtros.
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {candidates.map((candidate) => {
                      const candidateId = candidate.catalog_product_id ?? candidate.id
                      const candidateName = candidate.product_name ?? candidate.name
                      const score =
                        candidate.match_score != null
                          ? Number(candidate.match_score).toFixed(2)
                          : null

                      if (!candidateId || !candidateName) return null

                      return (
                        <button
                          key={candidateId}
                          type="button"
                          onClick={() => void confirmLink(candidateId)}
                          className="w-full rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-muted"
                        >
                          <p className="font-medium">{candidateName}</p>

                          <p className="text-xs text-muted-foreground">
                            {candidate.category_id ? `Categoría: ${candidate.category_id}` : 'Categoría no informada'}
                            {score ? ` · score ${score}` : ''}
                          </p>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="border-t border-border pt-4">
                <Label className="text-sm font-medium">
                  Buscar maestro manualmente, mínimo 2 caracteres
                </Label>

                <Input
                  className="mt-2"
                  value={pickerQ}
                  onChange={(event) => setPickerQ(event.target.value)}
                  placeholder="Escribe para buscar…"
                />

                {normalizeSearchText(pickerQ).length > 0 &&
                normalizeSearchText(pickerQ).length < 2 ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Escribe al menos 2 caracteres.
                  </p>
                ) : null}

                {pickerBusy ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden />
                    Buscando…
                  </p>
                ) : null}

                {pickerOptions.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {pickerOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => void confirmLink(option.id)}
                        className="w-full rounded-md border border-border bg-card p-2 text-left text-sm transition-colors hover:bg-muted"
                      >
                        {option.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Historial de capturas</DialogTitle>
          </DialogHeader>

          {historyRow ? (
            <div className="space-y-3">
              <p className="text-sm">
                <span className="font-medium">{retailerLabel(historyRow.retailer)}</span>
                {' '}
                {historyRow.title}
              </p>

              {historyBusy ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden />
                  Cargando…
                </div>
              ) : historyRows.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Sin datos.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="py-2">Fecha</th>
                      <th className="py-2">Precio</th>
                    </tr>
                  </thead>

                  <tbody>
                    {historyRows.map((history, index) => (
                      <tr key={`${history.captured_at}-${index}`} className="border-b border-border">
                        <td className="py-2">
                          {new Date(history.captured_at).toLocaleString('es-CL', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </td>

                        <td className="py-2 font-medium">
                          ${Number(history.price).toFixed(0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}