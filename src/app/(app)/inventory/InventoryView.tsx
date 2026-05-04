'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ProductDialog } from './ProductDialog'

export type InventoryRow = {
  id: string
  name: string
  categoryId: string
  sectionId: string
  categoryLabel: string
  sectionLabel: string
  quantity: number
  stockMin: number | null
  price: number | null
  status: 'normal' | 'low' | 'critical'
}

type Category = { id: string; name: string }
type Section = { id: string; name: string }

type Props = {
  categories: Category[]
  sections: Section[]
  rows: InventoryRow[]
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

export function InventoryView({ categories, sections, rows }: Props) {
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [sectionFilter, setSectionFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const hasProducts = rows.length > 0

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (categoryFilter !== 'all' && r.categoryId !== categoryFilter) return false
      if (sectionFilter !== 'all' && r.sectionId !== sectionFilter) return false
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      return true
    })
  }, [rows, categoryFilter, sectionFilter, statusFilter])

  return (
    <div className="app-page">
      <div className="app-toolbar">
        <h1 className="app-page-title">Inventario</h1>
        <ProductDialog
          categories={categories}
          sections={sections}
          trigger={<Button>Nuevo producto</Button>}
        />
      </div>

      {!hasProducts ? (
        <p className="app-page-lead">
          No hay productos activos en este perfil. Crea el primero con &quot;Nuevo producto&quot;.
        </p>
      ) : null}

      {hasProducts ? (
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="grid w-full gap-3 sm:max-w-3xl sm:grid-cols-3">
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Sección</span>
            <Select value={sectionFilter} onValueChange={setSectionFilter}>
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
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Estado de stock</span>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
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
      </div>
      ) : null}

      {hasProducts && filtered.length === 0 ? (
        <p className="app-page-lead">No hay productos que coincidan con los filtros.</p>
      ) : null}

      {hasProducts && filtered.length > 0 ? (
        <div className="app-data-table-wrap">
          <table className="app-data-table min-w-[640px]">
            <thead>
              <tr>
                <th>Nombre</th>
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
      ) : null}
    </div>
  )
}

function computeStatus(
  qty: number,
  stockMin: number | null
): InventoryRow['status'] {
  if (qty <= 0) return 'critical'
  if (stockMin != null && stockMin > 0 && qty <= stockMin) return 'low'
  return 'normal'
}

export function buildInventoryRows(
  products: {
    id: string
    name: string
    category_id: string
    section_id: string
    stock_current: number
    stock_min: number | null
    reference_price: number | null
  }[],
  categoryById: Map<string, string>,
  sectionById: Map<string, string>
): InventoryRow[] {
  return products.map((p) => ({
    id: p.id,
    name: p.name,
    categoryId: p.category_id,
    sectionId: p.section_id,
    categoryLabel: categoryById.get(p.category_id) ?? '—',
    sectionLabel: sectionById.get(p.section_id) ?? '—',
    quantity: Number(p.stock_current),
    stockMin: p.stock_min != null ? Number(p.stock_min) : null,
    price: p.reference_price != null ? Number(p.reference_price) : null,
    status: computeStatus(Number(p.stock_current), p.stock_min != null ? Number(p.stock_min) : null),
  }))
}
