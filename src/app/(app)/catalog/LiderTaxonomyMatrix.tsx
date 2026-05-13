'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Ban,
  Check,
  ChevronDown,
  CirclePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Link2,
  Loader2,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  approveLiderRetailTaxonomyLiderSectionAction,
  approveLiderRetailTaxonomyMappingAction,
  createCategoryAndLinkLiderTaxonomyAction,
  createMasterSectionFromLiderTaxonomySectionAction,
  detectLiderRetailTaxonomyAction,
  discardLiderRetailTaxonomyLiderSectionAction,
  discardLiderRetailTaxonomyMappingAction,
  fetchLiderRetailTaxonomyBlockingAction,
  fetchLiderRetailTaxonomyBlockingSectionsAction,
  fetchLiderRetailTaxonomyCategoriesByLinkedSectionsAction,
  fetchLiderRetailTaxonomySectionsAction,
  fetchMasterCategoriesForLinkedLiderSectionAction,
  ignoreLiderRetailTaxonomyLiderSectionAction,
  ignoreLiderRetailTaxonomyMappingAction,
  linkLiderRetailTaxonomyLiderSectionAction,
  linkLiderRetailTaxonomyMappingToMasterCategoryAction,
  type RetailTaxonomyMappingUiRow,
} from '@/app/actions/retail-taxonomy'
import type { RetailTaxonomyLiderSectionRow } from '@/server/retail/taxonomy/lider-taxonomy-service'
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

type SectionOpt = {
  id: string
  name: string
  sort_order: number
}

type Props = {
  sections: SectionOpt[]
  refreshToken?: number
  onBlockingChanged?: (blocking: boolean, count: number) => void
}

const ACTIONABLE_STATUSES = new Set(['pending', 'missing', 'suggested', 'error'])
const CLOSED_STATUSES = new Set(['linked', 'ignored', 'discarded'])
const TOOLBAR_BTN = 'h-9 min-w-[190px] shrink-0'

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: 'Pendiente',
    missing: 'Faltante',
    suggested: 'Sugerido',
    linked: 'Vinculado',
    ignored: 'Ignorado',
    discarded: 'Descartado',
    error: 'Error',
  }

  return labels[status] ?? status
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'pending':
      return 'border-amber-200 bg-amber-50 text-amber-800'
    case 'missing':
      return 'border-red-200 bg-red-50 text-red-800'
    case 'suggested':
      return 'border-blue-200 bg-blue-50 text-blue-800'
    case 'linked':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800'
    case 'ignored':
      return 'border-slate-200 bg-slate-50 text-slate-600'
    case 'discarded':
      return 'border-slate-200 bg-slate-50 text-slate-400'
    case 'error':
      return 'border-rose-200 bg-rose-50 text-rose-800'
    default:
      return 'border-border bg-muted text-muted-foreground'
  }
}

function isActionable(status: string): boolean {
  return ACTIONABLE_STATUSES.has(status)
}

function isClosed(status: string): boolean {
  return CLOSED_STATUSES.has(status)
}

export function LiderTaxonomyMatrix({
  sections,
  refreshToken = 0,
  onBlockingChanged,
}: Props) {
  const router = useRouter()

  const [sectionRows, setSectionRows] = useState<RetailTaxonomyLiderSectionRow[]>([])
  const [blockingSections, setBlockingSections] = useState<RetailTaxonomyLiderSectionRow[]>([])
  const [categoriesBySectionId, setCategoriesBySectionId] = useState<
    Record<string, RetailTaxonomyMappingUiRow[]>
  >({})

  const [loading, setLoading] = useState(false)
  const [detectBusy, setDetectBusy] = useState(false)
  const [categoriesDeferred, setCategoriesDeferred] = useState(false)
  const [lastDetectSummary, setLastDetectSummary] = useState<string | null>(null)

  const [rowBusy, setRowBusy] = useState<string | null>(null)
  const [secBusy, setSecBusy] = useState<string | null>(null)

  const [linkOpen, setLinkOpen] = useState(false)
  const [linkLiderSectionId, setLinkLiderSectionId] = useState<string | null>(null)
  const [linkMasterId, setLinkMasterId] = useState('')
  const [linkBusy, setLinkBusy] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [createMappingId, setCreateMappingId] = useState<string | null>(null)
  const [createName, setCreateName] = useState('')
  const [createBusy, setCreateBusy] = useState(false)

  const [hubSectionOpen, setHubSectionOpen] = useState(false)
  const [hubSectionRow, setHubSectionRow] =
    useState<RetailTaxonomyLiderSectionRow | null>(null)
  const [hubSectionName, setHubSectionName] = useState('')
  const [hubSectionBusy, setHubSectionBusy] = useState(false)

  const [treeExpanded, setTreeExpanded] = useState<Record<string, boolean>>({})

  const [linkCatOpen, setLinkCatOpen] = useState(false)
  const [linkCatMappingId, setLinkCatMappingId] = useState<string | null>(null)
  const [linkCatOptions, setLinkCatOptions] = useState<{ id: string; name: string }[]>([])
  const [linkCatCategoryId, setLinkCatCategoryId] = useState('')
  const [linkCatBusy, setLinkCatBusy] = useState(false)
  const [linkCatLoading, setLinkCatLoading] = useState(false)

  const sortedMasterSections = useMemo(() => {
    return [...sections].sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }, [sections])

  const visibleSectionRows = useMemo(() => {
    return sectionRows.filter((row) => {
      if (isActionable(row.status)) return true

      if (row.status === 'linked') {
        const categories = categoriesBySectionId[row.id] ?? []
        return categories.some((category) => isActionable(category.status))
      }

      return false
    })
  }, [sectionRows, categoriesBySectionId])

  const pendingCategoriesCount = useMemo(() => {
    return Object.values(categoriesBySectionId)
      .flat()
      .filter((row) => isActionable(row.status)).length
  }, [categoriesBySectionId])

  const linkedCategoriesCount = useMemo(() => {
    return Object.values(categoriesBySectionId)
      .flat()
      .filter((row) => row.status === 'linked').length
  }, [categoriesBySectionId])

  const pendingSectionsCount = useMemo(() => {
    return sectionRows.filter((row) => isActionable(row.status)).length
  }, [sectionRows])

  const refreshBlocking = useCallback(async () => {
    const res = await fetchLiderRetailTaxonomyBlockingAction()

    if (res.ok) {
      onBlockingChanged?.(res.blocking, res.blockingCount)
    }
  }, [onBlockingChanged])

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [sectionsRes, blockingRes, categoriesRes] = await Promise.all([
        fetchLiderRetailTaxonomySectionsAction(),
        fetchLiderRetailTaxonomyBlockingSectionsAction(),
        fetchLiderRetailTaxonomyCategoriesByLinkedSectionsAction(),
      ])

      if (sectionsRes.ok) {
        setSectionRows(sectionsRes.sections)
      } else {
        toast.error(sectionsRes.error)
      }

      if (blockingRes.ok) {
        setBlockingSections(blockingRes.rows)
      } else {
        toast.error(blockingRes.error)
      }

      if (categoriesRes.ok) {
        setCategoriesBySectionId(categoriesRes.bySectionId)
      } else {
        setCategoriesBySectionId({})
        toast.error(categoriesRes.error)
      }

      await refreshBlocking()
    } finally {
      setLoading(false)
    }
  }, [refreshBlocking])

  useEffect(() => {
    void loadAll()
  }, [loadAll, refreshToken])

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
        `Secciones detectadas: ${res.sections}. Las categorías quedaron diferidas porque hay secciones pendientes de resolver.`,
      )

      toast.success(
        `Secciones: ${res.sections}. Categorías diferidas: aún hay secciones pendientes, faltantes o sugeridas.`,
      )
    } else {
      setCategoriesDeferred(false)

      const seedPart =
        res.masterCatalogMappingsSeeded > 0
          ? ` · Auto vinculadas: ${res.masterCatalogMappingsSeeded}`
          : ''

      setLastDetectSummary(
        `Secciones: ${res.sections} · Categorías: ${res.categories}${seedPart}`,
      )

      toast.success(`Secciones: ${res.sections} · Categorías: ${res.categories}${seedPart}`)
    }

    await loadAll()
  }

  function openHubCreateMaster(row: RetailTaxonomyLiderSectionRow) {
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

  function openLinkMaster(liderSectionId: string) {
    setLinkLiderSectionId(liderSectionId)
    setLinkMasterId(sortedMasterSections[0]?.id ?? '')
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

    toast.success('Sugerencia registrada. Aprueba el vínculo para cerrar la sección.')
    setLinkOpen(false)

    await loadAll()
  }

  async function runApproveSection(id: string) {
    setSecBusy(id)

    const res = await approveLiderRetailTaxonomyLiderSectionAction({
      liderSectionId: id,
    })

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

    const res = await ignoreLiderRetailTaxonomyLiderSectionAction({
      liderSectionId: id,
    })

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

    const res = await discardLiderRetailTaxonomyLiderSectionAction({
      liderSectionId: id,
    })

    setSecBusy(null)

    if (!res.ok) {
      toast.error(res.error)
      return
    }

    toast.success('Sección descartada.')
    await loadAll()
  }

  async function runApproveMapping(id: string) {
    setRowBusy(id)

    const res = await approveLiderRetailTaxonomyMappingAction({
      mappingId: id,
    })

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

    const res = await ignoreLiderRetailTaxonomyMappingAction({
      mappingId: id,
    })

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

    const res = await discardLiderRetailTaxonomyMappingAction({
      mappingId: id,
    })

    setRowBusy(null)

    if (!res.ok) {
      toast.error(res.error)
      return
    }

    toast.success('Categoría descartada.')
    await loadAll()
  }

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

  async function openLinkCategoryToMaster(mappingId: string, liderSectionId: string) {
    setLinkCatMappingId(mappingId)
    setLinkCatCategoryId('')
    setLinkCatOptions([])
    setLinkCatOpen(true)
    setLinkCatLoading(true)

    const res = await fetchMasterCategoriesForLinkedLiderSectionAction({
      liderSectionId,
    })

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

    toast.success('Categoría maestra asignada. Revisa y aprueba si quedó como sugerida.')
    setLinkCatOpen(false)

    await loadAll()
  }

  function toggleTreeSection(sectionId: string, defaultExpandedWhenUnset: boolean) {
    setTreeExpanded((prev) => {
      const isOpen = prev[sectionId] ?? defaultExpandedWhenUnset
      return { ...prev, [sectionId]: !isOpen }
    })
  }

  function isSectionTreeExpanded(
    sectionId: string,
    defaultExpandedWhenUnset: boolean,
  ): boolean {
    return treeExpanded[sectionId] ?? defaultExpandedWhenUnset
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-[15px] font-semibold text-foreground">
            Taxonomía Lider
          </h3>

          <p className="mt-1 max-w-prose text-[13px] leading-snug text-muted-foreground">
            Detecta secciones y categorías reales desde Lider. Compara contra el catálogo
            maestro y muestra solo diferencias pendientes. Si solo necesitas revisar rutas en
            un archivo de texto (sin productos ni guardar en base), usa «Exportar diagnóstico
            .txt» en el bloque de captura que está debajo de esta tarjeta.
          </p>
        </div>

        <Button
          type="button"
          onClick={() => void runDetect()}
          disabled={detectBusy}
          className={TOOLBAR_BTN}
        >
          {detectBusy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" aria-hidden />
          )}
          {detectBusy ? 'Detectando…' : 'Detectar taxonomía'}
        </Button>
      </div>

      {lastDetectSummary ? (
        <div className="rounded-lg border border-border bg-background px-4 py-3 text-[13px] shadow-sm">
          <span className="font-medium text-foreground">Última detección:</span>{' '}
          <span className="text-muted-foreground">{lastDetectSummary}</span>
        </div>
      ) : null}

      {categoriesDeferred ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
          <div>
            <p className="font-semibold">Categorías diferidas: Sí</p>
            <p className="text-amber-800">
              Hay secciones Lider pendientes de resolver. Las categorías no se actualizaron.
              Resuelve las secciones de abajo y vuelve a detectar.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-background px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Secciones detectadas
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {sectionRows.length}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-background px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Secciones pendientes
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {pendingSectionsCount}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-background px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Categorías pendientes
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {pendingCategoriesCount}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-background px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Categorías resueltas
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {linkedCategoriesCount}
          </p>
        </div>
      </div>

      {blockingSections.length > 0 ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm">
          <p className="font-semibold text-red-900">
            Secciones bloqueantes ({blockingSections.length})
          </p>

          <ul className="mt-2 space-y-1">
            {blockingSections.map((row) => (
              <li key={row.id} className="flex items-center gap-2 text-red-800">
                <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                {row.external_section} · {statusLabel(row.status)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-background shadow-sm">
        {loading && sectionRows.length === 0 ? (
          <div className="flex items-center justify-center gap-2 p-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Cargando taxonomía…
          </div>
        ) : null}

        {!loading && visibleSectionRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {sectionRows.length === 0
              ? 'Aún no hay datos. Ejecuta la detección para leer la taxonomía real de Lider.'
              : 'No hay secciones ni categorías pendientes. Todo está resuelto, ignorado o descartado.'}
          </div>
        ) : null}

        <div className="divide-y divide-border">
          {visibleSectionRows.map((row) => {
            const catRows = categoriesBySectionId[row.id] ?? []
            const visibleCats = catRows.filter((category) =>
              isActionable(category.status),
            )
            const defaultExpanded = row.status === 'linked' && visibleCats.length > 0
            const expanded = isSectionTreeExpanded(row.id, defaultExpanded)
            const SectionIcon = expanded ? FolderOpen : Folder

            return (
              <div key={row.id} className="p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <button
                    type="button"
                    onClick={() => toggleTreeSection(row.id, defaultExpanded)}
                    className="flex min-w-0 items-center gap-2 text-left"
                  >
                    <SectionIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />

                    <span className="truncate font-medium text-foreground">
                      {row.external_section}
                    </span>

                    {visibleCats.length > 0 ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {visibleCats.length}
                      </span>
                    ) : null}

                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                        expanded ? 'rotate-180' : ''
                      }`}
                      aria-hidden
                    />
                  </button>

                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-md border px-2 py-0.5 text-xs ${statusBadgeClass(
                        row.status,
                      )}`}
                    >
                      {statusLabel(row.status)}
                    </span>

                    {row.master_section_name ? (
                      <span className="text-xs text-muted-foreground">
                        → {row.master_section_name}
                      </span>
                    ) : null}

                    {row.confidence != null ? (
                      <span className="text-xs text-muted-foreground">
                        conf. {Number(row.confidence).toFixed(2)}
                      </span>
                    ) : null}

                    {!isClosed(row.status) ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1"
                          disabled={secBusy === row.id}
                          onClick={() => openHubCreateMaster(row)}
                        >
                          <CirclePlus className="h-3.5 w-3.5" aria-hidden />
                          Crear
                        </Button>

                        {row.status === 'suggested' && row.section_id ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1"
                            disabled={secBusy === row.id}
                            onClick={() => void runApproveSection(row.id)}
                          >
                            {secBusy === row.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                            ) : (
                              <Check className="h-3.5 w-3.5" aria-hidden />
                            )}
                            Aprobar
                          </Button>
                        ) : null}

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1"
                          disabled={secBusy === row.id}
                          onClick={() => openLinkMaster(row.id)}
                        >
                          <Link2 className="h-3.5 w-3.5" aria-hidden />
                          Relacionar
                        </Button>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1"
                          disabled={secBusy === row.id}
                          onClick={() => void runIgnoreSection(row.id)}
                        >
                          <Ban className="h-3.5 w-3.5" aria-hidden />
                          Ignorar
                        </Button>

                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          className="h-8 gap-1"
                          disabled={secBusy === row.id}
                          onClick={() => void runDiscardSection(row.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          Descartar
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>

                {expanded ? (
                  <div className="mt-3 space-y-2 border-l border-dashed border-border pl-5">
                    {row.status !== 'linked' ? (
                      <p className="text-xs text-muted-foreground">
                        Vincula la sección con el catálogo maestro para ver y resolver las
                        categorías Lider de esta rama.
                      </p>
                    ) : visibleCats.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No hay categorías pendientes en esta sección.
                      </p>
                    ) : (
                      visibleCats.map((category) => (
                        <div
                          key={category.id}
                          className="flex flex-col gap-3 rounded-md border border-border bg-card p-3 lg:flex-row lg:items-start lg:justify-between"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground">
                              {category.external_category}
                            </p>

                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                              <span
                                className={`rounded border px-1.5 py-0.5 ${statusBadgeClass(
                                  category.status,
                                )}`}
                              >
                                {statusLabel(category.status)}
                              </span>

                              {category.master_category_name ? (
                                <span className="text-muted-foreground">
                                  → {category.master_category_name}
                                </span>
                              ) : null}

                              {category.confidence != null ? (
                                <span className="text-muted-foreground">
                                  conf. {Number(category.confidence).toFixed(2)}
                                </span>
                              ) : null}

                              {category.products_count > 0 ? (
                                <span className="text-muted-foreground">
                                  ~{category.products_count} productos capturados
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {category.status === 'suggested' && category.category_id ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1"
                                disabled={rowBusy === category.id}
                                onClick={() => void runApproveMapping(category.id)}
                              >
                                {rowBusy === category.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                                ) : (
                                  <Check className="h-3.5 w-3.5" aria-hidden />
                                )}
                                Aprobar
                              </Button>
                            ) : null}

                            {!category.category_id ? (
                              <>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 gap-1"
                                  disabled={rowBusy === category.id}
                                  onClick={() =>
                                    openCreateCategory(
                                      category.id,
                                      category.external_category,
                                    )
                                  }
                                >
                                  <FolderPlus className="h-3.5 w-3.5" aria-hidden />
                                  Crear
                                </Button>

                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 gap-1"
                                  disabled={rowBusy === category.id}
                                  onClick={() =>
                                    void openLinkCategoryToMaster(category.id, row.id)
                                  }
                                >
                                  <Link2 className="h-3.5 w-3.5" aria-hidden />
                                  Relacionar
                                </Button>
                              </>
                            ) : null}

                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1"
                              disabled={rowBusy === category.id}
                              onClick={() => void runIgnoreMapping(category.id)}
                            >
                              <Ban className="h-3.5 w-3.5" aria-hidden />
                              Ignorar
                            </Button>

                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              className="h-8 gap-1"
                              disabled={rowBusy === category.id}
                              onClick={() => void runDiscardMapping(category.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden />
                              Descartar
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      <Dialog open={hubSectionOpen} onOpenChange={setHubSectionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva sección maestra desde Lider</DialogTitle>
            <DialogDescription>
              El catálogo maestro es compartido. Al confirmar, se agrega la sección en el
              catálogo y queda vinculada a esta fila Lider.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <Label htmlFor="lider-hub-sec-name">Nombre de la sección maestra</Label>
            <Input
              id="lider-hub-sec-name"
              value={hubSectionName}
              onChange={(event) => setHubSectionName(event.target.value)}
              autoComplete="off"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setHubSectionOpen(false)}
            >
              Cancelar
            </Button>

            <Button
              type="button"
              disabled={hubSectionBusy || !hubSectionName.trim()}
              onClick={() => void runCreateHubMasterSection()}
            >
              {hubSectionBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              Crear y vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Relacionar sección Lider</DialogTitle>
            <DialogDescription>
              Elige la sección maestra equivalente. La fila quedará sugerida hasta que la
              apruebes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <Label>Sección maestra</Label>

            <Select value={linkMasterId} onValueChange={setLinkMasterId}>
              <SelectTrigger>
                <SelectValue placeholder="Elegir sección" />
              </SelectTrigger>

              <SelectContent>
                {sortedMasterSections.map((section) => (
                  <SelectItem key={section.id} value={section.id}>
                    {section.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => setLinkOpen(false)}>
              Cancelar
            </Button>

            <Button
              type="button"
              disabled={linkBusy || !linkMasterId}
              onClick={() => void runLinkMaster()}
            >
              {linkBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              Guardar relación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva categoría maestra</DialogTitle>
            <DialogDescription>
              Se crea en la sección maestra ya vinculada a la sección Lider padre.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <Label htmlFor="lider-tax-cat-name">Nombre categoría</Label>
            <Input
              id="lider-tax-cat-name"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              autoComplete="off"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>

            <Button
              type="button"
              disabled={createBusy || !createName.trim()}
              onClick={() => void runCreateCategory()}
            >
              {createBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              Crear y vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={linkCatOpen} onOpenChange={setLinkCatOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Relacionar con categoría maestra</DialogTitle>
            <DialogDescription>
              Elige una categoría existente en la sección maestra vinculada. El mapeo queda
              sugerido hasta que lo apruebes.
            </DialogDescription>
          </DialogHeader>

          {linkCatLoading ? (
            <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Cargando categorías…
            </p>
          ) : linkCatOptions.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No hay categorías maestras en la sección vinculada.
            </p>
          ) : (
            <div className="space-y-2 py-2">
              <Label>Categoría maestra</Label>

              <Select value={linkCatCategoryId} onValueChange={setLinkCatCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Elegir categoría" />
                </SelectTrigger>

                <SelectContent>
                  {linkCatOptions.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => setLinkCatOpen(false)}>
              Cancelar
            </Button>

            <Button
              type="button"
              disabled={linkCatBusy || linkCatLoading || !linkCatCategoryId}
              onClick={() => void runLinkCategoryToMaster()}
            >
              {linkCatBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              Guardar relación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}