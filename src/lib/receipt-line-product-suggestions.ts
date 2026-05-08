import type { ProductPickerRow } from '@/app/actions/receipts'
import {
  matchesSearch,
  normalizeSearchText,
  searchTermsFromQuery,
} from '@/lib/search'

export type ReceiptLineForMatch = {
  name_raw: string
  unit_price: number | null
}

/**
 * Ordena productos del inventario del perfil por similitud con una línea de boleta:
 * palabras en común en nombre/marca/formato/unidad, coincidencia de subcadena y cercanía de last_price.
 */
export function suggestInventoryProductsForReceiptLine(
  line: ReceiptLineForMatch,
  products: ProductPickerRow[],
  limit = 4,
): ProductPickerRow[] {
  if (!products.length || !line.name_raw.trim()) return []

  const scored = products.map((p) => ({
    product: p,
    score: scoreReceiptLineToProduct(line, p),
  }))

  scored.sort((a, b) => b.score - a.score)
  const top = scored.filter((x) => x.score >= 8).slice(0, limit)

  if (top.length > 0) {
    return top.map((x) => x.product)
  }

  // Sin coincidencias claras: devuelve las mejores aunque sean débiles (evita lista vacía).
  return scored.slice(0, Math.min(2, limit)).map((x) => x.product)
}

function scoreReceiptLineToProduct(
  line: ReceiptLineForMatch,
  product: ProductPickerRow,
): number {
  const hayParts = [product.name, product.brand, product.format, product.unit].filter(
    (x): x is string => typeof x === 'string' && x.trim().length > 0,
  )
  const haystack = hayParts.join(' ')
  const terms = searchTermsFromQuery(line.name_raw)

  let score = 0

  if (terms.length > 0) {
    const nh = normalizeSearchText(haystack)
    let hits = 0
    for (const t of terms) {
      if (t.length >= 2 && nh.includes(t)) hits++
    }
    score += (hits / terms.length) * 55
  } else if (matchesSearch(haystack, line.name_raw)) {
    score += 40
  }

  const pn = normalizeSearchText(product.name)
  const ln = normalizeSearchText(line.name_raw)
  if (pn.length >= 3 && ln.length >= 4) {
    if (ln.includes(pn) || pn.includes(ln)) {
      score += 28
    }
  }

  const nameBrand = [product.name, product.brand].filter(
    (x): x is string => typeof x === 'string' && x.trim().length > 0,
  )
  if (matchesSearch(nameBrand, line.name_raw)) {
    score += 12
  }

  const lp = line.unit_price
  const pp = product.last_price
  if (
    typeof lp === 'number' &&
    !Number.isNaN(lp) &&
    lp > 0 &&
    typeof pp === 'number' &&
    !Number.isNaN(pp) &&
    pp > 0
  ) {
    const rel = Math.abs(lp - pp) / Math.max(lp, pp)
    if (rel <= 0.08) score += 18
    else if (rel <= 0.2) score += 12
    else if (rel <= 0.35) score += 6
  }

  return Math.round(score * 10) / 10
}
