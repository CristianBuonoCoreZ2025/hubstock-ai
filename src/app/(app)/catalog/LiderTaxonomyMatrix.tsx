'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Folder,
  FolderOpen,
  Link,
  Check,
  X,
  Trash2,
  Plus,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertTriangle,
  Sparkles,
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
import {
  detectLiderRetailTaxonomyAction,
  fetchLiderRetailTaxonomyBlockingAction,
  fetchLiderRetailTaxonomySectionsAction,
  fetchLiderRetailTaxonomyBlockingSectionsAction,
  fetchLiderRetailTaxonomyCategoriesByLinkedSectionsAction,
  approveLiderRetailTaxonomyLiderSectionAction,
  linkLiderRetailTaxonomyLiderSectionAction,
  ignoreLiderRetailTaxonomyLiderSectionAction,
  discardLiderRetailTaxonomyLiderSectionAction,
  createMasterSectionFromLiderTaxonomySectionAction,
  approveLiderRetailTaxonomyMappingAction,
  ignoreLiderRetailTaxonomyMappingAction,
  discardLiderRetailTaxonomyMappingAction,
  createCategoryAndLinkLiderTaxonomyAction,
  fetchMasterCategoriesForLinkedLiderSectionAction,
  linkLiderRetailTaxonomyMappingToMasterCategoryAction,
} from '@/app/actions/retail-taxonomy'

/* ─────────────── tipos ─────────────── */

type SectionOpt = { id: string; name: string }

type LiderSecRow = {
  id: string
  retailer: string
  external_section: string
  normalized_external_section: string
  source: string | null
  source_url: string | null
  products_count: number
  status: string
  section_id: string | null
  confidence: number | null
  reason: string | null
  master_section_name?: string | null
}

type LiderCatRow = {
  id: string
  retailer: string
  lider_section_id: string | null
  external_section: string
  external_category: string
  normalized_external_category: string
  status: string
  section_id: string | null
  category_id: string | null
  confidence: number | null
  reason: string | null
  products_count: number
  master_category_name?: string | null
  master_section_name?: string | null
}

/* ─────────────── helpers ─────────────── */

const ACTIONABLE_STATUSES = new Set(['pending', 'missing', 'suggested', 'error'])

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    pending: 'Pendiente',
    missing: 'Faltante',
    suggested: 'Sugerido',
    linked: 'Vinculado',
    ignored: 'Ignorado',
    discarded: 'Descartado',
    error: 'Error',
  }
  return map[s] ?? s
}

function statusBadgeClass(s: string): string {
  switch (s) {
    case 'pending':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200'
    case 'missing':
      return 'bg-red-100 text-red-800 border-red-200'
    case 'suggested':
      return 'bg-blue-100 text-blue-800 border-blue-200'
    case 'linked':
      return 'bg-green-100 text-green-800 border-green-200'
    case 'ignored':
      return 'bg-gray-100 text-gray-600 border-gray-200'
    case 'discarded':
      return 'bg-gray-100 text-gray-400 border-gray-200 line-through'
    case 'error':
      return 'bg-rose-100 text-rose-800 border-rose-200'
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200'
  }
}

/* ─────────────── componente ─────────────── */

export function LiderTaxonomyMatrix(props: {
  sections: SectionOpt[]
  refreshToken?: number
  onBlockingChanged?: (blocking: boolean, count: number) => void
}) {
  const { sections, refreshToken = 0, onBlockingChanged } = props
  const router = useRouter()

  const [sectionRows, setSectionRows] = useState<LiderSecRow[]>([])
  const [blockingSections, setBlockingSections] = useState<LiderSecRow[]>([])
  const [categoriesBySectionId, setCategoriesBySectionId] = useState<
    Record<string, LiderCatRow[]>
  >({})
  const [loading, setLoading] = useState(false)
  const [detectBusy, setDetectBusy] = useState(false)
  const [categoriesDeferred, setCategoriesDeferred] = useState(false)
  const [lastDetectSummary, setLastDetectSummary] = useState<string | null>(null)

  const [rowBusy, setRowBusy] = useState<string | null>(null)
  const [secBusy, setSecBusy] = useState<string | null>(null)

  /* dialogs */
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkLiderSectionId, setLinkLiderSectionId] = useState<string | null>(null)
  const [linkMasterId, setLinkMasterId] = useState('')
  const [linkBusy, setLinkBusy] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [createMappingId, setCreateMappingId] = useState<string | null>(null)
  const [createName, setCreateName] = useState('')
  const [createBusy, setCreateBusy] = useState(false)

  const [hubSectionOpen, setHubSectionOpen] = useState(false)
  const [hubSectionRow, setHubSectionRow] = useState<LiderSecRow | null>(null)
  const [hubSectionName, setHubSectionName] = useState('')
  const [hubSectionBusy, setHubSectionBusy] = useState(false)

  const [treeExpanded, setTreeExpanded] = useState<Record<string, boolean>>({})

  const [linkCatOpen, setLinkCatOpen] = useState(false)
  const [linkCatMappingId, setLinkCatMappingId] = useState<string | null>(null)
  const [linkCatOptions, setLinkCatOptions] = useState<{ id: string; name: string }[]>([])
  const [linkCatCategoryId, setLinkCatCategoryId] = useState('')
  const [linkCatBusy, setLinkCatBusy] = useState(false)
  const [linkCatLoading, setLinkCatLoading] = useState(false)

  /* ── visibilidad: solo pendientes ── */
  const visibleSectionRows = useMemo(() => {
    return sectionRows.filter((row) => {
      if (ACTIONABLE_STATUSES.has(row.status)) return true
      if (row.status === 'linked') {
        const cats = categoriesBySectionId[row.id] ?? []
        return cats.some((c) => ACTIONABLE_STATUSES.has(c.status))
      }
      return false
    })
  }, [sectionRows, categoriesBySectionId])

  const refreshBlocking = useCallback(async () => {
    const r = await fetchLiderRetailTaxonomyBlockingAction()
    if (r.ok) {
      setCategoriesDeferred(r.blocking)
      onBlockingChanged?.(r.blocking, r.blockingCount)
    }
  }, [onBlockingChanged])

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [sRes, bRes, catRes] = await Promise.all([
      fetchLiderRetailTaxonomySectionsAction(),
      fetchLiderRetailTaxonomyBlockingSectionsAction(),
      fetchLiderRetailTaxonomyCategoriesByLinkedSectionsAction(),
    ])
    setLoading(false)

    if (sRes.ok) setSectionRows(sRes.sections)
    else toast.error(sRes.error)

    if (bRes.ok) setBlockingSections(bRes.rows)
    else toast.error(bRes.error)

    if (catRes.ok) setCategoriesBySectionId(catRes.bySectionId)
    else {
      setCategoriesBySectionId({})
      toast.error(catRes.error)
    }

    await refreshBlocking()
  }, [refreshBlocking])

  useEffect(() => {
    void loadAll()
  }, [loadAll, refreshToken])

  /* ── detectar taxonomía ── */
  async function runDetect() {
    setDetectBusy(true)
    setLastDetectSummary(null)
    const res = await detectLiderRetailTaxonomyAction()
    setDetectBusy(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }

    if (res.categoriesDeferred) {
      setCategoriesDeferred(true)
      setLastDetectSummary(
        `Secciones detectadas: ${res.sections}. Las categorías quedaron diferidas porque hay secciones pendientes de resolver.`
      )
      toast.success(
        `Secciones: ${res.sections}. Categorías diferidas: aún hay secciones pendientes, faltantes o sugeridas.`,
      )
    } else {
      setCategoriesDeferred(false)
      const seedPart =
        res.masterCatalogMappingsSeeded > 0
          ? ` · Auto-vinculadas: ${res.masterCatalogMappingsSeeded}`
          : ''
      setLastDetectSummary(
        `Secciones: ${res.sections} · Categorías: ${res.categories}${seedPart}`
      )
      toast.success(
        `Secciones: ${res.sections} · Categorías: ${res.categories}${seedPart}`,
      )
    }
    await loadAll()
  }

  /* ── sección: crear maestra ── */
  function openHubCreateMaster(row: LiderSecRow) {
    setHubSectionRow(row)
    setHubSectionName(row.external_section)
    setHubSectionOpen(true)
  }

  async function runCreateHubMasterSection() {
    if (!hubSectionRow) return
    setHubSectionBusy(true)
    const res = await createMasterSectionFromLiderTaxonomySectionAction({
      liderSectionId: hubSectionRow.id,
      name: hubSectionName,
    })
    setHubSectionBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Sección maestra creada y vinculada.')
    setHubSectionOpen(false)
    router.refresh()
    await loadAll()
  }

  /* ── sección: sugerir maestra ── */
  function openLinkMaster(liderSectionId: string) {
    setLinkLiderSectionId(liderSectionId)
    setLinkMasterId(sections[0]?.id ?? '')
    setLinkOpen(true)
  }

  async function runLinkMaster() {
    if (!linkLiderSectionId || !linkMasterId) return
    setLinkBusy(true)
    const res = await linkLiderRetailTaxonomyLiderSectionAction({
      liderSectionId: linkLiderSectionId,
      masterSectionId: linkMasterId,
    })
    setLinkBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Sugerencia registrada. Aprobá el vínculo con el ícono de confirmación.')
    setLinkOpen(false)
    await loadAll()
  }

  /* ── sección: aprobar / ignorar / descartar ── */
  async function runApproveSection(id: string) {
    setSecBusy(id)
    const res = await approveLiderRetailTaxonomyLiderSectionAction({ liderSectionId: id })
    setSecBusy(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Sección aprobada.')
    await loadAll()
  }

  async function runIgnoreSection(id: string) {
    setSecBusy(id)
    const res = await ignoreLiderRetailTaxonomyLiderSectionAction({ liderSectionId: id })
    setSecBusy(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Sección ignorada.')
    await loadAll()
  }

  async function runDiscardSection(id: string) {
    setSecBusy(id)
    const res = await discardLiderRetailTaxonomyLiderSectionAction({ liderSectionId: id })
    setSecBusy(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Sección descartada.')
    await loadAll()
  }

  /* ── categoría: aprobar / ignorar / descartar ── */
  async function runApproveMapping(id: string) {
    setRowBusy(id)
    const res = await approveLiderRetailTaxonomyMappingAction({ mappingId: id })
    setRowBusy(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Categoría aprobada.')
    await loadAll()
  }

  async function runIgnoreMapping(id: string) {
    setRowBusy(id)
    const res = await ignoreLiderRetailTaxonomyMappingAction({ mappingId: id })
    setRowBusy(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Categoría ignorada.')
    await loadAll()
  }

  async function runDiscardMapping(id: string) {
    setRowBusy(id)
    const res = await discardLiderRetailTaxonomyMappingAction({ mappingId: id })
    setRowBusy(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Categoría descartada.')
    await loadAll()
  }

  /* ── categoría: crear maestra ── */
  function openCreateCategory(mappingId: string, defaultName: string) {
    setCreateMappingId(mappingId)
    setCreateName(defaultName)
    setCreateOpen(true)
  }

  async function runCreateCategory() {
    if (!createMappingId) return
    setCreateBusy(true)
    const res = await createCategoryAndLinkLiderTaxonomyAction({
      mappingId: createMappingId,
      categoryName: createName,
    })
    setCreateBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Categoría creada y vinculada.')
    setCreateOpen(false)
    await loadAll()
  }

  /* ── categoría: relacionar con maestra ── */
  async function openLinkCategoryToMaster(mappingId: string, liderSectionId: string) {
    setLinkCatMappingId(mappingId)
    setLinkCatCategoryId('')
    setLinkCatOptions([])
    setLinkCatOpen(true)
    setLinkCatLoading(true)
    const res = await fetchMasterCategoriesForLinkedLiderSectionAction({ liderSectionId })
    setLinkCatLoading(false)
    if (!res.ok) {
      toast.error(res.error)
      setLinkCatOpen(false)
      return
    }
    setLinkCatOptions(res.categories)
    if (res.categories.length > 0) {
      setLinkCatCategoryId(res.categories[0]!.id)
    }
  }

  async function runLinkCategoryToMaster() {
    if (!linkCatMappingId || !linkCatCategoryId) return
    setLinkCatBusy(true)
    const res = await linkLiderRetailTaxonomyMappingToMasterCategoryAction({
      mappingId: linkCatMappingId,
      categoryId: linkCatCategoryId,
    })
    setLinkCatBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Categoría maestra asignada. Revisá y aprobá si quedó como sugerida.')
    setLinkCatOpen(false)
    await loadAll()
  }

  /* ── tree toggle ── */
  function toggleTreeSection(sectionId: string, defaultExpandedWhenUnset: boolean) {
    setTreeExpanded((prev) => {
      const isOpen = prev[sectionId] ?? defaultExpandedWhenUnset
      return { ...prev, [sectionId]: !isOpen }
    })
  }

  function isSectionTreeExpanded(sectionId: string, defaultExpandedWhenUnset: boolean): boolean {
    return treeExpanded[sectionId] ?? defaultExpandedWhenUnset
  }

  const sortedMasterSections = [...sections].sort((a, b) =>
    a.name.localeCompare(b.name, 'es'),
  )

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Taxonomía Lider</h3>
          <p className="text-sm text-muted-foreground">
            Detectá secciones y categorías reales desde super.lider.cl. Compará contra el catálogo
            maestro y resolvé solo las diferencias.
          </p>
        </div>
        <Button
          onClick={runDetect}
          disabled={detectBusy}
          className="h-9 gap-2"
        >
          {detectBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {detectBusy ? 'Detectando…' : 'Detectar taxonomía'}
        </Button>
      </div>

      {/* resumen última detección */}
      {lastDetectSummary && (
        <div className="rounded-lg border border-border bg-card p-3 text-sm shadow-sm">
          <span className="font-medium">Última detección:</span>{' '}
          <span className="text-muted-foreground">{lastDetectSummary}</span>
        </div>
      )}

      {/* banner categoriesDeferred */}
      {categoriesDeferred && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold">Categorías diferidas: Sí</p>
            <p className="text-amber-800">
              Hay secciones Lider pendientes de resolver. Las categorías no se actualizaron.
              Resolvé las secciones de abajo y volvé a detectar.
            </p>
          </div>
        </div>
      )}

      {/* secciones bloqueantes resumen */}
      {blockingSections.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm">
          <p className="font-semibold text-red-900">
            Secciones bloqueantes ({blockingSections.length})
          </p>
          <ul className="mt-2 space-y-1">
            {blockingSections.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-red-800">
                <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                {r.external_section} · {statusLabel(r.status)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* árbol */}
      <div className="rounded-lg border border-border bg-card shadow-sm">
        {loading && sectionRows.length === 0 && (
          <div className="flex items-center justify-center gap-2 p-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando taxonomía…
          </div>
        )}

        {!loading && visibleSectionRows.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {sectionRows.length === 0
              ? 'Aún no hay datos. Ejecutá la detección para leer la taxonomía real de Lider.'
              : 'No hay secciones ni categorías pendientes. Todo está resuelto, ignorado o descartado.'}
          </div>
        )}

        <div className="divide-y divide-border">
          {visibleSectionRows.map((row) => {
            const catRows = categoriesBySectionId[row.id] ?? []
            const visibleCats = catRows.filter((c) => ACTIONABLE_STATUSES.has(c.status))
            const defaultExpanded = row.status === 'linked' && visibleCats.length > 0
            const expanded = isSectionTreeExpanded(row.id, defaultExpanded)
            const SectionIcon = expanded ? FolderOpen : Folder

            return (
              <div key={row.id} className="p-4">
                {/* fila sección */}
                <div className="flex items-start justify-between gap-3">
                  <button
                    onClick={() => toggleTreeSection(row.id, defaultExpanded)}
                    className="flex items-center gap-2 text-left"
                  >
                    <SectionIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="font-medium">{row.external_section}</span>
                    {visibleCats.length > 0 && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {visibleCats.length}
                      </span>
                    )}
                  </button>

                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-md border px-2 py-0.5 text-xs ${statusBadgeClass(row.status)}`}
                    >
                      {statusLabel(row.status)}
                    </span>
                    {row.master_section_name && (
                      <span className="text-xs text-muted-foreground">
                        → {row.master_section_name}
                      </span>
                    )}
                    {row.confidence != null && (
                      <span className="text-xs text-muted-foreground">
                        conf. {Number(row.confidence).toFixed(2)}
                      </span>
                    )}

                    {/* acciones */}
                    {row.status !== 'linked' &&
                      row.status !== 'ignored' &&
                      row.status !== 'discarded' && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Crear sección maestra"
                            onClick={() => openHubCreateMaster(row)}
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                          {row.status === 'suggested' && row.section_id && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="Aprobar"
                              onClick={() => runApproveSection(row.id)}
                              disabled={secBusy === row.id}
                            >
                              {secBusy === row.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Check className="h-3.5 w-3.5 text-green-600" />
                              )}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Sugerir sección maestra"
                            onClick={() => openLinkMaster(row.id)}
                          >
                            <Link className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Ignorar"
                            onClick={() => runIgnoreSection(row.id)}
                            disabled={secBusy === row.id}
                          >
                            <X className="h-3.5 w-3.5 text-gray-500" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Descartar"
                            onClick={() => runDiscardSection(row.id)}
                            disabled={secBusy === row.id}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-400" />
                          </Button>
                        </>
                      )}
                  </div>
                </div>

                {/* categorías */}
                {expanded && (
                  <div className="mt-3 space-y-2 pl-6">
                    {row.status !== 'linked' ? (
                      <p className="text-xs text-muted-foreground">
                        Vinculá la sección con el catálogo maestro para ver y resolver las
                        categorías Lider de esta rama.
                      </p>
                    ) : visibleCats.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No hay categorías pendientes en esta sección.
                      </p>
                    ) : (
                      visibleCats.map((r) => (
                        <div
                          key={r.id}
                          className="flex items-start justify-between gap-3 rounded-md border border-border bg-background/50 p-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{r.external_category}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                              <span
                                className={`rounded border px-1.5 py-0.5 ${statusBadgeClass(r.status)}`}
                              >
                                {statusLabel(r.status)}
                              </span>
                              {r.master_category_name && (
                                <span className="text-muted-foreground">
                                  → {r.master_category_name}
                                </span>
                              )}
                              {r.confidence != null && (
                                <span className="text-muted-foreground">
                                  conf. {Number(r.confidence).toFixed(2)}
                                </span>
                              )}
                              {r.products_count > 0 && (
                                <span className="text-muted-foreground">
                                  ~{r.products_count} productos capturados
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
                            {r.status === 'suggested' && r.category_id && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title="Aprobar"
                                onClick={() => runApproveMapping(r.id)}
                                disabled={rowBusy === r.id}
                              >
                                {rowBusy === r.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Check className="h-3.5 w-3.5 text-green-600" />
                                )}
                              </Button>
                            )}
                            {!r.category_id && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  title="Crear categoría maestra"
                                  onClick={() => openCreateCategory(r.id, r.external_category)}
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  title="Relacionar con categoría maestra"
                                  onClick={() =>
                                    openLinkCategoryToMaster(r.id, row.id)
                                  }
                                >
                                  <Link className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="Ignorar"
                              onClick={() => runIgnoreMapping(r.id)}
                              disabled={rowBusy === r.id}
                            >
                              <X className="h-3.5 w-3.5 text-gray-500" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="Descartar"
                              onClick={() => runDiscardMapping(r.id)}
                              disabled={rowBusy === r.id}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-400" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── dialogs ── */}

      {/* Crear sección maestra */}
      <Dialog open={hubSectionOpen} onOpenChange={setHubSectionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva sección maestra desde Lider</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            El catálogo maestro es compartido: no creamos secciones en automático. Al confirmar,
            se agrega la sección en el catálogo y queda vinculada a esta fila Lider.
          </p>
          <div className="space-y-2">
            <Label>Nombre de la sección maestra</Label>
            <Input
              value={hubSectionName}
              onChange={(e) => setHubSectionName(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setHubSectionOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={runCreateHubMasterSection} disabled={hubSectionBusy}>
              {hubSectionBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Crear y vincular
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Sugerir sección maestra */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sugerir sección maestra</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Elegí la sección de Supabase equivalente. La fila quedará como sugerida hasta que la
            apruebes.
          </p>
          <div className="space-y-2">
            <Label>Sección maestra</Label>
            <Select value={linkMasterId} onValueChange={setLinkMasterId}>
              <SelectTrigger>
                <SelectValue placeholder="Elegir sección…" />
              </SelectTrigger>
              <SelectContent>
                {sortedMasterSections.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setLinkOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={runLinkMaster} disabled={linkBusy || !linkMasterId}>
              {linkBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar sugerencia
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Crear categoría maestra */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva categoría maestra</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Se crea en la sección maestra ya vinculada a la sección Lider padre.
          </p>
          <div className="space-y-2">
            <Label>Nombre categoría</Label>
            <Input
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={runCreateCategory} disabled={createBusy || !createName.trim()}>
              {createBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Crear y vincular
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Relacionar categoría con maestra */}
      <Dialog open={linkCatOpen} onOpenChange={setLinkCatOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Relacionar con categoría maestra</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Elegí una categoría que ya exista en la sección maestra vinculada. El mapeo quedará
            como sugerido hasta que lo apruebes.
          </p>
          {linkCatLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando categorías…
            </div>
          ) : linkCatOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay categorías maestras en la sección vinculada.
            </p>
          ) : (
            <div className="space-y-2">
              <Label>Categoría maestra</Label>
              <Select value={linkCatCategoryId} onValueChange={setLinkCatCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Elegir categoría…" />
                </SelectTrigger>
                <SelectContent>
                  {linkCatOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setLinkCatOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={runLinkCategoryToMaster}
              disabled={linkCatBusy || !linkCatCategoryId || linkCatOptions.length === 0}
            >
              {linkCatBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar relación
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}