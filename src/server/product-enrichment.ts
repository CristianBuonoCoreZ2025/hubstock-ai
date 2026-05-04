import {
  extractGtinFromText,
  fetchOpenFoodFactsProduct,
  normalizeGtin,
} from '@/server/openfoodfacts'
import type { OpenFoodFactsProduct } from '@/server/openfoodfacts'

export type ReceiptLineEnrichment = {
  source: 'open_food_facts'
  matched: boolean
  openFoodFactsCode: string
  name: string | null
  brand: string | null
  quantityLabel: string | null
  categoriesTags: string[]
}

export type ReceiptLineWithEnrichment = {
  nameRaw: string
  quantity: number | null
  unitPrice: number | null
  lineTotal: number | null
  gtin: string | null
  enrichment: ReceiptLineEnrichment | null
}

export type ProductImageAnalysis = {
  name: string
  brand: string | null
  format: string | null
  unit: string | null
  categoryGuess: string | null
  notes: string | null
  gtin: string | null
}

export type ProductImageEnrichment = {
  source: 'open_food_facts'
  matched: boolean
  openFoodFactsCode: string
  name: string | null
  brand: string | null
  quantityLabel: string | null
  categoriesTags: string[]
}

function toReceiptEnrichment(
  off: OpenFoodFactsProduct
): ReceiptLineEnrichment {
  return {
    source: 'open_food_facts',
    matched: true,
    openFoodFactsCode: off.code,
    name: off.name,
    brand: off.brand,
    quantityLabel: off.quantityLabel,
    categoriesTags: off.categoriesTags,
  }
}

function toProductEnrichment(off: OpenFoodFactsProduct): ProductImageEnrichment {
  return {
    source: 'open_food_facts',
    matched: true,
    openFoodFactsCode: off.code,
    name: off.name,
    brand: off.brand,
    quantityLabel: off.quantityLabel,
    categoriesTags: off.categoriesTags,
  }
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v
  return null
}

/** Une campos del modelo con datos canónicos de OFF cuando existan. */
export function mergeProductImageWithOff(
  parsed: unknown,
  off: OpenFoodFactsProduct | null
): ProductImageAnalysis & { enrichment: ProductImageEnrichment | null } {
  const o = parsed as Record<string, unknown>
  const gtinFromModel = normalizeGtin(strOrNull(o.gtin))
  const base: ProductImageAnalysis = {
    name: typeof o.name === 'string' ? o.name : 'Desconocido',
    brand: strOrNull(o.brand),
    format: strOrNull(o.format),
    unit: strOrNull(o.unit),
    categoryGuess: strOrNull(o.categoryGuess),
    notes: strOrNull(o.notes),
    gtin: gtinFromModel,
  }

  if (!off) {
    return { ...base, enrichment: null }
  }

  return {
    name: off.name ?? base.name,
    brand: off.brand ?? base.brand,
    format: off.quantityLabel ?? base.format,
    unit: base.unit,
    categoryGuess: base.categoryGuess,
    notes: base.notes,
    gtin: off.code,
    enrichment: toProductEnrichment(off),
  }
}

export async function enrichProductImageAnalysis(
  parsed: unknown
): Promise<
  ProductImageAnalysis & { enrichment: ProductImageEnrichment | null }
> {
  const o = parsed as Record<string, unknown>
  const fromField = normalizeGtin(strOrNull(o.gtin))
  const fromNotes = extractGtinFromText(strOrNull(o.notes) ?? '')
  const gtinRaw = fromField ?? fromNotes
  if (!gtinRaw) {
    return mergeProductImageWithOff(parsed, null)
  }
  const off = await fetchOpenFoodFactsProduct(gtinRaw)
  return mergeProductImageWithOff(parsed, off)
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number.parseFloat(v.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

export async function enrichReceiptItems(
  items: Array<{
    nameRaw: string
    quantity: number | null
    unitPrice: number | null
    lineTotal: number | null
    gtin?: string | null
  }>
): Promise<ReceiptLineWithEnrichment[]> {
  const codes = new Set<string>()
  const lineGtins: (string | null)[] = items.map((it) => {
    const fromField = normalizeGtin(it.gtin ?? null)
    const g = fromField ?? extractGtinFromText(it.nameRaw)
    if (g) codes.add(g)
    return g
  })

  const offMap = new Map<string, OpenFoodFactsProduct | null>()
  await Promise.all(
    [...codes].map(async (c) => {
      const p = await fetchOpenFoodFactsProduct(c)
      offMap.set(c, p)
    })
  )

  return items.map((it, i) => {
    const gtin = lineGtins[i]
    const off = gtin ? offMap.get(gtin) ?? null : null
    return {
      nameRaw: it.nameRaw,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      lineTotal: it.lineTotal,
      gtin,
      enrichment: off ? toReceiptEnrichment(off) : null,
    }
  })
}

export type ReceiptAnalysisEnriched = {
  storeName: string | null
  purchasedAt: string | null
  currency: string
  total: number | null
  items: ReceiptLineWithEnrichment[]
}

/** Normaliza salida de Gemini y enriquece líneas con Open Food Facts cuando hay GTIN. */
export async function enrichReceiptAnalysisPayload(
  parsed: unknown
): Promise<ReceiptAnalysisEnriched> {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('invalid_receipt_analysis')
  }
  const o = parsed as Record<string, unknown>
  const itemsRaw = o.items
  if (!Array.isArray(itemsRaw)) {
    throw new Error('invalid_receipt_analysis')
  }
  const items = itemsRaw.map((row) => {
    const r = row as Record<string, unknown>
    return {
      nameRaw: typeof r.nameRaw === 'string' ? r.nameRaw : String(r.nameRaw ?? ''),
      quantity: numOrNull(r.quantity),
      unitPrice: numOrNull(r.unitPrice),
      lineTotal: numOrNull(r.lineTotal),
      gtin: strOrNull(r.gtin),
    }
  })
  const enriched = await enrichReceiptItems(items)
  return {
    storeName: strOrNull(o.storeName),
    purchasedAt: strOrNull(o.purchasedAt),
    currency: typeof o.currency === 'string' && o.currency ? o.currency : 'CLP',
    total: numOrNull(o.total),
    items: enriched,
  }
}
