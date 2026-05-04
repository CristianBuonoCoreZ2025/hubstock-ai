/** Normaliza filas del JSON de IA para tablas de chequeo (todo en español en prompt). */

export type StockCheckScanRow = {
  nameGuess: string
  brandGuess: string | null
  productType: string | null
  presentation: string | null
  netQuantity: number | null
  netUnit: string | null
  quantityGuess: number | null
  confidence: number | null
  notes: string | null
  /** Solo UI: producto del inventario elegido en el desplegable */
  uiProductPickId?: string | null
}

function strOrNull(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s.length > 0 ? s : null
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && !Number.isNaN(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isNaN(n) ? null : n
  }
  return null
}

/** Convierte un ítem del array `detected` del modelo a fila de UI. */
export function normalizeDetectedScanItem(raw: unknown): StockCheckScanRow | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  const nameGuess =
    typeof d.nameGuess === 'string'
      ? d.nameGuess
      : typeof d.name_guess === 'string'
        ? d.name_guess
        : ''
  if (!nameGuess.trim()) return null

  const netUnit = strOrNull(d.netUnit ?? d.net_unit)

  return {
    nameGuess: nameGuess.trim(),
    brandGuess: strOrNull(d.brandGuess ?? d.brand_guess),
    productType: strOrNull(d.productType ?? d.product_type),
    presentation: strOrNull(d.presentation ?? d.presentation_guess),
    netQuantity: numOrNull(d.netQuantity ?? d.net_quantity),
    netUnit,
    quantityGuess: numOrNull(d.quantityGuess ?? d.quantity_guess),
    confidence: numOrNull(d.confidence),
    notes: strOrNull(d.notes),
  }
}

export function analysisToScanRows(analysis: {
  detected?: unknown[]
}): StockCheckScanRow[] {
  const arr = Array.isArray(analysis.detected) ? analysis.detected : []
  return arr
    .map(normalizeDetectedScanItem)
    .filter((x): x is StockCheckScanRow => x != null)
}

/** Fila nueva vacía (el usuario completa antes de guardar). */
export function emptyStockCheckScanRow(): StockCheckScanRow {
  return {
    nameGuess: '',
    brandGuess: null,
    productType: null,
    presentation: null,
    netQuantity: null,
    netUnit: null,
    quantityGuess: null,
    confidence: null,
    notes: null,
    uiProductPickId: null,
  }
}

/** Payload `detected[]` en camelCase (mismo contrato que saveStockCheckFromAnalysis). */
export function scanRowsToDetectedPayload(rows: StockCheckScanRow[]): unknown[] {
  return rows.map((r) => {
    const { uiProductPickId: _ui, ...rest } = r
    return {
      nameGuess: rest.nameGuess.trim() || 'Producto',
      brandGuess: rest.brandGuess,
      productType: rest.productType,
      presentation: rest.presentation,
      netQuantity: rest.netQuantity,
      netUnit: rest.netUnit,
      quantityGuess: rest.quantityGuess,
      confidence: rest.confidence,
      notes: rest.notes,
    }
  })
}

export function scanRowsToAnalysisJson(rows: StockCheckScanRow[]): string {
  return JSON.stringify({ detected: scanRowsToDetectedPayload(rows) })
}

export function formatNetContent(
  q: number | null | undefined,
  u: string | null | undefined
): string {
  if (q == null || u == null || String(u).trim() === '') return '—'
  return `${q} ${String(u).trim()}`
}

export function formatConfidencePct(c: number | null | undefined): string {
  if (c == null || Number.isNaN(c)) return '—'
  const n = c <= 1 ? Math.round(c * 100) : Math.round(c)
  return `${n}%`
}

/** Intenta extraer cantidad y unidad desde el campo `unit` del producto (ej. "500 ml"). */
export function parseNetFromProductUnit(unit: string | null): {
  quantity: number | null
  unitCode: string | null
} {
  if (!unit?.trim()) return { quantity: null, unitCode: null }
  const t = unit.trim()
  const m = t.match(/^([\d.,]+)\s*(.*)$/)
  if (!m) return { quantity: null, unitCode: t }
  const quantity = Number(String(m[1]).replace(',', '.'))
  const u = m[2]?.trim()
  return {
    quantity: Number.isFinite(quantity) ? quantity : null,
    unitCode: u && u.length > 0 ? u : null,
  }
}
