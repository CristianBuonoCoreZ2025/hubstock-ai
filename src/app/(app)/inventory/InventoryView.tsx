'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { GridPagingRow } from '@/components/grid/grid-paging-row'
import { AppSearchBox } from '@/components/search/app-search-box'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ProductDialog } from './ProductDialog'
import type { InventoryRow } from './inventory-rows'
import type { TaxonomyCategory, TaxonomySection } from '@/types/taxonomy'
import { filterBySearch } from '@/lib/search'

type Props = {
  categories: TaxonomyCategory[]
  sections: TaxonomySection[]
  rows: InventoryRow[]
  /** Ayuda alineada con docs/DOMAIN.md (taxonomía sección/categoría vs inventario). */
  lead?: string
  query: {
    page: number
    pageSize: number
    total: number | null
    q: string
    section: string
    category: string
    status: string
    inactive: boolean
  }
}

function statusLabel(s: InventoryRow['status']) {
  switch (s) {
    case 'critical':
      return 'Crítico'
    case 'low':
      return 'Bajo'
    default:
      return 'Normal'
  }
}

function statusClass(s: InventoryRow['status']) {
  switch (s) {
    case 'critical':
      return 'bg-destructive/15 text-destructive'
    case 'low':
      return 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200'
    default:
      return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/12 dark:text-emerald-200'
  }
}

export function InventoryView({ categories, sections, rows, lead, query }: Props) {
  /* eslint-disable react-hooks/set-state-in-effect --
     Inventario: efectos sincronizan query URL y categoría dependiente de sección. */

  const router = useRouter()
  const [searchDraft, setSearchDraft] = useState(query.q)
  const [categoryFilter, setCategoryFilter] = useState<string>(query.category)
  const [sectionFilter, setSectionFilter] = useState<string>(query.section)
  const [statusFilter, setStatusFilter] = useState<string>(query.status)
  const [showInactive, setShowInactive] = useState<boolean>(query.inactive)

  const categoriesForSectionFilter = useMemo(() => {
    if (sectionFilter === 'all') return categories
    return categories.filter((c) => c.section_id === sectionFilter)
  }, [categories, sectionFilter])

  useEffect(() => {
    if (sectionFilter === 'all') return
    const allowed = new Set(categoriesForSectionFilter.map((c) => c.id))
    if (categoryFilter !== 'all' && !allowed.has(categoryFilter)) {
      setCategoryFilter('all')
    }
  }, [sectionFilter, categoriesForSectionFilter, categoryFilter])

  useEffect(() => {
    // Sincroniza cambios de navegación (atrás/adelante) con el estado local.
    setSearchDraft(query.q)
    setCategoryFilter(query.category)
    setSectionFilter(query.section)
    setStatusFilter(query.status)
    setShowInactive(query.inactive)
  }, [query])

  const hasProducts = rows.length > 0

  const filtered = useMemo(() => {
    const base = rows.filter((r) => {
      if (categoryFilter !== 'all' && r.categoryId !== categoryFilter) return false
      if (sectionFilter !== 'all' && r.sectionId !== sectionFilter) return false
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      return true
    })

    // Búsqueda tipo Google (tolerante) sobre la página cargada; el texto aplicado viene del URL (Enter / lupa).
    if (query.q.trim().length < 2) return base
    return filterBySearch(base, query.q, (item) => item.name)
  }, [rows, categoryFilter, sectionFilter, statusFilter, query.q])

  function pushQuery(next: Partial<Props['query']>) {
    const merged: Props['query'] = {
      ...query,
      section: sectionFilter,
      category: categoryFilter,
      status: statusFilter,
      inactive: showInactive,
      ...next,
    }

    const params = new URLSearchParams()
    if (merged.page > 1) params.set('page', String(merged.page))
    if (merged.q.trim()) params.set('q', merged.q.trim())
    if (merged.section !== 'all') params.set('section', merged.section)
    if (merged.category !== 'all') params.set('category', merged.category)
    if (merged.status !== 'all') params.set('status', merged.status)
    if (merged.inactive) params.set('inactive', '1')

    router.replace(`/inventory?${params.toString()}`)
  }

  return (
    <div className="app-page">
      <div id="carga-manual" className="app-toolbar scroll-mt-20">
        <h1 className="app-page-title">Inventario</h1>
        <ProductDialog
          categories={categories}
          sections={sections}
          trigger={<Button>Agregar desde catálogo</Button>}
        />
      </div>

      {lead ? (
        <p className="app-page-lead mb-4 max-w-3xl text-muted-foreground">{lead}</p>
      ) : null}

      {!hasProducts ? (
        <p className="app-page-lead">
          No hay ítems en el inventario. Los productos vienen del{' '}
          <Link href="/catalog" className="font-medium text-primary underline-offset-4 hover:underline">
            catálogo global
          </Link>
          ; usa &quot;Agregar desde catálogo&quot; para vincular uno a este hogar y definir cantidad.
        </p>
      ) : null}

      {hasProducts ? (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="grid w-full gap-3 sm:max-w-4xl sm:grid-cols-4">
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Búsqueda</span>
              <AppSearchBox
                ariaLabel="Buscar en inventario"
                placeholder="Nombre del producto (Enter o lupa)"
                value={searchDraft}
                onChange={setSearchDraft}
                onSubmit={() => pushQuery({ page: 1, q: searchDraft.trim() })}
              />
            </div>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Sección</span>
            <Select
              value={sectionFilter}
              onValueChange={(v) => {
                setSectionFilter(v)
                pushQuery({ page: 1, section: v, category: 'all' })
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {sections.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Categoría</span>
            <Select
              value={categoryFilter}
              onValueChange={(v) => {
                setCategoryFilter(v)
                pushQuery({ page: 1, category: v })
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {categoriesForSectionFilter.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Estado de stock</span>
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v)
                pushQuery({ page: 1, status: v })
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="low">Bajo</SelectItem>
                <SelectItem value="critical">Crítico</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
          <div className="flex items-center gap-2">
            <input
              id="inventory-show-inactive"
              type="checkbox"
              checked={showInactive}
              onChange={(e) => {
                const checked = e.target.checked
                setShowInactive(checked)
                pushQuery({ page: 1, inactive: checked })
              }}
              className="h-4 w-4 rounded border border-input bg-background text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Label htmlFor="inventory-show-inactive" className="text-sm text-muted-foreground">
              Mostrar inactivos
            </Label>
          </div>
        </div>

        <GridPagingRow
          disablePrev={query.page <= 1}
          disableNext={
            query.total != null
              ? query.page * query.pageSize >= query.total
              : rows.length < query.pageSize
          }
          onPrev={() => pushQuery({ page: Math.max(1, query.page - 1) })}
          onNext={() => pushQuery({ page: query.page + 1 })}
          pageIndex={query.page - 1}
          pageSize={query.pageSize}
          metaSuffix={
            query.total != null ? ` · Total en servidor: ${query.total}` : null
          }
          trailing={
            <span className="text-[12px] text-muted-foreground">
              {query.total != null
                ? `Visibles en esta página tras filtrar: ${filtered.length}.`
                : `Filas en esta página: ${filtered.length}.`}
            </span>
          }
        />
      </div>
      ) : null}

      {hasProducts && filtered.length === 0 ? (
        <p className="app-page-lead">No hay productos que coincidan con los filtros.</p>
      ) : null}

      {hasProducts && filtered.length > 0 ? (
        <>
        <div className="app-data-table-wrap">
          <table className="app-data-table min-w-[640px]">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Catálogo</th>
                <th>Sección</th>
                <th>Categoría</th>
                <th>Stock</th>
                <th>Mín.</th>
                <th>Estado</th>
                <th>Precio ref.</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((product) => (
                <tr key={product.id}>
                  <td className="font-medium text-foreground">{product.name}</td>
                  <td className="text-muted-foreground">
                    {product.catalogProductId ? (
                      <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                        Vinculado
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="text-muted-foreground">{product.sectionLabel}</td>
                  <td className="text-muted-foreground">{product.categoryLabel}</td>
                  <td className="tabular-nums">{product.quantity}</td>
                  <td className="tabular-nums text-muted-foreground">
                    {product.stockMin ?? '—'}
                  </td>
                  <td>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(product.status)}`}
                    >
                      {statusLabel(product.status)}
                    </span>
                  </td>
                  <td className="tabular-nums">
                    {product.price != null ? `$${product.price.toFixed(2)}` : '—'}
                  </td>
                  <td className="text-right">
                    <ProductDialog
                      categories={categories}
                      sections={sections}
                      product={{
                        id: product.id,
                        name: product.name,
                        category_id: product.categoryId,
                        section_id: product.sectionId,
                        stock_current: product.quantity,
                        stock_min: product.stockMin,
                        reference_price: product.price,
                        catalog_product_id: product.catalogProductId,
                      }}
                      trigger={
                        <Button type="button" variant="outline" size="sm">
                          Editar
                        </Button>
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <GridPagingRow
          disablePrev={query.page <= 1}
          disableNext={
            query.total != null
              ? query.page * query.pageSize >= query.total
              : rows.length < query.pageSize
          }
          onPrev={() => pushQuery({ page: Math.max(1, query.page - 1) })}
          onNext={() => pushQuery({ page: query.page + 1 })}
          pageIndex={query.page - 1}
          pageSize={query.pageSize}
          metaSuffix={
            query.total != null ? ` · Total en servidor: ${query.total}` : null
          }
          trailing={
            <span className="text-[12px] text-muted-foreground">
              {query.total != null
                ? `Visibles en esta página tras filtrar: ${filtered.length}.`
                : `Filas en esta página: ${filtered.length}.`}
            </span>
          }
          />
        </>
      ) : null}
    </div>
  )
}
