'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CloudDownload,
  History,
  Link2,
  Link2Off,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  CatalogTabHeader,
  SectionSearchCombo,
} from '@/app/(app)/catalog/catalog-ui'
import {
  fetchRetailListingsPage,
  bulkExactTitleRetailLinksAction,
  fetchRetailMatchCandidatesAction,
  fetchRetailPriceHistory,
  importRetailSnapshotsFromJsonAction,
  linkRetailListingAction,
  autoAssociateUnlinkedRetailAction,
  recaptureHomologatedLinkedAction,
  runRetailCatalogSweepAction,
  runRetailWebCaptureAction,
  unlinkRetailListingAction,
  type CaptureRetailer,
  type RetailCatalogSweepOkResult,
  type RetailListingRow,
  type RetailMatchCandidate,
  type RetailHistoryRow,
} from '@/app/actions/catalog-retail'
import { retailerDefinition } from '@/server/retail-capture/retailer-registry'
import { searchCatalogProductsForPickerAction } from '@/app/actions/catalog'
import { GridRowIconButton } from '@/components/grid/grid-row-icon-button'
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
      return 'https://super.lider.cl (o RETAIL_LIDER_VTEX_BASE_URL)'
    case 'central_mayorista':
      return 'URL pública del sitio (o RETAIL_CENTRAL_MAYORISTA_VTEX_BASE_URL)'
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
    if (detail.length > 0) {
      msg += ` (${detail.join('; ')}).`
    }
  }

  if (res.autoAssociateDisabled) {
    msg +=
      ' Paso automático de similitud desactivado en el servidor. Usa «Asociar automático» después si lo habilitas.'
    return msg
  }

  const attempted = res.autoAssociateAttempted ?? 0
  if (attempted === 0) {
    return msg
  }

  const aiN = res.autoLinkedByAi ?? 0
  const heuristicN = Math.max(0, res.autoLinked - aiN)
  msg += ` Enlaces automáticos: ${res.autoLinked} (${heuristicN} por reglas${aiN > 0 ? `, ${aiN} por IA` : ''}), hasta ${attempted} ítems sin vínculo revisados.`
  const skipped = res.autoAssociateSkippedNoMatch ?? 0
  const failed = res.autoAssociateFailed ?? 0
  if (skipped > 0) {
    msg += ` ${skipped} sin coincidencia clara.`
  }
  if (failed > 0) {
    msg += ` ${failed} con error.`
  }
  if (res.autoAssociateCapped) {
    msg += ' Se cortó el lote por rendimiento; puedes repetir «Asociar automático».'
  }
  return msg
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

export function RetailPricingTab(props: {
  sections: SectionOpt[]
  categories: CategoryOpt[]
}) {
  const { sections, categories } = props

  const [retailerFilter, setRetailerFilter] = useState<string>('jumbo')
  const [storeForCapture, setStoreForCapture] = useState<CaptureRetailer>('jumbo')
  const [sweepMax, setSweepMax] = useState(600)
  /** Por defecto paginar hasta que la API corte (tope interno 1M ítems); si no, máximo manual. */
  const [captureEntireCatalog, setCaptureEntireCatalog] = useState(true)
  /** Vacío = servidor usa RETAIL_VTEX_SWEEP_SEARCH_TERM o *. Muchas VTEX no aceptan * y devuelven HTML. */
  const [sweepSearchTerm, setSweepSearchTerm] = useState('')
  const [sweepBusy, setSweepBusy] = useState(false)
  const [sweepSummaryOpen, setSweepSummaryOpen] = useState(false)
  const [lastSweepSummary, setLastSweepSummary] = useState<RetailCatalogSweepOkResult | null>(null)
  const [unlinkedOnly, setUnlinkedOnly] = useState(false)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 400)
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<RetailListingRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(true)
  const [listLoadError, setListLoadError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const res = await fetchRetailListingsPage({
      retailer: retailerFilter,
      unlinkedOnly,
      search: debouncedSearch,
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
  }, [debouncedSearch, page, retailerFilter, unlinkedOnly])

  /* eslint-disable react-hooks/set-state-in-effect --
     Precios retail: mismo patrón que Catálogo — reset de página al cambiar filtros y recarga del listado. */
  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    setPage(0)
  }, [debouncedSearch, retailerFilter, unlinkedOnly])
  /* eslint-enable react-hooks/set-state-in-effect */

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
  const pickerDebounced = useDebouncedValue(pickerQ, 300)
  const [pickerOptions, setPickerOptions] = useState<{ id: string; name: string }[]>([])
  const [pickerBusy, setPickerBusy] = useState(false)

  const categoriesInSection = useMemo(() => {
    const sec =
      sectionForMatch === 'all' ? null : sectionForMatch
    const list = sec
      ? categories.filter((c) => c.section_id === sec)
      : categories
    return [...list].sort((a, b) =>
      a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
    )
  }, [categories, sectionForMatch])

  useEffect(() => {
    async function loadCandidates() {
      if (!homologRow) {
        setCandidates([])
        return
      }
      setCandidatesBusy(true)
      const cat =
        categoryForMatchId && categoryForMatchId.length > 0 ?
          categoryForMatchId
        : null
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
      if (normalizeSearchText(pickerDebounced).length < 2) {
        setPickerOptions([])
        return
      }
      setPickerBusy(true)
      const res = await searchCatalogProductsForPickerAction(pickerDebounced, true)
      setPickerBusy(false)
      if (!res.ok || !Array.isArray(res.rows)) setPickerOptions([])
      else setPickerOptions(res.rows)
    }
    void pick()
  }, [homologOpen, pickerDebounced])

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
    void reload()
  }

  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyRow, setHistoryRow] = useState<RetailListingRow | null>(null)
  const [historyRows, setHistoryRows] = useState<RetailHistoryRow[]>([])
  const [historyBusy, setHistoryBusy] = useState(false)

  const [captureOpen, setCaptureOpen] = useState(false)
  const [captureRetailer, setCaptureRetailer] = useState<CaptureRetailer>('jumbo')
  const [captureQuery, setCaptureQuery] = useState('')
  const [captureMax, setCaptureMax] = useState(40)
  const [captureWebBusy, setCaptureWebBusy] = useState(false)
  const [jsonImportText, setJsonImportText] = useState('')
  const [jsonBaseUrl, setJsonBaseUrl] = useState('')
  const [jsonBusy, setJsonBusy] = useState(false)
  /** Si el barrido cayó por endpoints muertos / red, este texto se muestra en el modal como alerta. */
  const [captureFallbackReason, setCaptureFallbackReason] = useState<string | null>(null)

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
    void reload()
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
    void reload()
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
    void reload()
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
      `Recaptura: ${res.inserted} precios nuevos · procesados ${res.processedLinks} vínculos · sin título ${res.skippedNoTitle} · sin coincidencia ${res.skippedNoMatch} · fallo red/API ${res.skippedFetch}`,
    )
    void reload()
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
    void reload()
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
    void reload()
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
      // Caso "endpoints muertos" o problema irrecuperable: abrir modal de importación JSON
      // y marcar fallback para que la UI guíe al usuario directo al área de JSON.
      if ('suggestJsonImport' in res && res.suggestJsonImport) {
        setCaptureRetailer(storeForCapture)
        setCaptureFallbackReason(res.error)
        // Evita URL de otra cadena o sesión anterior; el servidor envía base cuando la conoce.
        setJsonBaseUrl(res.suggestedJsonBaseUrl ?? '')
        setCaptureOpen(true)
      } else {
        setCaptureFallbackReason(null)
      }
      return
    }
    setLastSweepSummary(res)
    setSweepSummaryOpen(true)
    toast.success(
      formatRetailImportToast(
        `Barrido listo: ${res.inserted} ítems nuevos en historial · ${res.pagesFetched} páginas · homologación nombre exacto ${res.exactTitleLinked} · similitud ${res.autoLinked}${(res.autoLinkedByAi ?? 0) > 0 ? ` (${res.autoLinkedByAi} con OpenRouter)` : ''}. Abre el resumen para el detalle.`,
        res,
      ),
      { duration: 9000 },
    )
    void reload()
  }

  return (
    <div className="space-y-4">
      <CatalogTabHeader
        title="Precios por cadena"
        description="Último precio por ítem de cada cadena. Homologar enlaza la captura al producto maestro."
      />

      {listLoadError ?
        <div
          role="alert"
          className="flex gap-2 rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{listLoadError}</span>
        </div>
      : null}

      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <p className="text-[13px] font-medium text-foreground">Nutrir desde una tienda</p>
        <p className="mt-2 max-w-2xl text-[12px] leading-snug text-muted-foreground">
          Descarga precios de la tienda y guarda historial. Luego el sistema propone vínculos al catálogo maestro de
          forma automática; si en el servidor tienes activada la homologación con IA (misma clave OpenRouter que las
          boletas), ayuda a cerrar ítems que quedaron sin coincidencia clara.
        </p>
        {retailerDefinition(storeForCapture)?.code === 'central_mayorista' ?
          <div
            role="status"
            className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-foreground"
          >
            <TriangleAlert className="mr-2 inline size-4 text-amber-600" aria-hidden />
            Sin{' '}
            <code className="rounded bg-muted px-1 font-mono text-[11px]">
              RETAIL_CENTRAL_MAYORISTA_VTEX_BASE_URL
            </code>{' '}
            en el servidor no corre la captura web de esta cadena.
          </div>
        : null}
        {retailerDefinition(storeForCapture)?.code === 'lider' ?
          <div
            role="note"
            className="mt-3 rounded-md border border-sky-500/35 bg-sky-500/10 px-3 py-2 text-[12px] leading-snug text-foreground"
          >
            <strong className="font-medium">Muchos productos:</strong> usa la importación masiva desde la carpeta{' '}
            <span className="font-mono text-[11px]">lider/</span> (ver documentación del repo). Lo de abajo es solo una
            muestra en vivo por la web.
          </div>
        : null}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[180px] space-y-1.5">
            <Label className="text-[12px]">Tienda</Label>
            <Select
              value={storeForCapture}
              onValueChange={(v) => {
                const code = v as CaptureRetailer
                setStoreForCapture(code)
                setRetailerFilter(code)
                setPage(0)
              }}
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
            <Label className="text-[12px]">
              {storeForCapture === 'lider' ? 'Término de barrido (web en vivo)' : 'Término de barrido (tienda)'}
            </Label>
            <Input
              className="app-input h-9 font-mono text-[13px]"
              placeholder="Vacío = «a» · ej.: a, de, la"
              value={sweepSearchTerm}
              onChange={(e) => setSweepSearchTerm(e.target.value)}
              title="Palabra que usa el buscador de la tienda en esta corrida. Si está vacío, el sistema usa «a»."
              aria-label={
                storeForCapture === 'lider'
                  ? 'Palabra para el barrido web en vivo'
                  : 'Palabra para el barrido en la tienda seleccionada'
              }
            />
            <p className="text-[11px] text-muted-foreground">
              Palabra del buscador; vacío = «a». Si no hay resultados, prueba los botones de abajo.
            </p>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => setSweepSearchTerm('a')}
                title="Recomendado por defecto en servidor"
              >
                a
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => setSweepSearchTerm('de')}
              >
                de
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[11px]"
                title="Sílaba común para ampliar resultados"
                onClick={() => setSweepSearchTerm('la')}
              >
                la
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px] text-muted-foreground"
                onClick={() => setSweepSearchTerm('')}
              >
                Limpiar
              </Button>
            </div>
          </div>
          <label className="flex max-w-[220px] cursor-pointer items-start gap-2 pb-1 text-[13px] leading-snug">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-input"
              checked={captureEntireCatalog}
              onChange={(e) => setCaptureEntireCatalog(e.target.checked)}
            />
            <span>
              Barrido completo
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                Desmarcado: puedes poner un máximo de ítems.
              </span>
            </span>
          </label>
          {!captureEntireCatalog ?
            <div className="min-w-[120px] space-y-1.5">
              <Label className="text-[12px]">Máximo de ítems</Label>
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
            className="h-9 gap-2"
            disabled={sweepBusy}
            title="Descarga paginada desde la tienda elegida (si el sitio lo permite)."
            onClick={() => void submitCatalogSweep()}
          >
            {sweepBusy ?
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Capturando…
              </>
            : <>
                <CloudDownload className="h-4 w-4" aria-hidden />
                Capturar catálogo de esta tienda
              </>
            }
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-9"
            onClick={() => {
              setCaptureRetailer(storeForCapture)
              setCaptureFallbackReason(null)
              setCaptureOpen(true)
            }}
          >
            JSON o búsqueda puntual
          </Button>
        </div>
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
          <div className="flex min-w-[min(100%,320px)] flex-[2] flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1 space-y-1.5">
              <Label className="text-[12px]">Buscar</Label>
              <Input
                className="app-input h-9"
                placeholder="Nombre, referencia, categoría o descripción del ítem…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-9 shrink-0 gap-1.5"
              disabled={recaptureBusy || retailerFilter === 'all'}
              title={
                retailerFilter === 'all'
                  ? 'Elige una cadena arriba para recapturar solo esa tienda.'
                  : 'Vuelve a consultar la tienda por cada ítem ya homologado (misma referencia) y guarda precios nuevos en el historial.'
              }
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
              className="h-9 min-w-[200px] shrink-0 gap-1.5"
              disabled={exactBulkBusy || autoAssocBusy || retailerFilter === 'all'}
              title={
                retailerFilter === 'all'
                  ? 'Elige una cadena para homologar por nombre exacto.'
                  : 'Recorre todas las capturas sin vínculo de esta cadena y enlaza cuando el título coincide con un único maestro (normalización igual que el catálogo).'
              }
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
              className="h-9 min-w-[200px] shrink-0 gap-1.5"
              disabled={autoAssocBusy || exactBulkBusy}
              title="Propone vínculos al catálogo maestro para las filas sin homologar de esta lista."
              onClick={() => void submitAutoAssociate()}
            >
              {autoAssocBusy ?
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              : <Link2 className="h-4 w-4" aria-hidden />}
              Asociar automático
            </Button>
          </div>
        </div>
        <p className="mt-3 text-[12px] text-muted-foreground">
          Cada corrida suma filas al historial de precios de ese ítem en la cadena.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 0 || loading}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          Anterior
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasNext || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          Siguiente
        </Button>
        <span>
          Página {page + 1} · Tamaño {CATALOG_GRID_PAGE_SIZE}
          {total !== null ? ` · Total filtrado: ${total}` : null}
        </span>
      </div>

      <div className="relative overflow-x-auto rounded-lg border border-border bg-card">
        {loading ? (
          <p className="border-b border-border bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
            Cargando…
          </p>
        ) : null}
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
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                  No hay capturas retail. Usa «Capturar catálogo de esta tienda» arriba o revisa permisos y configuración del servidor.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={`${row.retailer}:${row.external_ref}`} className="border-b border-border last:border-0">
                  <td className="p-3 text-[13px] font-medium">{retailerLabel(row.retailer)}</td>
                  <td className="max-w-[280px] p-3 text-[13px] leading-snug">
                    <div>{row.title}</div>
                    {row.description_hint ? (
                      <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                        {row.description_hint}
                      </div>
                    ) : null}
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
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={homologOpen} onOpenChange={setHomologOpen}>
        <DialogContent className="max-h-[min(90vh,720px)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Homologar a catálogo maestro</DialogTitle>
            <DialogDescription>
              Elige el producto canónico que corresponde a este ítem de tienda. Puedes afinar sugerencias con
              sección/categoría del catálogo (nombre similar + rubro + precio de referencia).
            </DialogDescription>
          </DialogHeader>

          {homologRow ? (
            <div className="space-y-3 text-[13px]">
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <p className="font-medium text-foreground">{homologRow.title}</p>
                <p className="mt-1 text-muted-foreground">
                  {retailerLabel(homologRow.retailer)} · ${Number(homologRow.price).toFixed(0)}
                </p>
                {homologRow.category_hint ? (
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    Origen: {homologRow.category_hint}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <SectionSearchCombo
                  label="Filtrar sugerencias — sección"
                  sections={sections}
                  value={
                    sectionForMatch === '' || sectionForMatch === 'all' ? 'all' : sectionForMatch
                  }
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
                {candidatesBusy ? (
                  <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Calculando…
                  </p>
                ) : candidates.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">Sin sugerencias con estos filtros.</p>
                ) : (
                  <ul className="max-h-44 space-y-1 overflow-auto rounded-md border border-border p-2">
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
                )}
              </div>

              <div className="space-y-2 border-t border-border pt-3">
                <Label className="text-[12px]">Buscar maestro manualmente (≥2 caracteres)</Label>
                <Input
                  className="app-input"
                  placeholder="Nombre en catálogo…"
                  value={pickerQ}
                  onChange={(e) => setPickerQ(e.target.value)}
                />
                {normalizeSearchText(pickerQ).length > 0 &&
                normalizeSearchText(pickerQ).length < 2 ? (
                  <p className="text-[12px] text-muted-foreground">
                    Escribe al menos 2 caracteres para buscar.
                  </p>
                ) : null}
                {pickerBusy ? (
                  <p className="text-[12px] text-muted-foreground">Buscando…</p>
                ) : null}
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
          ) : null}

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
          {historyBusy ? (
            <p className="text-[13px] text-muted-foreground">Cargando…</p>
          ) : (
            <div className="max-h-64 overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left">
                    <th className="p-2 font-medium">Fecha</th>
                    <th className="p-2 font-medium">Precio</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="p-4 text-muted-foreground">
                        Sin datos.
                      </td>
                    </tr>
                  ) : (
                    historyRows.map((h, i) => (
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
                  )}
                </tbody>
              </table>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setHistoryOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={captureOpen}
        onOpenChange={(next) => {
          setCaptureOpen(next)
          if (!next) setCaptureFallbackReason(null)
        }}
      >
        <DialogContent className="max-h-[min(92vh,760px)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {captureFallbackReason ?
                'Importación manual recomendada'
              : 'Otras formas de importar'}
            </DialogTitle>
            <DialogDescription>
              {captureFallbackReason ?
                'La captura automática no pudo continuar. Pega en «Importar desde JSON» la respuesta de red que copiaste desde las herramientas de desarrollo del navegador (Network), si la tienda la expone (está arriba en este cuadro).'
              : 'Búsqueda por término (una página) o pegado de JSON copiado desde el navegador. Para muchos productos conviene «Capturar catálogo de esta tienda» fuera de este cuadro. Requiere rol editor y clave de servicio en el servidor.'}
            </DialogDescription>
          </DialogHeader>

          {captureFallbackReason ?
            <div
              role="alert"
              className="flex gap-2 rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2.5 text-[12px] text-destructive"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{captureFallbackReason}</span>
            </div>
          : null}

          <div className="space-y-4 text-[13px]">
            <div className="space-y-1.5">
              <Label className="text-[12px]">Cadena</Label>
              <Select
                value={captureRetailer}
                onValueChange={(v) => setCaptureRetailer(v as CaptureRetailer)}
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
              {captureRetailer === 'lider' ?
                <p className="text-[11px] text-muted-foreground">
                  Lider en la app lee la página (mismo enfoque que el proyecto en{' '}
                  <span className="font-mono text-[10px]">lider/</span>
                  ), no el mismo conector que otras cadenas del listado. Por defecto{' '}
                  <span className="font-mono text-[10px]">https://super.lider.cl</span>. Volumen masivo: scraper →
                  archivo local → <span className="font-mono text-[10px]">import_retail_snapshots.py</span> (ver{' '}
                  <span className="font-mono text-[10px]">scripts/RETAIL_CAPTURE.md</span>).
                </p>
              : captureRetailer === 'central_mayorista' ?
                <p className="text-[11px] text-muted-foreground">
                  Barrido por API del sitio: configura{' '}
                  <span className="font-mono text-[10px]">RETAIL_CENTRAL_MAYORISTA_VTEX_BASE_URL</span> en el servidor
                  o usa importación JSON.
                </p>
              : null}
            </div>

            {captureFallbackReason ?
              <>
                <div className="rounded-md border border-border p-3">
                  <p className="mb-2 text-[12px] font-medium text-foreground">Importar desde JSON</p>
                  <p className="mb-2 text-[11px] text-muted-foreground">
                    Pega JSON desde DevTools → Network, o un fragmento HTML del listado si la tienda solo publica datos
                    en la página (schema.org / JSON-LD). La URL base ayuda a enlaces canónicos.
                  </p>
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
                        className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[160px] w-full rounded-md border px-3 py-2 text-[13px] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
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
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Importando…
                        </>
                      : 'Importar JSON'}
                    </Button>
                  </div>
                </div>

                <div className="rounded-md border border-dashed border-border/70 bg-muted/10 p-3">
                  <p className="mb-1 text-[12px] font-medium text-muted-foreground">
                    Búsqueda en la tienda (opcional)
                  </p>
                  <p className="mb-2 text-[11px] text-muted-foreground">
                    Desde el servidor suele fallar igual que el barrido; úsala solo si quieres probar un término
                    puntual.
                  </p>
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
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Importando…
                        </>
                      : <>
                          <CloudDownload className="h-4 w-4" aria-hidden /> Buscar e importar
                        </>
                      }
                    </Button>
                  </div>
                </div>
              </>
            : <>
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <p className="mb-2 text-[12px] font-medium text-foreground">Búsqueda en la tienda</p>
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
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Importando…
                        </>
                      : <>
                          <CloudDownload className="h-4 w-4" aria-hidden /> Buscar e importar
                        </>
                      }
                    </Button>
                  </div>
                </div>

                <div className="rounded-md border border-border p-3">
                  <p className="mb-2 text-[12px] font-medium text-foreground">Importar desde JSON</p>
                  <p className="mb-2 text-[11px] text-muted-foreground">
                    Pega JSON desde Network o HTML del listado con JSON-LD. Opcional: URL base para enlaces
                    canónicos.
                  </p>
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
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Importando…
                        </>
                      : 'Importar JSON'}
                    </Button>
                  </div>
                </div>
              </>
            }
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCaptureOpen(false)
                setCaptureFallbackReason(null)
              }}
            >
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {sweepBusy ?
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-4"
          role="progressbar"
          aria-busy="true"
          aria-label="Capturando catálogo de la tienda"
        >
          <div className="max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
            <div className="flex items-start gap-3">
              <Loader2 className="mt-0.5 h-8 w-8 shrink-0 animate-spin text-primary" aria-hidden />
              <div>
                <p className="text-[14px] font-semibold text-foreground">Capturando catálogo…</p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  {retailerLabel(storeForCapture)} · «{sweepSearchTerm.trim() || 'a'}» ·{' '}
                  {captureEntireCatalog ? 'hasta acabar el listado' : `máx. ${sweepMax} ítems`}
                </p>
              </div>
            </div>
            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full w-[35%] max-w-full animate-pulse rounded-full bg-primary" />
            </div>
            <p className="mt-4 text-[12px] text-muted-foreground">
              Puede tardar; al final verás un resumen.
            </p>
          </div>
        </div>
      : null}

      <Dialog open={sweepSummaryOpen} onOpenChange={setSweepSummaryOpen}>
        <DialogContent className="max-h-[min(92vh,680px)] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Resumen del barrido</DialogTitle>
            <DialogDescription>Resultado de la última captura.</DialogDescription>
          </DialogHeader>
          {lastSweepSummary ?
            <div className="space-y-4 text-[13px]">
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-[12px]">
                <dt className="text-muted-foreground">Cadena</dt>
                <dd className="text-right font-medium">
                  {retailerLabel(lastSweepSummary.retailer)}
                </dd>
                <dt className="text-muted-foreground">URL base usada</dt>
                <dd className="break-all text-right font-mono text-[11px]">
                  {lastSweepSummary.vtexBaseUrlUsed}
                </dd>
                <dt className="text-muted-foreground">Término de barrido efectivo</dt>
                <dd className="text-right font-mono text-[11px]">
                  {lastSweepSummary.effectiveSweepTerm}
                </dd>
                <dt className="text-muted-foreground">Tope de esta corrida</dt>
                <dd className="text-right">
                  {lastSweepSummary.captureAll ?
                    <span>
                      Hasta fin de catálogo{' '}
                      <span className="text-muted-foreground">(tope seguridad 1.000.000)</span>
                    </span>
                  : <span>Máximo {lastSweepSummary.maxTotalLimit} ítems</span>}
                </dd>
                <dt className="text-muted-foreground">Páginas descargadas</dt>
                <dd className="text-right">{lastSweepSummary.pagesFetched}</dd>
                <dt className="text-muted-foreground">Ítems nuevos guardados</dt>
                <dd className="text-right font-semibold">{lastSweepSummary.inserted}</dd>
                <dt className="text-muted-foreground">Nombre exacto</dt>
                <dd className="text-right">{lastSweepSummary.exactTitleLinked}</dd>
                <dt className="text-muted-foreground">Enlaces automáticos (reglas)</dt>
                <dd className="text-right">
                  {Math.max(0, lastSweepSummary.autoLinked - (lastSweepSummary.autoLinkedByAi ?? 0))}
                </dd>
                <dt className="text-muted-foreground">Enlaces con IA</dt>
                <dd className="text-right">{lastSweepSummary.autoLinkedByAi ?? 0}</dd>
                <dt className="text-muted-foreground">Total enlaces automáticos</dt>
                <dd className="text-right">{lastSweepSummary.autoLinked}</dd>
                <dt className="text-muted-foreground">Sin vínculo tras esta pasada</dt>
                <dd className="text-right">{lastSweepSummary.autoAssociateSkippedNoMatch}</dd>
              </dl>
              {(lastSweepSummary.stoppedEarly || lastSweepSummary.hitSafetyItemCap) ?
                <p className="rounded-md bg-muted/60 px-2 py-1.5 text-[11px] text-muted-foreground">
                  {lastSweepSummary.hitSafetyItemCap ?
                    'Se alcanzó el tope de seguridad de ítems por ejecución.'
                  : 'La descarga terminó antes de tiempo (red o tienda sin más páginas).'}
                </p>
              : null}
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
