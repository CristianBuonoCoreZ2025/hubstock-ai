'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { History, Link2, Link2Off, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  CatalogTabHeader,
  SectionSearchCombo,
} from '@/app/(app)/catalog/catalog-ui'
import {
  fetchRetailListingsPage,
  fetchRetailMatchCandidatesAction,
  fetchRetailPriceHistory,
  linkRetailListingAction,
  unlinkRetailListingAction,
  type RetailListingRow,
  type RetailMatchCandidate,
  type RetailHistoryRow,
} from '@/app/actions/catalog-retail'
import { searchCatalogProductsForPickerAction } from '@/app/actions/catalog'
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

  const [retailerFilter, setRetailerFilter] = useState<string>('all')
  const [unlinkedOnly, setUnlinkedOnly] = useState(false)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 400)
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<RetailListingRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(true)

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
      toast.error(res.error)
      setRows([])
      setTotal(null)
      setHasNext(false)
      return
    }
    setRows(res.rows)
    setTotal(res.total)
    setHasNext(res.hasNextPage)
  }, [debouncedSearch, page, retailerFilter, unlinkedOnly])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    setPage(0)
  }, [debouncedSearch, retailerFilter, unlinkedOnly])

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

  return (
    <div className="space-y-4">
      <CatalogTabHeader
        title="Precios por cadena"
        description="Flujo y anti-duplicados: scripts/RETAIL_CAPTURE.md · Datos locales desde scrapers; homologación manual aquí o --auto-match en import_retail_snapshots.py (misma RPC inteligente que las sugerencias)."
      />

      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[160px] space-y-1.5">
            <Label className="text-[12px]">Cadena</Label>
            <Select value={retailerFilter} onValueChange={setRetailerFilter}>
              <SelectTrigger className="app-input h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
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
          <div className="min-w-[min(100%,280px)] flex-[2] space-y-1.5">
            <Label className="text-[12px]">Buscar</Label>
            <Input
              className="app-input h-9"
              placeholder="Nombre, referencia, categoría o descripción del ítem…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <p className="mt-3 text-[12px] text-muted-foreground">
          Cada importación agrega una captura nueva con fecha: sirve como historial de precios por ítem
          (retailer + referencia externa).
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
                  No hay capturas retail. Ejecuta el importador, por ejemplo{' '}
                  <code className="rounded bg-muted px-1 text-[12px]">
                    python scripts/import_retail_snapshots.py --retailer central_mayorista
                  </code>
                  .
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
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1"
                        onClick={() => void openHistory(row)}
                      >
                        <History className="h-3.5 w-3.5" />
                        Historial
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 gap-1"
                        onClick={() => openHomolog(row)}
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        Homologar
                      </Button>
                      {row.catalog_product_id ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-muted-foreground"
                          onClick={() => void confirmUnlink(row)}
                        >
                          <Link2Off className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
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
              Elegí el producto canónico que corresponde a este ítem de tienda. Podés afinar sugerencias con
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
    </div>
  )
}
