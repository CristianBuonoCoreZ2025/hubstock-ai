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

function computeStatus(qty: number, stockMin: number | null): InventoryRow['status'] {
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
  return products.map((p) => {
    const qty = Number(p.stock_current)
    const min = p.stock_min != null ? Number(p.stock_min) : null
    return {
      id: p.id,
      name: p.name,
      categoryId: p.category_id,
      sectionId: p.section_id,
      categoryLabel: categoryById.get(p.category_id) ?? '—',
      sectionLabel: sectionById.get(p.section_id) ?? '—',
      quantity: qty,
      stockMin: min,
      price: p.reference_price != null ? Number(p.reference_price) : null,
      status: computeStatus(qty, min),
    }
  })
}

