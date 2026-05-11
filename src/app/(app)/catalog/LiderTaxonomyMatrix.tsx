'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  Link2,
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

type SectionOpt = { id: string; name: string; sort_order: number }

const TOOLBAR_BTN = 'h-9 min-w-[200px] shrink-0'
const ROW_ICON = 'h-8 w-8'
/** Ancho fijo columna chevron + ícono (alineación estilo explorador) */
const TREE_LEAD = 'grid grid-cols-[22px_22px_minmax(0,1fr)_auto] items-center gap-0.5'

/** Categorías que aún requieren acción en el árbol (vinculadas pero no cerradas). */
const CATEGORY_ACTIONABLE_STATUSES = new Set(['pending', 'missing', 'suggested'])

function statusLabel(s: string): string {
  switch (s) {
    case 'linked':
      return 'Vinculado'
    case 'suggested':
      return 'Sugerido'
    case 'pending':
      return 'Pendiente'
    case 'missing':
      return 'Faltante'
    case 'ignored':
      return 'Ignorado'
    case 'discarded':
      return 'Descartado'
    default:
      return s
  }
}

type Props = {
  sections: SectionOpt[]
  refreshToken: number
  onBlockingChanged?: (blocking: boolean, count: number) => void
}

export function LiderTaxonomyMatrix(props: Props) {
  const { sections, refreshToken, onBlockingChanged } = props
  const router = useRouter()
  const [detectBusy, setDetectBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sectionRows, setSectionRows] = useState<RetailTaxonomyLiderSectionRow[]>([])
  const [blockingSections, setBlockingSections] = useState<RetailTaxonomyLiderSectionRow[]>([])
  const [categoriesBySectionId, setCategoriesBySectionId] = useState<
    Record<string, RetailTaxonomyMappingUiRow[]>
  >({})

  const [rowBusy, setRowBusy] = useState<string | null>(null)
  const [secBusy, setSecBusy] = useState<string | null>(null)

  const [linkOpen, setLinkOpen] = useState(false)
  const [linkLiderSectionId, setLinkLiderSectionId] = useState<string | null>(null)
  const [linkMasterId, setLinkMasterId] = useState<string>('')
  const [linkBusy, setLinkBusy] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [createMappingId, setCreateMappingId] = useState<string | null>(null)
  const [createName, setCreateName] = useState('')
  const [createBusy, setCreateBusy] = useState(false)

  const [hubSectionOpen, setHubSectionOpen] = useState(false)
  const [hubSectionRow, setHubSectionRow] = useState<RetailTaxonomyLiderSectionRow | null>(null)
  const [hubSectionName, setHubSectionName] = useState('')
  const [hubSectionBusy, setHubSectionBusy] = useState(false)

  const [treeExpanded, setTreeExpanded] = useState<Record<string, boolean>>({})

  const [linkCatOpen, setLinkCatOpen] = useState(false)
  const [linkCatMappingId, setLinkCatMappingId] = useState<string | null>(null)
  const [linkCatOptions, setLinkCatOptions] = useState<{ id: string; name: string }[]>([])
  const [linkCatCategoryId, setLinkCatCategoryId] = useState('')
  const [linkCatBusy, setLinkCatBusy] = useState(false)
  const [linkCatLoading, setLinkCatLoading] = useState(false)

  const visibleSectionRows = useMemo(() => {
    return sectionRows.filter((row) => {
      const cats = categoriesBySectionId[row.id] ?? []
      if (row.status !== 'linked') return true
      return cats.some((c) => CATEGORY_ACTIONABLE_STATUSES.has(c.status))
    })
  }, [sectionRows, categoriesBySectionId])

  const refreshBlocking = useCallback(async () => {
    const r = await fetchLiderRetailTaxonomyBlockingAction()
    if (r.ok) {
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

  async function runDetect() {
    setDetectBusy(true)
    const res = await detectLiderRetailTaxonomyAction()
    setDetectBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    if (res.categoriesDeferred) {
      toast.success(
        `Secciones procesadas: ${res.sections}. Las categorías no se actualizaron: aún hay secciones pendientes, faltantes o sugeridas.`,
      )
    } else {
      const seedPart =
        res.masterCatalogMappingsSeeded > 0 ?
          ` · Auto-vinculadas a categoría maestra existente: ${res.masterCatalogMappingsSeeded}`
        : ''
      toast.success(`Secciones: ${res.sections} · Categorías (URLs + capturas): ${res.categories}${seedPart}`)
    }
    await loadAll()
  }

  function openLinkMaster(liderSectionId: string) {
    setLinkLiderSectionId(liderSectionId)
    setLinkMasterId(sections[0]?.id ?? '')
    setLinkOpen(true)
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
    toast.success('Sección maestra creada y vinculada al hub Lider.')
    setHubSectionOpen(false)
    router.refresh()
    await loadAll()
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

  function toggleTreeSection(sectionId: string, defaultExpandedWhenUnset: boolean) {
    setTreeExpanded((prev) => {
      const isOpen = prev[sectionId] ?? defaultExpandedWhenUnset
      return { ...prev, [sectionId]: !isOpen }
    })
  }

  function isSectionTreeExpanded(sectionId: string, defaultExpandedWhenUnset: boolean): boolean {
    return treeExpanded[sectionId] ?? defaultExpandedWhenUnset
  }

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

  const sortedMasterSections = [...sections].sort((a, b) => a.name.localeCompare(b.name, 'es'))

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-[14px] font-semibold text-foreground">Taxonomía Lider</h3>
        <Button type="button" className={TOOLBAR_BTN} disabled={detectBusy} onClick={() => void runDetect()}>
          {detectBusy ?
            <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" aria-hidden />
          : null}
          Detectar taxonomía Lider
        </Button>
      </div>
      <p className="max-w-prose text-[12px] leading-snug text-muted-foreground">
        El botón <strong className="font-medium text-foreground">Detectar</strong> hace todo el trabajo: descubre
        secciones, descubre categorías y auto-vincula con el catálogo maestro lo que coincide por nombre. Solo se
        muestran abajo las <strong className="font-medium text-foreground">diferencias</strong> que requieren
        decisión: secciones o categorías Lider que aún no existen como maestras.
      </p>

      <div
        className={`relative overflow-hidden rounded-md border border-border bg-muted/20 shadow-inner dark:bg-muted/10 ${loading ? 'opacity-70' : ''}`}
      >
        {loading && sectionRows.length > 0 ?
          <div className="flex items-center gap-2 border-b border-border/80 bg-muted/40 px-3 py-1.5 text-[12px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
            Actualizando árbol…
          </div>
        : null}

        <div
          role="tree"
          aria-label="Taxonomía Lider"
          className="max-h-[min(70vh,780px)] overflow-y-auto overscroll-contain py-0.5 text-[13px]"
        >
          {sectionRows.length === 0 && !loading ?
            <div className="px-3 py-10 text-center text-[13px] text-muted-foreground">
              {detectBusy ? 'Detectando…' : 'Aún no hay datos. Ejecutá la detección.'}
            </div>
          : null}
          {sectionRows.length > 0 && visibleSectionRows.length === 0 && !loading ?
            <div className="px-3 py-10 text-center text-[13px] text-muted-foreground">
              No hay secciones con categorías pendientes. Si faltan listados (p. ej. La Boti), sincronizá categorías
              después de capturar productos con URLs de esa tienda.
            </div>
          : null}

          {visibleSectionRows.map((row) => {
            const catRows = categoriesBySectionId[row.id] ?? []
            const defaultExpanded = row.status === 'linked'
            const expanded = isSectionTreeExpanded(row.id, defaultExpanded)
            const SectionIcon = expanded ? FolderOpen : Folder

            return (
              <div key={row.id} className="border-b border-border/60 last:border-b-0" role="presentation">
                <div
                  className={`${TREE_LEAD} min-h-9 px-1.5 py-0.5 hover:bg-accent/30`}
                  role="treeitem"
                  aria-expanded={expanded}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-[22px] shrink-0 p-0 text-muted-foreground hover:text-foreground"
                    aria-label={expanded ? 'Plegar' : 'Expandir'}
                    onClick={() => toggleTreeSection(row.id, defaultExpanded)}
                  >
                    {expanded ?
                      <ChevronDown className="h-4 w-4" aria-hidden />
                    : <ChevronRight className="h-4 w-4" aria-hidden />}
                  </Button>
                  <span className="flex h-7 w-[22px] shrink-0 items-center justify-center text-muted-foreground">
                    <SectionIcon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 py-0.5">
                    <div className="truncate font-medium leading-tight text-foreground">{row.external_section}</div>
                    <div className="truncate text-[11px] leading-tight text-muted-foreground">
                      {row.master_section_name ?? 'Sin sección maestra'} · {statusLabel(row.status)}
                      {row.confidence != null ? ` · conf. ${Number(row.confidence).toFixed(2)}` : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-0.5">
                    {row.status !== 'linked' && row.status !== 'ignored' && row.status !== 'discarded' ?
                      <GridRowIconButton
                        className={ROW_ICON}
                        label="Crear sección maestra en el catálogo y vincular (para homologar y dar de alta productos)"
                        disabled={secBusy === row.id}
                        onClick={() => openHubCreateMaster(row)}
                      >
                        <CirclePlus className="h-4 w-4" aria-hidden />
                      </GridRowIconButton>
                    : null}
                    {row.status === 'suggested' && row.section_id ?
                      <GridRowIconButton
                        className={ROW_ICON}
                        label="Aprobar vínculo de sección sugerido"
                        disabled={secBusy === row.id}
                        onClick={() => void runApproveSection(row.id)}
                      >
                        {secBusy === row.id ?
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        : <Check className="h-4 w-4" aria-hidden />}
                      </GridRowIconButton>
                    : null}
                    {row.status !== 'linked' && row.status !== 'ignored' && row.status !== 'discarded' ?
                      <GridRowIconButton
                        className={ROW_ICON}
                        label="Sugerir sección maestra equivalente"
                        disabled={secBusy === row.id}
                        onClick={() => openLinkMaster(row.id)}
                      >
                        <Link2 className="h-4 w-4" aria-hidden />
                      </GridRowIconButton>
                    : null}
                    {row.status !== 'linked' && row.status !== 'ignored' && row.status !== 'discarded' ?
                      <GridRowIconButton
                        className={ROW_ICON}
                        label="Ignorar sección Lider"
                        disabled={secBusy === row.id}
                        onClick={() => void runIgnoreSection(row.id)}
                      >
                        <Ban className="h-4 w-4" aria-hidden />
                      </GridRowIconButton>
                    : null}
                    {row.status !== 'linked' && row.status !== 'ignored' && row.status !== 'discarded' ?
                      <GridRowIconButton
                        className={ROW_ICON}
                        label="Descartar (sin evidencia o basura)"
                        disabled={secBusy === row.id}
                        onClick={() => void runDiscardSection(row.id)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </GridRowIconButton>
                    : null}
                  </div>
                </div>

                {expanded ?
                  <div
                    className="relative ml-[19px] border-l border-dashed border-border/80 pl-2 pr-1.5 pb-1 pt-0"
                    role="group"
                    aria-label={`Contenido de ${row.external_section}`}
                  >
                    {row.status !== 'linked' ?
                      <div className="py-2 pl-1 text-[12px] leading-snug text-muted-foreground">
                        Vinculá la sección con el catálogo maestro para ver y resolver las categorías Lider en esta
                        rama.
                      </div>
                    : catRows.length === 0 ?
                      <div className="py-3 pl-1 text-[12px] text-muted-foreground">
                        No hay categorías en esta carpeta. Sincronizá categorías o volvé a detectar la taxonomía.
                      </div>
                    : (
                      catRows.map((r) => (
                        <div
                          key={r.id}
                          className={`${TREE_LEAD} min-h-8 border-t border-border/40 py-0.5 first:border-t-0 hover:bg-accent/25`}
                          role="treeitem"
                        >
                          <span className="h-7 w-[22px] shrink-0" aria-hidden />
                          <span className="flex h-7 w-[22px] shrink-0 items-center justify-center text-muted-foreground/90">
                            <FileText className="h-3.5 w-3.5" aria-hidden />
                          </span>
                          <div className="min-w-0 py-0.5">
                            <div className="truncate leading-tight text-foreground">{r.external_category}</div>
                            <div className="truncate text-[11px] leading-tight text-muted-foreground">
                              {r.master_category_name ?? 'Sin categoría maestra'} · {statusLabel(r.status)}
                              {r.confidence != null ? ` · conf. ${Number(r.confidence).toFixed(2)}` : ''}
                              {r.products_count > 0 ? ` · ~${r.products_count} en capturas` : null}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap justify-end gap-0.5">
                            {r.status !== 'linked' && r.status !== 'ignored' ?
                              <>
                                {r.status === 'suggested' && r.category_id ?
                                  <GridRowIconButton
                                    className={ROW_ICON}
                                    label="Aprobar vínculo con categoría maestra"
                                    disabled={rowBusy === r.id}
                                    onClick={() => void runApproveMapping(r.id)}
                                  >
                                    {rowBusy === r.id ?
                                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                                    : <Check className="h-4 w-4" aria-hidden />}
                                  </GridRowIconButton>
                                : null}
                                {!r.category_id ?
                                  <>
                                    <GridRowIconButton
                                      className={ROW_ICON}
                                      label="Crear categoría maestra en esta sección y vincular"
                                      disabled={rowBusy === r.id}
                                      onClick={() => openCreateCategory(r.id, r.external_category)}
                                    >
                                      <FolderPlus className="h-4 w-4" aria-hidden />
                                    </GridRowIconButton>
                                    <GridRowIconButton
                                      className={ROW_ICON}
                                      label="Relacionar con categoría maestra existente"
                                      disabled={rowBusy === r.id}
                                      onClick={() => void openLinkCategoryToMaster(r.id, row.id)}
                                    >
                                      <Link2 className="h-4 w-4" aria-hidden />
                                    </GridRowIconButton>
                                  </>
                                : null}
                                <GridRowIconButton
                                  className={ROW_ICON}
                                  label="Ignorar categoría Lider"
                                  disabled={rowBusy === r.id}
                                  onClick={() => void runIgnoreMapping(r.id)}
                                >
                                  <Ban className="h-4 w-4" aria-hidden />
                                </GridRowIconButton>
                                <GridRowIconButton
                                  className={ROW_ICON}
                                  label="Descartar mapeo"
                                  disabled={rowBusy === r.id}
                                  onClick={() => void runDiscardMapping(r.id)}
                                >
                                  <Trash2 className="h-4 w-4" aria-hidden />
                                </GridRowIconButton>
                              </>
                            : null}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                : null}
              </div>
            )
          })}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[12px] font-medium text-muted-foreground">Secciones Lider que requieren acción</p>
        <div className="overflow-hidden rounded-md border border-border bg-muted/15 text-[13px] dark:bg-muted/10">
          {blockingSections.length === 0 ?
            <div className="px-3 py-4 text-center text-muted-foreground">No hay secciones bloqueantes.</div>
          : (
            <ul className="m-0 max-h-48 list-none overflow-y-auto p-0" role="list">
              {blockingSections.map((r) => (
                <li
                  key={`b-${r.id}`}
                  className={`${TREE_LEAD} min-h-9 border-t border-border/50 px-1.5 py-0.5 first:border-t-0 hover:bg-accent/25`}
                >
                  <span className="h-7 w-[22px] shrink-0" aria-hidden />
                  <span className="flex h-7 w-[22px] shrink-0 items-center justify-center text-muted-foreground">
                    <Folder className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 py-0.5">
                    <div className="truncate font-medium leading-tight text-foreground">{r.external_section}</div>
                    <div className="text-[11px] text-muted-foreground">{statusLabel(r.status)}</div>
                  </div>
                  <span className="w-8 shrink-0" aria-hidden />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Dialog open={hubSectionOpen} onOpenChange={setHubSectionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva sección maestra desde Lider</DialogTitle>
            <DialogDescription>
              El catálogo maestro es compartido: no creamos secciones en automático para evitar duplicados o nombres
              incorrectos. Al confirmar, se agrega la sección en el catálogo y queda vinculada a esta fila Lider para que
              puedas seguir con categorías y productos.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="lider-hub-sec-name">Nombre de la sección maestra</Label>
              <Input
                id="lider-hub-sec-name"
                value={hubSectionName}
                onChange={(e) => setHubSectionName(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" className={TOOLBAR_BTN} onClick={() => setHubSectionOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              className={TOOLBAR_BTN}
              disabled={hubSectionBusy || !hubSectionName.trim()}
              onClick={() => void runCreateHubMasterSection()}
            >
              {hubSectionBusy ?
                <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" aria-hidden />
              : null}
              Crear y vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sugerir sección maestra</DialogTitle>
            <DialogDescription>
              Elegí la sección de Supabase equivalente. La fila quedará como sugerida hasta que la apruebes; no se
              considera vinculada de forma definitiva.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label>Sección maestra</Label>
            <Select value={linkMasterId} onValueChange={setLinkMasterId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Elegí sección" />
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
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" className={TOOLBAR_BTN} onClick={() => setLinkOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" className={TOOLBAR_BTN} disabled={linkBusy} onClick={() => void runLinkMaster()}>
              {linkBusy ?
                <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" aria-hidden />
              : null}
              Guardar sugerencia
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva categoría maestra</DialogTitle>
            <DialogDescription>
              Se crea en la sección maestra ya vinculada a la sección Lider padre (no se elige otra sección aquí).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="lider-tax-cat-name">Nombre categoría</Label>
              <Input
                id="lider-tax-cat-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" className={TOOLBAR_BTN} onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" className={TOOLBAR_BTN} disabled={createBusy} onClick={() => void runCreateCategory()}>
              {createBusy ?
                <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" aria-hidden />
              : null}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={linkCatOpen} onOpenChange={setLinkCatOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Relacionar con categoría maestra</DialogTitle>
            <DialogDescription>
              Elegí una categoría que ya exista en la sección maestra vinculada. El mapeo quedará como sugerido hasta que
              lo apruebes con el ícono de confirmación.
            </DialogDescription>
          </DialogHeader>
          {linkCatLoading ?
            <p className="flex items-center gap-2 py-4 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Cargando categorías…
            </p>
          : (
            <div className="space-y-2 py-2">
              <Label htmlFor="lider-link-cat-select">Categoría maestra</Label>
              <Select value={linkCatCategoryId} onValueChange={setLinkCatCategoryId}>
                <SelectTrigger id="lider-link-cat-select" className="mt-1">
                  <SelectValue
                    placeholder={linkCatOptions.length === 0 ? 'No hay categorías en la sección maestra' : 'Elegí categoría'}
                  />
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
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" className={TOOLBAR_BTN} onClick={() => setLinkCatOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              className={TOOLBAR_BTN}
              disabled={linkCatBusy || linkCatLoading || !linkCatCategoryId || linkCatOptions.length === 0}
              onClick={() => void runLinkCategoryToMaster()}
            >
              {linkCatBusy ?
                <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" aria-hidden />
              : null}
              Guardar relación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
