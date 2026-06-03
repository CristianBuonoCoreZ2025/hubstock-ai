'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, GitMerge, Minus, Pencil, CheckCheck } from 'lucide-react'
import { toast } from 'sonner'
import { requestLogger } from '@/lib/request-logger'
import {
  CatalogFilterCombo,
  CatalogProductsTableSkeleton,
  CatalogSearchBox,
  CatalogTabHeader,
  GridLoadingMask,
  SectionSearchCombo,
} from '@/app/(app)/catalog/catalog-ui'
import { CopyCatalogButton } from '@/components/catalog/CopyCatalogButton'
import {
  createCatalogAliasAction,
  createCatalogProductAction,
  createCategoryAction,
  createSectionAction,
  fetchCatalogAliasesPage,
  fetchCatalogBrandsPage,
  fetchCatalogCategoriesPage,
  fetchCatalogProductFilterOptions,
  fetchCatalogProductsPage,
  fetchProductsByBrandPage,
  fetchProductsByCategoryPage,
  searchCatalogBrandsAction,
  searchCatalogCategoriesAction,
  searchCatalogProductsForPickerAction,
  setCatalogProductActiveAction,
  updateCatalogBrandAction,
  updateCatalogProductAction,
  mergeCatalogBrandsAction,
  updateCategoryAction,
  type AliasPageRow,
  type CatalogBrandGridRow,
  type CatalogCategoryGridRow,
  type CatalogProductGridRow,
  type CatalogProductInput,
} from '@/app/actions/catalog'
import { fetchMissingCatalogImagesAction } from '@/app/actions/catalog-images'
import { normalizeCatalogAlias } from '@/lib/catalog-alias'
import { CATALOG_GRID_PAGE_SIZE } from '@/lib/catalog-grid'
import { GridPagingRow } from '@/components/grid/grid-paging-row'
import { GridRowIconButton } from '@/components/grid/grid-row-icon-button'
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
import { normalizeSearchText } from '@/lib/search'
import { cn } from '@/lib/utils'

export type CatalogProductRow = CatalogProductGridRow
export type CatalogBrandRow = { id: string; name: string }
export type SectionRow = { id: string; name: string; sort_order: number }
export type CategoryRow = {
  id: string
  name: string
  section_id: string
  sort_order: number
}

type TabKey = 'products' | 'brands' | 'categories'
function CatalogProductQuickActions({
  row,
  onEdit,
  onToggleRequest,
}: {
  row: CatalogProductGridRow
  onEdit: () => void
  onToggleRequest: () => void
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <GridRowIconButton
        label="Editar producto"
        className="btn-sky"
        size="icon-sm"
        onClick={onEdit}
      >
        <Pencil className="size-3.5" aria-hidden />
      </GridRowIconButton>
      <GridRowIconButton
        label={row.active ? 'Desactivar producto' : 'Activar producto'}
        className={row.active ? 'btn-danger' : 'btn-save'}
        size="icon-sm"
        onClick={onToggleRequest}
      >
        {row.active
          ? <Minus className="size-3.5" strokeWidth={2.5} aria-hidden />
          : <Check className="size-3.5" strokeWidth={2.5} aria-hidden />
        }
      </GridRowIconButton>
    </div>
  )
}

const TAB_QUERY: Record<TabKey, string> = {
  products: 'productos',
  brands: 'marcas',
  categories: 'categorias',
}

const QUERY_TO_TAB = new Map<string, TabKey>([
  ['productos', 'products'],
  ['marcas', 'brands'],
  ['categorias', 'categories'],
])

function tabFromUrl(tabParam: string | null): TabKey {
  if (!tabParam) return 'products'
  return QUERY_TO_TAB.get(tabParam) ?? 'products'
}

/** Columna Lider: última captura homologada; si no hay, precio ref. del import masivo Lider. */
function formatRetailLiderCell(row: CatalogProductGridRow): string {
  if (row.retail_price_lider != null) return `$${Number(row.retail_price_lider).toFixed(0)}`
  if (row.source_system === 'lider_sqlite' && row.default_reference_price != null) {
    return `$${Number(row.default_reference_price).toFixed(0)}`
  }
  return '—'
}

function formatRetailJumboCell(row: CatalogProductGridRow): string {
  return row.retail_price_jumbo != null ? `$${Number(row.retail_price_jumbo).toFixed(0)}` : '—'
}

function formatRetailCentralMayoristaCell(row: CatalogProductGridRow): string {
  return row.retail_price_central_mayorista != null
    ? `$${Number(row.retail_price_central_mayorista).toFixed(0)}`
    : '—'
}

const emptyProductInput = (): CatalogProductInput => ({
  name: '',
  section_id: '',
  category_id: '',
  brand_id: null,
  brand: null,
  format: null,
  unit: null,
  default_reference_price: null,
  active: true,
})

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

function GridInactiveNote({ entity }: { entity: string }) {
  return (
    <p className="text-[12px] text-muted-foreground">
      <strong>{entity}</strong> no tiene columna equivalente a &quot;activo&quot; en la base vigente:
      aquí solo aplica Mostrar inactivos a <strong>productos del catálogo</strong>.
    </p>
  )
}

/** Producto remoto (alias / modales). */
function ProductRemotePick(props: {
  label: string
  valueId: string
  activeOnly?: boolean
  onClear: () => void
  onPick: (id: string, name: string) => void
  displayName?: string | null
}) {
  const { label, valueId, onClear, onPick, displayName, activeOnly = true } = props
  const [q, setQ] = useState('')
  const dq = useDebouncedValue(q, 300)
  const [busy, setBusy] = useState(false)
  const [options, setOptions] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    async function load() {
      if (normalizeSearchText(dq).length < 2) {
        setOptions([])
        return
      }
      setBusy(true)
      const res = await searchCatalogProductsForPickerAction(dq, activeOnly)
      setBusy(false)
      if (!res.ok || !Array.isArray(res.rows)) setOptions([])
      else setOptions(res.rows)
    }
    void load()
  }, [dq, activeOnly])

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {valueId ? (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          <span>
            Selección: <strong className="text-foreground">{displayName ?? '—'}</strong>
          </span>
          <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={onClear}>
            Limpiar
          </Button>
        </div>
      ) : null}
      <Input
        className="app-input"
        placeholder="Escribe ≥2 caracteres para buscar producto…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {normalizeSearchText(q).length > 0 && normalizeSearchText(q).length < 2 ? (
        <p className="text-[12px] text-muted-foreground">Escribe al menos 2 caracteres para buscar.</p>
      ) : null}
      {busy ? <p className="text-[12px] text-muted-foreground">Buscando…</p> : null}
      <ul className="max-h-52 overflow-auto rounded-md border border-border bg-card text-[13px]">
        {options.map((o) => (
          <li key={o.id} className="border-b border-border last:border-0">
            <button
              type="button"
              className="w-full px-2 py-1.5 text-left hover:bg-muted"
              onClick={() => onPick(o.id, o.name)}
            >
              {o.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Marca dentro del modal producto — solo búsqueda remota (sin precargar marcas). */
function ProductDialogBrandPick(props: {
  brandId: string | null
  /** Para edición: nombre visible mientras escribes nueva búsqueda. */
  knownBrandName?: string | null
  onBrandId: (id: string | null, pickedName?: string | null) => void
}) {
  const [q, setQ] = useState('')
  const dq = useDebouncedValue(q, 300)
  const [busy, setBusy] = useState(false)
  const [options, setOptions] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    async function load() {
      if (normalizeSearchText(dq).length < 2) {
        setOptions([])
        return
      }
      setBusy(true)
      const res = await searchCatalogBrandsAction(dq)
      setBusy(false)
      if (!res.ok) setOptions([])
      else setOptions(res.rows)
    }
    void load()
  }, [dq])

  const display = !props.brandId
    ? 'Sin marca'
    : (options.find((o) => o.id === props.brandId)?.name ??
        props.knownBrandName ??
        '(marca)')

  return (
    <div className="space-y-1.5">
      <Label>Marca canónica (opcional)</Label>
      <p className="text-[12px] text-muted-foreground">
        Actual: <span className="font-medium text-foreground">{display}</span>
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => props.onBrandId(null, null)}>
          Quitar marca
        </Button>
      </div>
      <Input
        className="app-input"
        placeholder="Buscar marca (≥2 caracteres) para asignar"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {busy ? <p className="text-[12px] text-muted-foreground">Buscando…</p> : null}
      <div className="max-h-40 overflow-auto rounded-md border border-border">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className="block w-full px-2 py-1 text-left text-[13px] hover:bg-muted"
            onClick={() => {
              props.onBrandId(o.id, o.name)
              setQ('')
              setOptions([])
            }}
          >
            {o.name}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        No se precargan marcas completas; máx. 50 resultados por búsqueda.
      </p>
    </div>
  )
}

/** Categoría en modal producto cuando la sección es conocida — búsqueda remota. */
function ProductDialogCategoryPick(props: {
  categories: CategoryRow[]
  sections: SectionRow[]
  sectionId: string
  categoryId: string
  onCategoryId: (id: string) => void
}) {
  const { sectionId, categoryId, onCategoryId } = props
  const secName = props.sections.find((s) => s.id === sectionId)?.name ?? '—'

  const [q, setQ] = useState('')
  const dq = useDebouncedValue(q, 300)
  const [busy, setBusy] = useState(false)
  const [options, setOptions] = useState<{ id: string; name: string; section_id: string }[]>([])

  useEffect(() => {
    async function load() {
      if (!sectionId || normalizeSearchText(dq).length < 2) {
        setOptions([])
        return
      }
      setBusy(true)
      const res = await searchCatalogCategoriesAction(dq, sectionId)
      setBusy(false)
      setOptions(!res.ok ? [] : res.rows)
    }
    void load()
  }, [dq, sectionId])

  const fallbackName = props.categories.find((c) => c.id === categoryId)?.name ?? 'Seleccionada'

  return (
    <div className="space-y-1.5">
      <Label>Categoría (sección: {secName})</Label>
      <Select value={categoryId || undefined} onValueChange={(v) => onCategoryId(v)}>
        <SelectTrigger className="app-input">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {props.categories
            .filter((c) => c.section_id === sectionId)
            .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
            .slice(0, 30)
            .map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          {/* Si la selección está fuera de las 30 primeras, mantener entrada */}
          {categoryId &&
          !props.categories
            .filter((c) => c.section_id === sectionId)
            .slice(0, 30)
            .some((c) => c.id === categoryId) ? (
            <SelectItem value={categoryId}>{fallbackName}</SelectItem>
          ) : null}
        </SelectContent>
      </Select>
      <Input
        className="app-input"
        placeholder={`Buscar categoría (${secName}), ≥2 caracteres`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {normalizeSearchText(q).length >= 2 && busy ? (
        <p className="text-[12px] text-muted-foreground">Buscando…</p>
      ) : null}
      <div className="max-h-40 overflow-auto rounded-md border border-border">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className="block w-full px-2 py-1 text-left text-[13px] hover:bg-muted"
            onClick={() => {
              onCategoryId(o.id)
              setQ('')
              setOptions([])
            }}
          >
            {o.name}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Listado rápido (30) por sección; búsqueda remota hasta 50 resultados.
      </p>
    </div>
  )
}

/** Búsqueda remota para unificar marcas en modal «Unir». */
function MergeBrandSearchPick(props: {
  label: string
  valueId: string
  displayName: string | null
  /** Evita seleccionar la misma marca en el segundo combo. */
  excludeId?: string
  onPick: (id: string, name: string) => void
  onClear: () => void
}) {
  const { label, valueId, displayName, excludeId, onPick, onClear } = props
  const [q, setQ] = useState('')
  const dq = useDebouncedValue(q, 300)
  const [busy, setBusy] = useState(false)
  const [options, setOptions] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    async function load() {
      if (normalizeSearchText(dq).length < 2) {
        setOptions([])
        return
      }
      setBusy(true)
      const res = await searchCatalogBrandsAction(dq)
      setBusy(false)
      if (!res.ok) setOptions([])
      else setOptions(res.rows.filter((o) => !excludeId || o.id !== excludeId))
    }
    void load()
  }, [dq, excludeId])

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {valueId ? (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          <span>
            Selección: <strong className="text-foreground">{displayName ?? '—'}</strong>
          </span>
          <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={onClear}>
            Quitar
          </Button>
        </div>
      ) : null}
      <Input
        className="app-input"
        placeholder="Buscar marca (≥2 caracteres)…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {normalizeSearchText(q).length > 0 && normalizeSearchText(q).length < 2 ? (
        <p className="text-[12px] text-muted-foreground">Escribe al menos 2 caracteres para buscar.</p>
      ) : null}
      {busy ? <p className="text-[12px] text-muted-foreground">Buscando…</p> : null}
      <ul className="max-h-40 overflow-auto rounded-md border border-border text-[13px]">
        {options.map((o) => (
          <li key={o.id} className="border-b border-border last:border-0">
            <button
              type="button"
              className="w-full px-2 py-1.5 text-left hover:bg-muted"
              onClick={() => {
                onPick(o.id, o.name)
                setQ('')
                setOptions([])
              }}
            >
              {o.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function CatalogTabs(props: {
  profileId: string
  sections: SectionRow[]
  categories: CategoryRow[]
  linkedCatalogCount: number
  countError: boolean
}) {
  /* eslint-disable react-hooks/set-state-in-effect --
     Catálogo: efectos sincronizan paginación, filtros y cargas remotas de grillas grandes. */

  const { profileId, sections, categories, linkedCatalogCount, countError } = props

  const router = useRouter()
  const searchParams = useSearchParams()

  const sectionsSorted = useMemo(() => {
    return [...sections].sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
      return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
    })
  }, [sections])

  const tab = useMemo(
    () => tabFromUrl(searchParams.get('tab')),
    [searchParams]
  )

  function goToTab(next: TabKey) {
    router.replace(`/catalog?tab=${TAB_QUERY[next]}`, { scroll: false })
  }

  const sectionById = useMemo(
    () => new Map(sections.map((s) => [s.id, s])),
    [sections]
  )

  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  )

  const [productSearch, setProductSearch] = useState('')
  const [productSearchSubmitted, setProductSearchSubmitted] = useState('')
  const [sectionFilter, setSectionFilter] = useState<string>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [categoryFilterLabel, setCategoryFilterLabel] = useState<string | null>(null)
  const [brandFilter, setBrandFilter] = useState<string>('all')
  const [brandFilterLabel, setBrandFilterLabel] = useState<string | null>(null)

  const [showInactiveProducts, setShowInactiveProducts] = useState(false)
  const [productPage, setProductPage] = useState(0)
  const [productRows, setProductRows] = useState<CatalogProductGridRow[]>([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [productsTotal, setProductsTotal] = useState<number | null>(null)
  const [productsHasNext, setProductsHasNext] = useState(false)
  const [productsTruncated, setProductsTruncated] = useState(false)

  const [productFilterSections, setProductFilterSections] = useState<
    { id: string; name: string }[]
  >([])
  const [productFilterCategories, setProductFilterCategories] = useState<
    { id: string; name: string }[]
  >([])
  const [productFilterBrands, setProductFilterBrands] = useState<{ id: string; name: string }[]>([])
  const [productFilterOptionsLoading, setProductFilterOptionsLoading] = useState(false)

  const productsFetchSeq = useRef(0)
  const isReloadingRef = useRef(false)

  const reloadProducts = useCallback(async () => {
    if (isReloadingRef.current) return
    isReloadingRef.current = true
    return await requestLogger.traceAsyncMethod('reloadProducts', async () => {
      try {
        const seq = ++productsFetchSeq.current
        setProductsLoading(true)
        const res = await fetchCatalogProductsPage({
          page: productPage,
          includeInactive: showInactiveProducts,
          sectionId: sectionFilter,
          categoryId: categoryFilter,
          brandId: brandFilter,
          search: productSearchSubmitted,
        })
        if (seq !== productsFetchSeq.current) return
        setProductsLoading(false)
        if (!res.ok) {
          toast.error(res.error ?? 'No logramos cargar los productos. Intenta nuevamente.')
          setProductRows([])
          return
        }
        setProductRows(res.items)
        setProductsTotal(res.total)
        setProductsHasNext(res.hasNextPage)
        setProductsTruncated(Boolean(res.truncated))
      } finally {
        isReloadingRef.current = false
      }
    })
  }, [
    brandFilter,
    categoryFilter,
    productSearchSubmitted,
    productPage,
    sectionFilter,
    showInactiveProducts,
  ])

  const isLoadingOptsRef = useRef(false)
  useEffect(() => {
    if (tab !== 'products') return
    if (isLoadingOptsRef.current) return
    isLoadingOptsRef.current = true
    let cancelled = false
    async function loadOpts() {
      return await requestLogger.traceAsyncMethod('loadOpts', async () => {
        try {
          setProductFilterOptionsLoading(true)
          const res = await fetchCatalogProductFilterOptions({
            search: productSearchSubmitted,
            sectionId: sectionFilter,
            categoryId: categoryFilter,
            brandId: brandFilter,
            includeInactive: showInactiveProducts,
          })
          if (!cancelled) setProductFilterOptionsLoading(false)
          if (cancelled || !res.ok) return
          setProductFilterSections(res.sections)
          setProductFilterCategories(res.categories)
          setProductFilterBrands(res.brands)
        } finally {
          if (!cancelled) isLoadingOptsRef.current = false
        }
      })
    }
    void loadOpts()
    return () => {
      cancelled = true
    }
  }, [
    tab,
    productSearchSubmitted,
    sectionFilter,
    categoryFilter,
    brandFilter,
    showInactiveProducts,
  ])

  useEffect(() => {
    if (tab !== 'products') return
    if (sectionFilter === 'all') return
    if (productFilterSections.some((s) => s.id === sectionFilter)) return
    setSectionFilter('all')
    setCategoryFilter('all')
    setCategoryFilterLabel(null)
    setBrandFilter('all')
    setBrandFilterLabel(null)
  }, [tab, productFilterSections, sectionFilter])

  useEffect(() => {
    if (tab !== 'products') return
    if (categoryFilter === 'all') return
    if (productFilterCategories.some((c) => c.id === categoryFilter)) return
    setCategoryFilter('all')
    setCategoryFilterLabel(null)
    setBrandFilter('all')
    setBrandFilterLabel(null)
  }, [tab, productFilterCategories, categoryFilter])

  useEffect(() => {
    if (tab !== 'products') return
    if (brandFilter === 'all') return
    if (productFilterBrands.some((b) => b.id === brandFilter)) return
    setBrandFilter('all')
    setBrandFilterLabel(null)
  }, [tab, productFilterBrands, brandFilter])

  useEffect(() => {
    setProductPage(0)
  }, [productSearchSubmitted, sectionFilter, categoryFilter, brandFilter, showInactiveProducts])

  const lastProductsFetchKey = useRef<string>('')
  useEffect(() => {
    const key = JSON.stringify({
      page: productPage,
      includeInactive: showInactiveProducts,
      sectionId: sectionFilter,
      categoryId: categoryFilter,
      brandId: brandFilter,
      search: productSearchSubmitted,
    })
    if (key === lastProductsFetchKey.current) return
    lastProductsFetchKey.current = key
    if (isReloadingRef.current) return
    void reloadProducts()
  }, [reloadProducts, productPage, showInactiveProducts, sectionFilter, categoryFilter, brandFilter, productSearchSubmitted])

  const [deactivateProductRow, setDeactivateProductRow] = useState<CatalogProductGridRow | null>(
    null,
  )

  const [productDialogOpen, setProductDialogOpen] = useState(false)
  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  const [productDialogBrandHint, setProductDialogBrandHint] = useState<string | null>(
    null,
  )
  const [productForm, setProductForm] = useState<CatalogProductInput>(emptyProductInput)

  const [brandMergeOpen, setBrandMergeOpen] = useState(false)
  const [brandMergeSurvivorId, setBrandMergeSurvivorId] = useState('')
  const [brandMergeAbsorbedId, setBrandMergeAbsorbedId] = useState('')
  const [brandMergeSurvivorName, setBrandMergeSurvivorName] = useState<string | null>(null)
  const [brandMergeAbsorbedName, setBrandMergeAbsorbedName] = useState<string | null>(null)
  const [brandMergeUnifiedName, setBrandMergeUnifiedName] = useState('')
  const [brandMergeBusy, setBrandMergeBusy] = useState(false)
  const [fetchImagesBusy, setFetchImagesBusy] = useState(false)

  function resetBrandMergeForm() {
    setBrandMergeSurvivorId('')
    setBrandMergeAbsorbedId('')
    setBrandMergeSurvivorName(null)
    setBrandMergeAbsorbedName(null)
    setBrandMergeUnifiedName('')
    setBrandMergeBusy(false)
  }
  const [selectedBrandId, setSelectedBrandId] = useState<string>('all')
  const [selectedBrandName, setSelectedBrandName] = useState<string | null>(null)
  const [brandTabIncludeInactiveProducts, setBrandTabIncludeInactiveProducts] = useState(false)
  const [brandProductsPage, setBrandProductsPage] = useState(0)
  const [brandProductsRows, setBrandProductsRows] = useState<CatalogProductGridRow[]>([])
  const [brandProductsBusy, setBrandProductsBusy] = useState(false)
  const [brandProductsHasNext, setBrandProductsHasNext] = useState(false)

  const [brandListPage, setBrandListPage] = useState(0)
  const [brandListSearch, setBrandListSearch] = useState('')
  const [brandListSearchSubmitted, setBrandListSearchSubmitted] = useState('')
  const [brandListRows, setBrandListRows] = useState<CatalogBrandGridRow[]>([])
  const [brandListTotal, setBrandListTotal] = useState<number | null>(null)
  const [brandListHasNext, setBrandListHasNext] = useState(false)
  const [brandListBusy, setBrandListBusy] = useState(false)

  const [sectionDialogOpen, setSectionDialogOpen] = useState(false)
  const [sectionName, setSectionName] = useState('')
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [catSectionId, setCatSectionId] = useState('')
  const [catName, setCatName] = useState('')

  const [brandEditOpen, setBrandEditOpen] = useState(false)
  const [brandEditId, setBrandEditId] = useState<string | null>(null)
  const [brandEditName, setBrandEditName] = useState('')

  const [categoryEditOpen, setCategoryEditOpen] = useState(false)
  const [categoryEditId, setCategoryEditId] = useState<string | null>(null)
  const [categoryEditName, setCategoryEditName] = useState('')
  const [categoryEditSectionId, setCategoryEditSectionId] = useState('')

  const [aliasProductId, setAliasProductId] = useState('')
  const [aliasProductName, setAliasProductName] = useState<string | null>(null)
  const [aliasText, setAliasText] = useState('')
  const [aliasDialogOpen, setAliasDialogOpen] = useState(false)
  const [aliasRows, setAliasRows] = useState<AliasPageRow[]>([])
  const [aliasPage, setAliasPage] = useState(0)
  const [aliasHasNext, setAliasHasNext] = useState(false)
  const [aliasBusy, setAliasBusy] = useState(false)
  const [aliasTableSearch, setAliasTableSearch] = useState('')
  const [aliasTableSearchSubmitted, setAliasTableSearchSubmitted] = useState('')

  const [categorySectionFilter, setCategorySectionFilter] = useState<string>('all')
  const [categoryGridCategoryFilter, setCategoryGridCategoryFilter] = useState<string>('all')
  const [categoryGridSearch, setCategoryGridSearch] = useState('')
  const [categoryGridSearchSubmitted, setCategoryGridSearchSubmitted] = useState('')
  const [categoryGridPage, setCategoryGridPage] = useState(0)
  const [categoryGridRows, setCategoryGridRows] = useState<CatalogCategoryGridRow[]>([])
  const [categoryGridBusy, setCategoryGridBusy] = useState(false)
  const [categoryGridTotal, setCategoryGridTotal] = useState<number | null>(null)
  const [categoryGridHasNext, setCategoryGridHasNext] = useState(false)
  const [categoryTabIncludeInactiveProducts, setCategoryTabIncludeInactiveProducts] = useState(false)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all')
  const [selectedCategoryLabel, setSelectedCategoryLabel] = useState<string | null>(null)
  const [catProdPage, setCatProdPage] = useState(0)
  const [catProdRows, setCatProdRows] = useState<CatalogProductGridRow[]>([])
  const [catProdBusy, setCatProdBusy] = useState(false)
  const [catProdHasNext, setCatProdHasNext] = useState(false)

  const categoriesScopedByMaintainSection = useMemo(() => {
    if (categorySectionFilter === 'all') return categories
    return categories.filter((c) => c.section_id === categorySectionFilter)
  }, [categories, categorySectionFilter])

  function submitProductSearch() {
    setProductSearchSubmitted(productSearch.trim())
  }

  function submitBrandListSearch() {
    setBrandListSearchSubmitted(brandListSearch.trim())
  }

  function submitCategoryGridSearch() {
    setCategoryGridSearchSubmitted(categoryGridSearch.trim())
  }

  function submitAliasTableSearch() {
    setAliasTableSearchSubmitted(aliasTableSearch.trim())
  }

  useEffect(() => {
    async function load() {
      if (tab !== 'brands') return
      setBrandListBusy(true)
      const res = await fetchCatalogBrandsPage({
        page: brandListPage,
        search: brandListSearchSubmitted,
        productActiveOnly: !brandTabIncludeInactiveProducts,
      })
      setBrandListBusy(false)
      if (!res.ok) {
        toast.error(res.error ?? 'No se pudieron cargar las marcas')
        return
      }
      setBrandListRows(res.items)
      setBrandListTotal(res.total)
      setBrandListHasNext(res.hasNextPage)
    }
    void load()
  }, [tab, brandListPage, brandListSearchSubmitted, brandTabIncludeInactiveProducts])

  useEffect(() => {
    setBrandListPage(0)
  }, [brandListSearchSubmitted, brandTabIncludeInactiveProducts])

  useEffect(() => {
    async function load() {
      if (tab !== 'brands' || selectedBrandId === 'all') {
        setBrandProductsRows([])
        setBrandProductsHasNext(false)
        return
      }
      setBrandProductsBusy(true)
      const res = await fetchProductsByBrandPage({
        page: brandProductsPage,
        brandId: selectedBrandId,
        includeInactive: brandTabIncludeInactiveProducts,
        search: '',
      })
      setBrandProductsBusy(false)
      if (!res.ok) {
        toast.error(res.error ?? 'No se pudieron cargar los productos de la marca')
        setBrandProductsRows([])
        setBrandProductsHasNext(false)
        return
      }
      setBrandProductsRows(res.items)
      setBrandProductsHasNext(res.hasNextPage)
    }
    void load()
  }, [tab, selectedBrandId, brandProductsPage, brandTabIncludeInactiveProducts])

  useEffect(() => {
    setBrandProductsPage(0)
  }, [selectedBrandId, brandTabIncludeInactiveProducts])

  useEffect(() => {
    async function load() {
      if (tab !== 'categories') return
      setCategoryGridBusy(true)
      const res = await fetchCatalogCategoriesPage({
        page: categoryGridPage,
        sectionId: categorySectionFilter,
        categoryId: categoryGridCategoryFilter,
        search: categoryGridSearchSubmitted,
        productActiveOnly: !categoryTabIncludeInactiveProducts,
      })
      setCategoryGridBusy(false)
      if (!res.ok) {
        toast.error(res.error ?? 'No se pudieron cargar las categorías')
        return
      }
      setCategoryGridRows(res.items)
      setCategoryGridTotal(res.total)
      setCategoryGridHasNext(res.hasNextPage)
    }
    void load()
  }, [
    tab,
    categoryGridPage,
    categorySectionFilter,
    categoryGridCategoryFilter,
    categoryGridSearchSubmitted,
    categoryTabIncludeInactiveProducts,
  ])

  useEffect(() => {
    setCategoryGridCategoryFilter('all')
  }, [categorySectionFilter])

  useEffect(() => {
    if (categoryGridCategoryFilter === 'all') return
    const allowed = new Set(categoriesScopedByMaintainSection.map((c) => c.id))
    if (!allowed.has(categoryGridCategoryFilter)) {
      setCategoryGridCategoryFilter('all')
    }
  }, [categoriesScopedByMaintainSection, categoryGridCategoryFilter])

  useEffect(() => {
    setCategoryGridPage(0)
  }, [
    categoryGridSearchSubmitted,
    categorySectionFilter,
    categoryGridCategoryFilter,
    categoryTabIncludeInactiveProducts,
  ])

  useEffect(() => {
    async function load() {
      if (tab !== 'categories' || selectedCategoryId === 'all') {
        setCatProdRows([])
        setCatProdHasNext(false)
        return
      }
      setCatProdBusy(true)
      const res = await fetchProductsByCategoryPage({
        page: catProdPage,
        categoryId: selectedCategoryId,
        includeInactive: categoryTabIncludeInactiveProducts,
        search: '',
      })
      setCatProdBusy(false)
      if (!res.ok) {
        toast.error(res.error ?? 'No se pudieron cargar los productos de la categoría')
        setCatProdRows([])
        setCatProdHasNext(false)
        return
      }
      setCatProdRows(res.items)
      setCatProdHasNext(res.hasNextPage)
    }
    void load()
  }, [tab, selectedCategoryId, catProdPage, categoryTabIncludeInactiveProducts])

  useEffect(() => {
    setCatProdPage(0)
  }, [selectedCategoryId, categoryTabIncludeInactiveProducts])

  useEffect(() => {
    async function load() {
      if (!aliasDialogOpen) return
      setAliasBusy(true)
      const res = await fetchCatalogAliasesPage({
        page: aliasPage,
        search: aliasTableSearchSubmitted,
      })
      setAliasBusy(false)
      if (!res.ok) {
        toast.error(res.error ?? 'No se pudieron cargar alias')
        return
      }
      setAliasRows(res.rows)
      setAliasHasNext(res.hasNextPage)
    }
    void load()
  }, [aliasDialogOpen, aliasPage, aliasTableSearchSubmitted])

  useEffect(() => {
    setAliasPage(0)
  }, [aliasTableSearchSubmitted, aliasDialogOpen])

  function openNewProduct() {
    setEditingProductId(null)
    setProductDialogBrandHint(null)
    const firstSec = sections[0]?.id ?? ''
    const cats = categories.filter((c) => c.section_id === firstSec)
    setProductForm({
      ...emptyProductInput(),
      section_id: firstSec,
      category_id: cats[0]?.id ?? '',
    })
    setProductDialogOpen(true)
  }

  async function submitFetchImages() {
    if (fetchImagesBusy) return
    setFetchImagesBusy(true)
    const logId = requestLogger.startLog('api', 'fetchMissingCatalogImages', { batchSize: 50 })
    try {
      const res = await fetchMissingCatalogImagesAction({ batchSize: 50 })
      if (!res.ok) {
        requestLogger.endLog(logId, 'error', res.__diagnostic, res.error)
        toast.error(res.error)
        console.error('[fetchMissingCatalogImages] error:', res.error, res.__diagnostic)
        return
      }
      requestLogger.endLog(logId, 'success', { ...res.__diagnostic, processed: res.processed, success: res.success, failed: res.failed, remaining: res.remaining })
      console.info('[fetchMissingCatalogImages] ok:', { processed: res.processed, success: res.success, failed: res.failed, remaining: res.remaining, diag: res.__diagnostic })
      if (res.success > 0) {
        toast.success(String(res.success) + ' imágenes recuperadas')
        void reloadProducts()
      } else if (res.processed === 0) {
        toast.info('No hay imágenes pendientes')
      } else {
        toast.error('No se pudieron recuperar las imágenes')
      }
      if (res.remaining > 0) {
        toast.info(String(res.remaining) + ' productos aún sin imagen')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      requestLogger.endLog(logId, 'error', undefined, msg)
      console.error('[fetchMissingCatalogImages] excepción:', msg)
      toast.error('Error inesperado: ' + msg)
    } finally {
      setFetchImagesBusy(false)
    }
  }

  function openEditProduct(p: CatalogProductRow) {
    setEditingProductId(p.id)
    setProductDialogBrandHint(p.brand_label ?? p.brand)
    setProductForm({
      name: p.name,
      section_id: p.section_id,
      category_id: p.category_id,
      brand_id: p.brand_id,
      brand: p.brand,
      format: p.format,
      unit: p.unit,
      default_reference_price: p.default_reference_price,
      active: p.active,
    })
    setProductDialogOpen(true)
  }

  async function submitProduct() {
    if (!productForm.section_id || !productForm.category_id) {
      toast.error('Selecciona sección y categoría')
      return
    }
    const res = editingProductId
      ? await updateCatalogProductAction(editingProductId, productForm)
      : await createCatalogProductAction(productForm)
    if (!res.ok) {
      toast.error(
        res.error ?? 'No logramos guardar los cambios. Revisa los datos e intenta nuevamente.',
      )
      return
    }
    toast.success(editingProductId ? 'Producto actualizado' : 'Producto creado')
    setProductDialogOpen(false)
    setEditingProductId(null)
    router.refresh()
    void reloadProducts()
  }

  async function submitMergeBrands() {
    if (!brandMergeSurvivorId.trim() || !brandMergeAbsorbedId.trim()) {
      toast.error('Completa los campos obligatorios antes de guardar.')
      return
    }
    if (brandMergeSurvivorId === brandMergeAbsorbedId) {
      toast.error('Elige dos marcas distintas para unificar.')
      return
    }
    const label = brandMergeUnifiedName.trim()
    if (!label) {
      toast.error('Escribe el nombre final de la marca unificada.')
      return
    }
    setBrandMergeBusy(true)
    const res = await mergeCatalogBrandsAction({
      survivorBrandId: brandMergeSurvivorId,
      absorbedBrandId: brandMergeAbsorbedId,
      unifiedName: label,
    })
    setBrandMergeBusy(false)
    if (!res.ok) {
      toast.error(res.error ?? 'No se pudo completar la acción. Intenta nuevamente.')
      return
    }
    toast.success('Marcas unificadas')
    resetBrandMergeForm()
    setBrandMergeOpen(false)
    setBrandListPage(0)
    setSelectedBrandId('all')
    setSelectedBrandName(null)
    router.refresh()
  }

  function openEditBrand(b: CatalogBrandGridRow) {
    setBrandEditId(b.id)
    setBrandEditName(b.name)
    setBrandEditOpen(true)
  }

  async function submitBrandEdit() {
    if (!brandEditId) return
    const res = await updateCatalogBrandAction(brandEditId, brandEditName)
    if (!res.ok) {
      toast.error(res.error ?? 'No logramos completar la acción. Revisa los datos e intenta nuevamente.')
      return
    }
    toast.success('Marca actualizada')
    setBrandEditOpen(false)
    setBrandEditId(null)
    router.refresh()
  }

  function openEditCategoryRow(c: CatalogCategoryGridRow) {
    setCategoryEditId(c.id)
    setCategoryEditName(c.name)
    setCategoryEditSectionId(c.section_id)
    setCategoryEditOpen(true)
  }

  async function submitCategoryEdit() {
    if (!categoryEditId || !categoryEditSectionId) {
      toast.error('Completa los campos obligatorios antes de guardar.')
      return
    }
    const res = await updateCategoryAction(categoryEditId, categoryEditSectionId, categoryEditName)
    if (!res.ok) {
      toast.error(res.error ?? 'No logramos completar la acción. Revisa los datos e intenta nuevamente.')
      return
    }
    toast.success('Categoría actualizada')
    setCategoryEditOpen(false)
    setCategoryEditId(null)
    router.refresh()
  }

  async function toggleProductActiveRow(row: CatalogProductGridRow) {
    const res = await setCatalogProductActiveAction(row.id, !row.active)
    if (!res.ok) {
      toast.error(
        res.error ?? 'No logramos guardar los cambios. Revisa los datos e intenta nuevamente.',
      )
      return
    }
    toast.success(row.active ? 'Producto desactivado' : 'Producto activado')
    router.refresh()
    void reloadProducts()
  }

  function requestToggleProductActive(row: CatalogProductGridRow) {
    if (row.active) {
      setDeactivateProductRow(row)
      return
    }
    void toggleProductActiveRow(row)
  }

  async function confirmDeactivateProduct() {
    const row = deactivateProductRow
    setDeactivateProductRow(null)
    if (!row) return
    await toggleProductActiveRow(row)
  }

  async function submitSection() {
    const res = await createSectionAction(sectionName)
    if (!res.ok) {
      toast.error(res.error ?? 'No se pudo completar la acción.')
      return
    }
    toast.success('Sección creada')
    setSectionName('')
    setSectionDialogOpen(false)
    router.refresh()
  }

  async function submitCategory() {
    if (!catSectionId) {
      toast.error('Elige sección')
      return
    }
    const res = await createCategoryAction(catSectionId, catName)
    if (!res.ok) {
      toast.error(res.error ?? 'No se pudo completar la acción.')
      return
    }
    toast.success('Categoría creada')
    setCatName('')
    setCategoryDialogOpen(false)
    router.refresh()
  }

  async function submitAlias() {
    if (!aliasProductId) {
      toast.error('Elige un producto del catálogo')
      return
    }
    const res = await createCatalogAliasAction(aliasProductId, aliasText)
    if (!res.ok) {
      toast.error(res.error ?? 'No se pudo completar la acción.')
      return
    }
    toast.success('Alias creado')
    setAliasText('')
    setAliasProductId('')
    setAliasProductName(null)
    router.refresh()
    setAliasPage(0)
  }

  const tabs: { id: TabKey; label: string }[] = [
    { id: 'products', label: 'Productos' },
    { id: 'brands', label: 'Marcas' },
    { id: 'categories', label: 'Categorías' },
  ]

  const productCountHint =
    productsTotal !== null ? (
      <span>{`Mostrando ${productRows.length} · Total filtrado: ${productsTotal}`}</span>
    ) : (
      <span>{`Mostrando ${productRows.length} registros en esta página`}</span>
    )

  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Catálogo maestro</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
            Administrá taxonomía y productos de referencia globales. No modifica stock del hogar ni
            movimientos.
          </p>
        </div>
        <CopyCatalogButton profileId={profileId} />
      </div>

      <p className="text-[13px] text-muted-foreground">
        Productos del perfil vinculados al catálogo:{' '}
        <span className="font-medium text-foreground">
          {countError ? '—' : String(linkedCatalogCount)}
        </span>
        {' · '}
        <Link href="/inventory" className="text-primary underline underline-offset-2">
          Ir a inventario
        </Link>
      </p>

      <div className="flex flex-wrap gap-1 border-b border-border pb-px">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => goToTab(t.id)}
            className={`rounded-t-md px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'products' ? (
        <div className="space-y-4">
          <CatalogTabHeader
            title="Productos del catálogo"
            description={
              <>
                Un maestro por producto real: precios Lider, Jumbo y Central cuando hay homologación; columna
                Cadenas indica vínculos con tiendas.                 La captura y homologación por cadena se gestiona en{' '}
                <Link href="/captura-cadenas-2" className="text-primary underline underline-offset-2">
                  Captura de cadenas
                </Link>{' '}
                (Administración).
              </>
            }
          />

          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/20 p-4">
            <div className="min-w-[min(100%,280px)] flex-[2] space-y-1.5">
              <Label className="text-[12px]">Búsqueda libre</Label>
              <CatalogSearchBox
                ariaLabel="Buscar productos"
                placeholder="Buscar producto, marca, categoría o presentación..."
                value={productSearch}
                onChange={setProductSearch}
                onSubmit={submitProductSearch}
              />
            </div>
            <SectionSearchCombo
              label="Sección"
              sections={productFilterSections}
              loading={productFilterOptionsLoading}
              value={sectionFilter}
              onChange={(v) => {
                setSectionFilter(v)
                setCategoryFilter('all')
                setCategoryFilterLabel(null)
                setBrandFilter('all')
                setBrandFilterLabel(null)
              }}
              className="min-w-[200px] flex-1"
            />
            <CatalogFilterCombo
              label="Categoría"
              options={productFilterCategories}
              value={categoryFilter === 'all' ? 'all' : categoryFilter}
              onChange={(id) => {
                if (id === 'all') {
                  setCategoryFilter('all')
                  setCategoryFilterLabel(null)
                } else {
                  setCategoryFilter(id)
                  const name =
                    productFilterCategories.find((c) => c.id === id)?.name ??
                    categoryById.get(id)?.name ??
                    null
                  setCategoryFilterLabel(name)
                }
                setBrandFilter('all')
                setBrandFilterLabel(null)
              }}
              allLabel="Todas las categorías"
              selectionHint={
                categoryFilterLabel ??
                (categoryFilter !== 'all'
                  ? categoryById.get(categoryFilter)?.name ?? null
                  : null)
              }
              loading={productFilterOptionsLoading}
              className="min-w-[200px] flex-1"
            />
            <CatalogFilterCombo
              label="Marca"
              options={productFilterBrands}
              value={brandFilter === 'all' ? 'all' : brandFilter}
              onChange={(id) => {
                if (id === 'all') {
                  setBrandFilter('all')
                  setBrandFilterLabel(null)
                } else {
                  setBrandFilter(id)
                  const name = productFilterBrands.find((b) => b.id === id)?.name ?? null
                  setBrandFilterLabel(name)
                }
              }}
              allLabel="Todas las marcas"
              selectionHint={brandFilterLabel}
              loading={productFilterOptionsLoading}
              className="min-w-[200px] flex-1"
            />
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={showInactiveProducts}
                onChange={(e) => setShowInactiveProducts(e.target.checked)}
              />
              Mostrar inactivos
            </label>
            <Button
              type="button"
              variant="outline"
              className="h-9 shrink-0 gap-2"
              disabled={fetchImagesBusy}
              onClick={() => void submitFetchImages()}
            >
              {fetchImagesBusy ? 'Recuperando…' : 'Recuperar imágenes'}
            </Button>
            <Button type="button" className="btn-create h-9 shrink-0 gap-2" onClick={openNewProduct}>
              Nuevo producto
            </Button>
          </div>
          {productsTruncated ? (
            <p className="text-[12px] text-amber-800 dark:text-amber-200">
              La búsqueda alcanzó el límite de revisión en servidor: acota filtros o texto de búsqueda.
            </p>
          ) : null}

          <GridPagingRow
            disablePrev={productPage <= 0 || productsLoading}
            disableNext={!productsHasNext || productsLoading}
            onPrev={() => setProductPage((p) => Math.max(0, p - 1))}
            onNext={() => setProductPage((p) => p + 1)}
            pageIndex={productPage}
            pageSize={CATALOG_GRID_PAGE_SIZE}
            metaSuffix={
              productsTotal !== null ? ` · Total filtrado: ${productsTotal}` : null
            }
            trailing={<span className="text-[12px]">{productCountHint}</span>}
          />

          <div className="relative overflow-x-auto rounded-lg border border-border bg-card">
            {productsLoading ? (
              <p className="border-b border-border bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
                Cargando productos…
              </p>
            ) : null}
            <table className="w-full min-w-[1340px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  <th className="w-[52px] p-3 font-medium">Imagen</th>
                  <th className="p-3 font-medium">Sección</th>
                  <th className="p-3 font-medium">Categoría</th>
                  <th className="p-3 font-medium">Producto</th>
                  <th className="p-3 font-medium">Marca</th>
                  <th className="p-3 font-medium">Presentación</th>
                  <th className="p-3 font-medium">Precio ref.</th>
                  <th className="p-3 font-medium">Lider</th>
                  <th className="p-3 font-medium">Jumbo</th>
                  <th className="p-3 font-medium whitespace-nowrap">Central Mayorista</th>
                  <th className="p-3 w-[88px] text-center font-medium" title="Vínculos homologados con tiendas (cadenas)">
                    Cadenas
                  </th>
                  <th className="p-3 font-medium">Estado</th>
                  <th className="p-3 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {productsLoading ? (
                  <CatalogProductsTableSkeleton colCount={13} rows={10} />
                ) : productRows.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="p-8 text-center text-muted-foreground">
                      No encontramos productos con esos filtros. Ajusta la búsqueda o limpia los filtros.
                    </td>
                  </tr>
                ) : (
                  productRows.map((row) => (
                    <tr key={row.id} className="border-b border-border last:border-0">
                      <td className="p-2 align-middle">
                        <div className="flex h-9 w-9 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                          {row.thumb_url ? (
                            // eslint-disable-next-line @next/next/no-img-element -- URLs externas de storage
                            <img
                              src={row.thumb_url}
                              alt=""
                              className="h-full w-full object-cover"
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <span className="m-auto text-[10px] text-muted-foreground">—</span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-[13px] text-muted-foreground">
                        {sectionById.get(row.section_id)?.name ?? '—'}
                      </td>
                      <td className="p-3 text-[13px] text-muted-foreground">
                        {categoryById.get(row.category_id)?.name ?? '—'}
                      </td>
                      <td className="p-3 text-[13px] font-medium leading-snug">{row.name}</td>
                      <td className="p-3 text-[13px] text-muted-foreground">
                        {row.brand_label ?? row.brand ?? '—'}
                      </td>
                      <td className="p-3 text-[13px] text-muted-foreground">
                        {[row.format, row.unit].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="p-3 tabular-nums text-[13px] text-muted-foreground">
                        {row.default_reference_price != null
                          ? `$${Number(row.default_reference_price).toFixed(0)}`
                          : '—'}
                      </td>
                      <td className="p-3 tabular-nums text-[13px] text-muted-foreground">
                        {formatRetailLiderCell(row)}
                      </td>
                      <td className="p-3 tabular-nums text-[13px] text-muted-foreground">
                        {formatRetailJumboCell(row)}
                      </td>
                      <td className="p-3 tabular-nums text-[13px] text-muted-foreground">
                        {formatRetailCentralMayoristaCell(row)}
                      </td>
                      <td className="p-3 text-center tabular-nums text-[13px] text-muted-foreground">
                        {row.retail_links_count ?? 0}
                      </td>
                      <td className="p-3">
                        {row.active ? (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:text-emerald-200">
                            Activo
                          </span>
                        ) : (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                            Inactivo
                          </span>
                        )}
                      </td>
                      <td className="p-1">
                        <CatalogProductQuickActions
                          row={row}
                          onEdit={() => openEditProduct(row)}
                          onToggleRequest={() => requestToggleProductActive(row)}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <GridPagingRow
            disablePrev={productPage <= 0 || productsLoading}
            disableNext={!productsHasNext || productsLoading}
            onPrev={() => setProductPage((p) => Math.max(0, p - 1))}
            onNext={() => setProductPage((p) => p + 1)}
            pageIndex={productPage}
            pageSize={CATALOG_GRID_PAGE_SIZE}
            metaSuffix={
              productsTotal !== null ? ` · Total filtrado: ${productsTotal}` : null
            }
            trailing={<span className="text-[12px]">{productCountHint}</span>}
          />

          <Dialog open={deactivateProductRow != null} onOpenChange={(o) => !o && setDeactivateProductRow(null)}>
            <DialogContent className="modal-lg">
              <div className="modal-header">
                <h2 className="text-base font-semibold text-foreground">Desactivar producto</h2>
                <p className="mt-0.5 text-[13px] text-muted-foreground">El producto quedará inactivo en el catálogo maestro.</p>
              </div>
              <div className="modal-body-cols">
                <div className="modal-col-main justify-center">
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 dark:border-rose-900/40 dark:bg-rose-950/20">
                    <p className="text-[13px] font-semibold text-rose-800 dark:text-rose-300">Producto a desactivar</p>
                    <p className="mt-1.5 text-[15px] font-bold text-foreground">
                      {deactivateProductRow?.name ?? '—'}
                    </p>
                  </div>
                  <p className="text-[13px] text-muted-foreground">
                    El producto no se eliminará de la base de datos. Puedes reactivarlo desde esta misma sección cuando sea necesario.
                  </p>
                </div>
                <div className="modal-col-aside flex flex-col gap-4">
                  <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">Efecto de la acción</p>
                    <ul className="mt-2 space-y-1.5 text-[12px] text-amber-800 dark:text-amber-300">
                      <li>• El producto deja de aparecer en búsquedas</li>
                      <li>• Los precios de retail ya capturados se conservan</li>
                      <li>• Los datos históricos no se eliminan</li>
                      <li>• Puedes reactivarlo en cualquier momento</li>
                    </ul>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <div />
                <div className="flex gap-2">
                  <Button type="button" className="btn-cancel h-9" onClick={() => setDeactivateProductRow(null)}>
                    Cancelar
                  </Button>
                  <Button type="button" className="btn-danger h-9" onClick={() => void confirmDeactivateProduct()}>
                    Desactivar
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      ) : null}

      {tab === 'brands' ? (
        <div className="space-y-6">
          <CatalogTabHeader
            title="Marcas"
            description="Revisión y mantenimiento de marcas del catálogo maestro y productos enlazados. Las nuevas marcas canónicas se generan automáticamente al crear productos."
          />

          <GridInactiveNote entity="Las marcas" />

          <p className="text-[12px] text-muted-foreground">
            Si existen equivalencias escritas distinto (ej. «excel» y «excell»), usa «Unir marcas» para una
            sola marca y un nombre común sin colisionar con otra marca fuera del par elegido.
          </p>

          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/20 p-4">
            <div className="min-w-[200px] flex-1 space-y-1.5">
              <Label className="text-[12px]">Búsqueda marca</Label>
              <CatalogSearchBox
                ariaLabel="Buscar marcas"
                placeholder="Mínimo 2 caracteres en servidor…"
                value={brandListSearch}
                onChange={setBrandListSearch}
                onSubmit={submitBrandListSearch}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={brandTabIncludeInactiveProducts}
                onChange={(e) => setBrandTabIncludeInactiveProducts(e.target.checked)}
              />
              Mostrar inactivos
            </label>
            <Button
              type="button"
              className="btn-violet-alt h-9 shrink-0 gap-2"
              onClick={() => {
                resetBrandMergeForm()
                setBrandMergeOpen(true)
              }}
            >
              <GitMerge className="h-4 w-4" aria-hidden />
              Unir marcas
            </Button>
          </div>

          <GridPagingRow
            disablePrev={brandListPage <= 0 || brandListBusy}
            disableNext={!brandListHasNext || brandListBusy}
            onPrev={() => setBrandListPage((p) => Math.max(0, p - 1))}
            onNext={() => setBrandListPage((p) => p + 1)}
            pageIndex={brandListPage}
            pageSize={CATALOG_GRID_PAGE_SIZE}
            metaSuffix={brandListTotal !== null ? ` · Total: ${brandListTotal}` : null}
          />

          <GridLoadingMask show={brandListBusy}>
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left">
                    <th className="p-3 font-medium">Marca</th>
                    <th className="p-3 font-medium text-right">Cant. productos</th>
                    <th className="p-3 font-medium">Estado</th>
                    <th className="p-3 font-medium text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {!brandListBusy && brandListRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-muted-foreground">
                        No encontramos marcas con esos criterios.
                      </td>
                    </tr>
                  ) : (
                    brandListRows.map((b) => (
                      <tr
                        key={b.id}
                        className={cn(
                          'border-b border-border last:border-0',
                          selectedBrandId === b.id && 'bg-muted/50'
                        )}
                      >
                        <td className="p-3 font-medium">{b.name}</td>
                        <td className="p-3 text-right tabular-nums text-muted-foreground">
                          {b.product_count}
                        </td>
                        <td className="p-3 text-muted-foreground">
                          <span
                            className="rounded-full bg-muted px-2 py-0.5 text-[12px]"
                            title="La tabla catalog_brands no tiene columna activo/inactivo"
                          >
                            —
                          </span>
                        </td>
                        <td className="p-3">
                          <div className="flex justify-end gap-1">
                            <GridRowIconButton
                              label="Seleccionar marca"
                              className="btn-save"
                              onClick={() => {
                                setSelectedBrandId(b.id)
                                setSelectedBrandName(b.name)
                              }}
                            >
                              <CheckCheck className="size-4" aria-hidden />
                            </GridRowIconButton>
                            <GridRowIconButton
                              label="Editar marca"
                              className="btn-sky"
                              onClick={() => openEditBrand(b)}
                            >
                              <Pencil className="size-4" aria-hidden />
                            </GridRowIconButton>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </GridLoadingMask>

          <GridPagingRow
            disablePrev={brandListPage <= 0 || brandListBusy}
            disableNext={!brandListHasNext || brandListBusy}
            onPrev={() => setBrandListPage((p) => Math.max(0, p - 1))}
            onNext={() => setBrandListPage((p) => p + 1)}
            pageIndex={brandListPage}
            pageSize={CATALOG_GRID_PAGE_SIZE}
            metaSuffix={brandListTotal !== null ? ` · Total: ${brandListTotal}` : null}
          />

          <div className="rounded-lg border border-border bg-card">
            <div className="border-b border-border bg-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold">
                {selectedBrandId === 'all' ?
                  'Productos de la marca'
                : `Productos de la marca: ${selectedBrandName ?? ''}`}
              </h3>
              {selectedBrandId === 'all' ?
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Selecciona una marca en la grilla superior para ver sus productos.
                </p>
              : null}
            </div>
            {selectedBrandId !== 'all' ? (
              <div className="space-y-3 p-4">
                <GridPagingRow
                  disablePrev={brandProductsPage <= 0 || brandProductsBusy}
                  disableNext={!brandProductsHasNext || brandProductsBusy}
                  onPrev={() => setBrandProductsPage((p) => Math.max(0, p - 1))}
                  onNext={() => setBrandProductsPage((p) => p + 1)}
                  pageIndex={brandProductsPage}
                  pageSize={CATALOG_GRID_PAGE_SIZE}
                />
                <GridLoadingMask show={brandProductsBusy}>
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full min-w-[1040px] text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-left">
                          <th className="p-3 font-medium">Producto</th>
                          <th className="p-3 font-medium">Categoría</th>
                          <th className="p-3 font-medium">Presentación</th>
                          <th className="p-3 font-medium">Precio ref.</th>
                          <th className="p-3 font-medium">Lider</th>
                          <th className="p-3 font-medium">Jumbo</th>
                          <th className="p-3 font-medium whitespace-nowrap">Central Mayorista</th>
                          <th className="p-3 w-[88px] text-center font-medium">Cadenas</th>
                          <th className="p-3 font-medium">Estado</th>
                          <th className="p-3 font-medium text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!brandProductsBusy && brandProductsRows.length === 0 ? (
                          <tr>
                            <td colSpan={10} className="p-6 text-center text-muted-foreground">
                              Sin productos en esta página para esta marca y filtros.
                            </td>
                          </tr>
                        ) : (
                          brandProductsRows.map((p) => (
                            <tr key={p.id} className="border-b border-border last:border-0">
                              <td className="p-3 font-medium">{p.name}</td>
                              <td className="p-3 text-muted-foreground">
                                {categoryById.get(p.category_id)?.name ?? '—'}
                              </td>
                              <td className="p-3 text-muted-foreground">
                                {[p.format, p.unit].filter(Boolean).join(' · ') || '—'}
                              </td>
                              <td className="p-3 tabular-nums text-muted-foreground">
                                {p.default_reference_price != null
                                  ? `$${Number(p.default_reference_price).toFixed(0)}`
                                  : '—'}
                              </td>
                              <td className="p-3 tabular-nums text-muted-foreground">
                                {formatRetailLiderCell(p)}
                              </td>
                              <td className="p-3 tabular-nums text-muted-foreground">
                                {formatRetailJumboCell(p)}
                              </td>
                              <td className="p-3 tabular-nums text-muted-foreground">
                                {formatRetailCentralMayoristaCell(p)}
                              </td>
                              <td className="p-3 text-center tabular-nums text-muted-foreground">
                                {p.retail_links_count ?? 0}
                              </td>
                              <td className="p-3">
                                {p.active ?
                                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[12px] text-emerald-800 dark:text-emerald-200">
                                    Activo
                                  </span>
                                : <span className="rounded-full bg-muted px-2 py-0.5 text-[12px]">Inactivo</span>}
                              </td>
                              <td className="p-2">
                                <CatalogProductQuickActions
                                  row={p}
                                  onEdit={() => openEditProduct(p)}
                                  onToggleRequest={() => requestToggleProductActive(p)}
                                />
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </GridLoadingMask>
                <GridPagingRow
                  disablePrev={brandProductsPage <= 0 || brandProductsBusy}
                  disableNext={!brandProductsHasNext || brandProductsBusy}
                  onPrev={() => setBrandProductsPage((p) => Math.max(0, p - 1))}
                  onNext={() => setBrandProductsPage((p) => p + 1)}
                  pageIndex={brandProductsPage}
                  pageSize={CATALOG_GRID_PAGE_SIZE}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === 'categories' ? (
        <div className="space-y-6">
          <CatalogTabHeader
            title="Categorías"
            description="Administra secciones y categorías del catálogo. Revisa los productos asociados a cada categoría."
          />

          <GridInactiveNote entity="Las categorías y secciones" />

          <p className="text-[12px] text-muted-foreground">
            Primero se elige la sección: el combo de categoría muestra solo las categorías de esa sección
            (o todas si la sección es «Todas»). Para usar «Nueva categoría», la sección del filtro no puede
            ser «Todas».
          </p>

          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/20 p-4">
            <SectionSearchCombo
              label="Sección"
              sections={sections}
              value={categorySectionFilter}
              onChange={(v) => {
                setCategorySectionFilter(v)
                setSelectedCategoryId('all')
                setSelectedCategoryLabel(null)
              }}
              className="min-w-[220px] flex-1"
            />
            <CatalogFilterCombo
              label="Categoría"
              options={categoriesScopedByMaintainSection.map((c) => ({ id: c.id, name: c.name }))}
              value={categoryGridCategoryFilter}
              onChange={setCategoryGridCategoryFilter}
              allLabel={
                categorySectionFilter === 'all' ? 'Todas las categorías' : 'Todas (esta sección)'
              }
              placeholder="Filtrar categorías…"
              className="min-w-[220px] flex-1"
              emptyHint={
                categorySectionFilter === 'all'
                  ? 'No hay categorías cargadas.'
                  : 'No hay categorías en esta sección.'
              }
            />
            <div className="min-w-[220px] flex-[2] space-y-1.5">
              <Label className="text-[12px]">Refinar nombre (servidor)</Label>
              <CatalogSearchBox
                ariaLabel="Buscar categorías por nombre"
                placeholder="Nombre (≥2 caracteres recomendado; Enter / lupa)"
                value={categoryGridSearch}
                onChange={setCategoryGridSearch}
                onSubmit={submitCategoryGridSearch}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={categoryTabIncludeInactiveProducts}
                onChange={(e) => setCategoryTabIncludeInactiveProducts(e.target.checked)}
              />
              Mostrar inactivos
            </label>
            <Button type="button" variant="outline" className="h-9 shrink-0" onClick={() => setSectionDialogOpen(true)}>
              Nueva sección
            </Button>
            <Button
              type="button"
              className="h-9 shrink-0"
              disabled={categorySectionFilter === 'all'}
              title={
                categorySectionFilter === 'all'
                  ? 'Elegí una sección antes: las categorías no existen aisladas de una sección.'
                  : 'Crear categoría dentro de la sección seleccionada en el filtro.'
              }
              onClick={() => {
                setCatSectionId(categorySectionFilter === 'all' ? '' : categorySectionFilter)
                setCatName('')
                setCategoryDialogOpen(true)
              }}
            >
              Nueva categoría
            </Button>
          </div>

          <GridPagingRow
            disablePrev={categoryGridPage <= 0 || categoryGridBusy}
            disableNext={!categoryGridHasNext || categoryGridBusy}
            onPrev={() => setCategoryGridPage((p) => Math.max(0, p - 1))}
            onNext={() => setCategoryGridPage((p) => p + 1)}
            pageIndex={categoryGridPage}
            pageSize={CATALOG_GRID_PAGE_SIZE}
            metaSuffix={categoryGridTotal !== null ? ` · Total: ${categoryGridTotal}` : null}
          />

          <GridLoadingMask show={categoryGridBusy}>
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left">
                    <th className="p-3 font-medium">Sección</th>
                    <th className="p-3 font-medium">Categoría</th>
                    <th className="p-3 font-medium text-right">Cant. productos</th>
                    <th className="p-3 font-medium">Estado</th>
                    <th className="p-3 font-medium text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {!categoryGridBusy && categoryGridRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-muted-foreground">
                        No encontramos categorías con esos filtros.
                      </td>
                    </tr>
                  ) : (
                    categoryGridRows.map((c) => (
                      <tr
                        key={c.id}
                        className={cn(
                          'border-b border-border last:border-0',
                          selectedCategoryId === c.id && 'bg-muted/50'
                        )}
                      >
                        <td className="p-3 text-muted-foreground">{c.section_name}</td>
                        <td className="p-3 font-medium">{c.name}</td>
                        <td className="p-3 text-right tabular-nums text-muted-foreground">
                          {c.product_count}
                        </td>
                        <td className="p-3">
                          <span
                            className="rounded-full bg-muted px-2 py-0.5 text-[12px] text-muted-foreground"
                            title="Sin columna activo/inactivo en categories"
                          >
                            —
                          </span>
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => {
                                setSelectedCategoryId(c.id)
                                setSelectedCategoryLabel(c.name)
                              }}
                            >
                              Seleccionar
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => openEditCategoryRow(c)}
                            >
                              Editar
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </GridLoadingMask>

          <GridPagingRow
            disablePrev={categoryGridPage <= 0 || categoryGridBusy}
            disableNext={!categoryGridHasNext || categoryGridBusy}
            onPrev={() => setCategoryGridPage((p) => Math.max(0, p - 1))}
            onNext={() => setCategoryGridPage((p) => p + 1)}
            pageIndex={categoryGridPage}
            pageSize={CATALOG_GRID_PAGE_SIZE}
            metaSuffix={categoryGridTotal !== null ? ` · Total: ${categoryGridTotal}` : null}
          />

          <div className="rounded-lg border border-border bg-card">
            <div className="border-b border-border bg-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold">
                {selectedCategoryId === 'all' ?
                  'Productos de la categoría'
                : `Productos de la categoría: ${selectedCategoryLabel ?? ''}`}
              </h3>
              {selectedCategoryId === 'all' ?
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Selecciona una categoría en la grilla superior para ver sus productos paginados.
                </p>
              : null}
            </div>
            {selectedCategoryId !== 'all' ? (
              <div className="space-y-3 p-4">
                <GridPagingRow
                  disablePrev={catProdPage <= 0 || catProdBusy}
                  disableNext={!catProdHasNext || catProdBusy}
                  onPrev={() => setCatProdPage((p) => Math.max(0, p - 1))}
                  onNext={() => setCatProdPage((p) => p + 1)}
                  pageIndex={catProdPage}
                  pageSize={CATALOG_GRID_PAGE_SIZE}
                />
                <GridLoadingMask show={catProdBusy}>
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full min-w-[1120px] text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-left">
                          <th className="p-3 font-medium">Producto</th>
                          <th className="p-3 font-medium">Marca</th>
                          <th className="p-3 font-medium">Presentación</th>
                          <th className="p-3 font-medium">Precio ref.</th>
                          <th className="p-3 font-medium">Lider</th>
                          <th className="p-3 font-medium">Jumbo</th>
                          <th className="p-3 font-medium whitespace-nowrap">Central Mayorista</th>
                          <th className="p-3 w-[88px] text-center font-medium">Cadenas</th>
                          <th className="p-3 font-medium">Estado</th>
                          <th className="p-3 font-medium text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!catProdBusy && catProdRows.length === 0 ? (
                          <tr>
                            <td colSpan={10} className="p-6 text-center text-muted-foreground">
                              Sin productos en esta página para esta categoría y filtros.
                            </td>
                          </tr>
                        ) : (
                          catProdRows.map((p) => (
                            <tr key={p.id} className="border-b border-border last:border-0">
                              <td className="p-3 font-medium">{p.name}</td>
                              <td className="p-3 text-muted-foreground">
                                {p.brand_label ?? p.brand ?? '—'}
                              </td>
                              <td className="p-3 text-muted-foreground">
                                {[p.format, p.unit].filter(Boolean).join(' · ') || '—'}
                              </td>
                              <td className="p-3 tabular-nums text-muted-foreground">
                                {p.default_reference_price != null
                                  ? `$${Number(p.default_reference_price).toFixed(0)}`
                                  : '—'}
                              </td>
                              <td className="p-3 tabular-nums text-muted-foreground">
                                {formatRetailLiderCell(p)}
                              </td>
                              <td className="p-3 tabular-nums text-muted-foreground">
                                {formatRetailJumboCell(p)}
                              </td>
                              <td className="p-3 tabular-nums text-muted-foreground">
                                {formatRetailCentralMayoristaCell(p)}
                              </td>
                              <td className="p-3 text-center tabular-nums text-muted-foreground">
                                {p.retail_links_count ?? 0}
                              </td>
                              <td className="p-3">
                                {p.active ?
                                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[12px] text-emerald-800 dark:text-emerald-200">
                                    Activo
                                  </span>
                                : <span className="rounded-full bg-muted px-2 py-0.5 text-[12px]">Inactivo</span>}
                              </td>
                              <td className="p-2">
                                <CatalogProductQuickActions
                                  row={p}
                                  onEdit={() => openEditProduct(p)}
                                  onToggleRequest={() => requestToggleProductActive(p)}
                                />
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </GridLoadingMask>
                <GridPagingRow
                  disablePrev={catProdPage <= 0 || catProdBusy}
                  disableNext={!catProdHasNext || catProdBusy}
                  onPrev={() => setCatProdPage((p) => Math.max(0, p - 1))}
                  onNext={() => setCatProdPage((p) => p + 1)}
                  pageIndex={catProdPage}
                  pageSize={CATALOG_GRID_PAGE_SIZE}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">Avanzado</p>
            <p className="text-[13px] text-muted-foreground">
              Gestión técnica de alias (lista paginada en servidor).
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => setAliasDialogOpen(true)}>
            Administrar alias
          </Button>
        </div>
      </div>

      {/* Modales */}
      <Dialog
        open={brandMergeOpen}
        onOpenChange={(open) => {
          setBrandMergeOpen(open)
          if (!open) resetBrandMergeForm()
        }}
      >
        <DialogContent className="modal-lg">
          <DialogHeader>
            <DialogTitle>Unir marcas</DialogTitle>
            <DialogDescription>
              La primera marca es la que permanece en el catálogo; la segunda se elimina y todos sus
              productos maestros pasan a la primera. El nombre final no puede coincidir con una tercera
              marca (sí puede repetir el de una de las dos que unís).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <MergeBrandSearchPick
              label="Marca que permanece (canónica)"
              valueId={brandMergeSurvivorId}
              displayName={brandMergeSurvivorName}
              excludeId={brandMergeAbsorbedId || undefined}
              onClear={() => {
                setBrandMergeSurvivorId('')
                setBrandMergeSurvivorName(null)
              }}
              onPick={(id, name) => {
                setBrandMergeSurvivorId(id)
                setBrandMergeSurvivorName(name)
                setBrandMergeUnifiedName((prev) => (prev.trim() ? prev : name))
              }}
            />
            <MergeBrandSearchPick
              label="Marca que se une (se elimina)"
              valueId={brandMergeAbsorbedId}
              displayName={brandMergeAbsorbedName}
              excludeId={brandMergeSurvivorId || undefined}
              onClear={() => {
                setBrandMergeAbsorbedId('')
                setBrandMergeAbsorbedName(null)
              }}
              onPick={(id, name) => {
                setBrandMergeAbsorbedId(id)
                setBrandMergeAbsorbedName(name)
                setBrandMergeUnifiedName((prev) => (prev.trim() ? prev : name))
              }}
            />
            <div className="space-y-2">
              <Label>Nombre final de la marca</Label>
              <Input
                className="app-input"
                placeholder="Ej.: excell"
                value={brandMergeUnifiedName}
                onChange={(e) => setBrandMergeUnifiedName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBrandMergeOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={
                brandMergeBusy
                || !brandMergeSurvivorId.trim()
                || !brandMergeAbsorbedId.trim()
                || brandMergeSurvivorId === brandMergeAbsorbedId
                || !brandMergeUnifiedName.trim()
              }
              onClick={() => void submitMergeBrands()}
            >
              {brandMergeBusy ? 'Unificando…' : 'Unir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={brandEditOpen} onOpenChange={setBrandEditOpen}>
        <DialogContent className="modal-lg">
          <DialogHeader>
            <DialogTitle>Editar marca</DialogTitle>
            <DialogDescription>Nombre canónico en el catálogo maestro.</DialogDescription>
          </DialogHeader>
          <div className="modal-body-cols">
            <div className="modal-col-main justify-center">
              <div className="space-y-2">
                <Label>Nombre de la marca</Label>
                <Input
                  className="app-input"
                  value={brandEditName}
                  onChange={(e) => setBrandEditName(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-col-aside flex flex-col gap-4">
              <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-900/40 dark:bg-sky-950/20">
                <p className="text-[11px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-400">Alcance del cambio</p>
                <ul className="mt-2 space-y-1.5 text-[12px] text-sky-800 dark:text-sky-300">
                  <li>• El nombre se actualiza en todos los productos enlazados</li>
                  <li>• El alias de búsqueda se recalcula automáticamente</li>
                  <li>• Los precios de retail no se ven afectados</li>
                </ul>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <div />
            <div className="flex gap-2">
              <Button type="button" className="btn-close h-9" onClick={() => setBrandEditOpen(false)}>
                Cancelar
              </Button>
              <Button type="button" className="btn-save h-9" onClick={() => void submitBrandEdit()}>
                Guardar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={sectionDialogOpen} onOpenChange={setSectionDialogOpen}>
        <DialogContent className="modal-lg">
          <div className="modal-header">
            <h2 className="text-base font-semibold text-foreground">Nueva sección</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">La sección agrupa categorías del catálogo global.</p>
          </div>
          <div className="modal-body-cols">
            <div className="modal-col-main justify-center">
              <div className="space-y-2">
                <Label>Nombre de la sección</Label>
                <Input
                  className="app-input"
                  placeholder="Ej.: Refrigerador"
                  value={sectionName}
                  onChange={(e) => setSectionName(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-col-aside flex flex-col gap-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Estructura del catálogo</p>
                <p className="mt-2 text-[12px] text-emerald-800 dark:text-emerald-300">
                  Las secciones son el nivel más alto. Cada sección puede contener múltiples categorías y cada categoría agrupa productos del catálogo maestro.
                </p>
                <p className="mt-2 text-[12px] text-emerald-800 dark:text-emerald-300">
                  Ejemplos: <span className="font-semibold">Lácteos</span>, <span className="font-semibold">Bebidas</span>, <span className="font-semibold">Limpieza</span>.
                </p>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <div />
            <div className="flex gap-2">
              <Button type="button" className="btn-close h-9" onClick={() => setSectionDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="button" className="btn-create h-9" onClick={() => void submitSection()}>
                Crear
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={categoryDialogOpen}
        onOpenChange={(open) => {
          setCategoryDialogOpen(open)
          if (!open) {
            setCatName('')
            setCatSectionId('')
          }
        }}
      >
        <DialogContent className="modal-lg">
          <div className="modal-header">
            <h2 className="text-base font-semibold text-foreground">Nueva categoría</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Selecciona la sección padre y asigna un nombre único.</p>
          </div>
          <div className="modal-body-cols">
            <div className="modal-col-main justify-center gap-4">
              <SectionSearchCombo
                omitAllOption
                emptyPickLabel="Selecciona la sección padre"
                label="Sección"
                sections={sections}
                value={catSectionId || ''}
                onChange={(v) => setCatSectionId(v === 'all' ? '' : v)}
              />
              <div className="space-y-2">
                <Label>Nombre de la categoría</Label>
                <Input
                  className="app-input"
                  placeholder="Ej.: Mayonesa"
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-col-aside flex flex-col gap-4">
              <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900/40 dark:bg-violet-950/20">
                <p className="text-[11px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-400">Jerarquía</p>
                <p className="mt-2 text-[12px] text-violet-800 dark:text-violet-300">
                  Sección → Categoría → Productos
                </p>
                <p className="mt-2 text-[12px] text-violet-800 dark:text-violet-300">
                  Si la sección necesaria aún no existe, cierra este diálogo y crea la sección primero desde «Nueva sección».
                </p>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <div />
            <div className="flex gap-2">
              <Button type="button" className="btn-close h-9" onClick={() => setCategoryDialogOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                className="btn-create h-9"
                disabled={!catSectionId.trim() || !normalizeSearchText(catName)}
                onClick={() => void submitCategory()}
              >
                Crear
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={categoryEditOpen} onOpenChange={setCategoryEditOpen}>
        <DialogContent className="modal-lg">
          <div className="modal-header">
            <h2 className="text-base font-semibold text-foreground">Editar categoría</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">La categoría pertenece a una sección del catálogo.</p>
          </div>
          <div className="modal-body-cols">
            <div className="modal-col-main justify-center gap-4">
              <SectionSearchCombo
                omitAllOption
                emptyPickLabel="Selecciona la sección"
                label="Sección"
                sections={sections}
                value={categoryEditSectionId || ''}
                onChange={(v) => setCategoryEditSectionId(v === 'all' ? '' : v)}
              />
              <div className="space-y-2">
                <Label>Nombre de la categoría</Label>
                <Input
                  className="app-input"
                  value={categoryEditName}
                  onChange={(e) => setCategoryEditName(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-col-aside flex flex-col gap-4">
              <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-900/40 dark:bg-sky-950/20">
                <p className="text-[11px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-400">Alcance del cambio</p>
                <ul className="mt-2 space-y-1.5 text-[12px] text-sky-800 dark:text-sky-300">
                  <li>• El nombre se actualiza en todo el catálogo</li>
                  <li>• Los productos en esta categoría no cambian</li>
                  <li>• La sección puede cambiarse a una diferente</li>
                </ul>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <div />
            <div className="flex gap-2">
              <Button type="button" className="btn-close h-9" onClick={() => setCategoryEditOpen(false)}>
                Cancelar
              </Button>
              <Button type="button" className="btn-save h-9" onClick={() => void submitCategoryEdit()}>
                Guardar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={aliasDialogOpen} onOpenChange={setAliasDialogOpen}>
        <DialogContent className="modal-lg">
          <DialogHeader>
            <DialogTitle>Alias (avanzado)</DialogTitle>
            <DialogDescription>
              Lista paginada. Valor guardado:{' '}
              <code className="rounded bg-muted px-1">
                {aliasText ? normalizeCatalogAlias(aliasText) : '…'}
              </code>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <ProductRemotePick
              label="Producto para alias"
              valueId={aliasProductId}
              displayName={aliasProductName}
              activeOnly={true}
              onClear={() => {
                setAliasProductId('')
                setAliasProductName(null)
              }}
              onPick={(id, name) => {
                setAliasProductId(id)
                setAliasProductName(name)
              }}
            />

            <div className="flex flex-wrap gap-2">
              <Input
                className="app-input max-w-sm flex-1"
                placeholder="Texto alias nuevo"
                value={aliasText}
                onChange={(e) => setAliasText(e.target.value)}
              />
              <Button type="button" onClick={() => void submitAlias()}>
                Crear alias
              </Button>
            </div>

            <div className="space-y-2">
              <div className="space-y-1.5 max-w-md">
                <Label className="app-field-label">Buscar en tabla (servidor)</Label>
                <CatalogSearchBox
                  ariaLabel="Buscar alias"
                  size="default"
                  placeholder="≥2 caracteres para filtrar alias_normalized por ilike…"
                  value={aliasTableSearch}
                  onChange={setAliasTableSearch}
                  onSubmit={submitAliasTableSearch}
                />
              </div>
              <GridPagingRow
                disablePrev={aliasPage <= 0 || aliasBusy}
                disableNext={!aliasHasNext || aliasBusy}
                onPrev={() => setAliasPage((p) => Math.max(0, p - 1))}
                onNext={() => setAliasPage((p) => p + 1)}
                pageIndex={aliasPage}
                hidePageSize
                metaSuffix={` · ${aliasBusy ? 'Cargando…' : `${aliasRows.length} filas`}`}
              />

              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left">
                      <th className="p-3 font-medium">Alias (normalizado)</th>
                      <th className="p-3 font-medium">Producto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aliasRows.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="p-4 text-muted-foreground">
                          Sin datos en esta página.
                        </td>
                      </tr>
                    ) : (
                      aliasRows.map((a) => (
                        <tr key={a.id} className="border-b border-border last:border-0">
                          <td className="p-3 font-mono text-[13px]">{a.alias_normalized}</td>
                          <td className="p-3">{a.product_name}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <GridPagingRow
                disablePrev={aliasPage <= 0 || aliasBusy}
                disableNext={!aliasHasNext || aliasBusy}
                onPrev={() => setAliasPage((p) => Math.max(0, p - 1))}
                onNext={() => setAliasPage((p) => p + 1)}
                pageIndex={aliasPage}
                hidePageSize
                metaSuffix={` · ${aliasBusy ? 'Cargando…' : `${aliasRows.length} filas`}`}
              />
            </div>

            <p className="text-[12px] text-muted-foreground">
              Recomendación: usa alias cortos y consistentes (sin cantidades) para mejorar el emparejamiento.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAliasDialogOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={productDialogOpen} onOpenChange={setProductDialogOpen}>
        <DialogContent className="modal-lg">
          <DialogHeader>
            <DialogTitle>
              {editingProductId ? 'Editar producto del catálogo' : 'Nuevo producto del catálogo'}
            </DialogTitle>
            <DialogDescription>
              Datos globales de referencia; no afectan stock del hogar.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Nombre</Label>
              <Input
                className="app-input"
                value={productForm.name}
                onChange={(e) =>
                  setProductForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>
            <div className="grid gap-3">
              <div className="space-y-1.5">
                <SectionSearchCombo
                  label="Sección"
                  sections={sections}
                  value={productForm.section_id || 'all'}
                  onChange={(v) => {
                    const sec = v === 'all' ? '' : v
                    const cats = categories.filter((c) => c.section_id === sec)
                    setProductForm((f) => ({
                      ...f,
                      section_id: sec,
                      category_id:
                        cats.some((c) => c.id === f.category_id) ?
                          f.category_id
                        : cats[0]?.id ?? '',
                    }))
                  }}
                />
              </div>
              <ProductDialogCategoryPick
                categories={categories}
                sections={sections}
                sectionId={productForm.section_id}
                categoryId={productForm.category_id}
                onCategoryId={(id) =>
                  setProductForm((f) => ({ ...f, category_id: id }))
                }
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ProductDialogBrandPick
                brandId={productForm.brand_id}
                knownBrandName={productDialogBrandHint}
                onBrandId={(id, pickedName) => {
                  setProductForm((f) => ({ ...f, brand_id: id }))
                  if (id === null) setProductDialogBrandHint(null)
                  else if (pickedName !== undefined && pickedName !== null) {
                    setProductDialogBrandHint(pickedName)
                  }
                }}
              />
              <div className="space-y-1.5">
                <Label>Texto marca (respaldo)</Label>
                <Input
                  className="app-input"
                  placeholder="Opcional"
                  value={productForm.brand ?? ''}
                  onChange={(e) =>
                    setProductForm((f) => ({
                      ...f,
                      brand: e.target.value || null,
                    }))
                  }
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Formato</Label>
                <Input
                  className="app-input"
                  value={productForm.format ?? ''}
                  onChange={(e) =>
                    setProductForm((f) => ({
                      ...f,
                      format: e.target.value || null,
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Unidad</Label>
                <Input
                  className="app-input"
                  value={productForm.unit ?? ''}
                  onChange={(e) =>
                    setProductForm((f) => ({
                      ...f,
                      unit: e.target.value || null,
                    }))
                  }
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Precio referencia</Label>
                <Input
                  className="app-input"
                  type="number"
                  step="0.01"
                  value={
                    productForm.default_reference_price === null ||
                    productForm.default_reference_price === undefined
                      ? ''
                      : String(productForm.default_reference_price)
                  }
                  onChange={(e) => {
                    const v = e.target.value
                    setProductForm((f) => ({
                      ...f,
                      default_reference_price:
                        v === '' ? null : Number(v),
                    }))
                  }}
                />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input
                  type="checkbox"
                  id="cat-active"
                  checked={productForm.active}
                  onChange={(e) =>
                    setProductForm((f) => ({ ...f, active: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-input"
                />
                <Label htmlFor="cat-active">Activo en catálogo</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setProductDialogOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void submitProduct()}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
