/**
 * Logs de diagnóstico para pasada masiva paso 2 (solo terminal del servidor).
 * Activar: SCRAPPING_BULK_LOG_TIMING=1 o SCRAPPING_BULK_LOG=1
 * Filas lentas (> umbral ms): SCRAPPING_BULK_LOG_ROW=1
 */

const SLOW_ROW_MS_DEFAULT = 3000

export function scrappingBulkLogEnabled(): boolean {
  const v = process.env.SCRAPPING_BULK_LOG?.trim().toLowerCase()
  const t = process.env.SCRAPPING_BULK_LOG_TIMING?.trim()
  return v === '1' || v === 'true' || t === '1'
}

export function scrappingBulkRowLogEnabled(): boolean {
  if (!scrappingBulkLogEnabled()) return false
  const v = process.env.SCRAPPING_BULK_LOG_ROW?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

export function scrappingBulkSlowRowMs(): number {
  const raw = process.env.SCRAPPING_BULK_SLOW_ROW_MS?.trim()
  const n = raw ? Number(raw) : SLOW_ROW_MS_DEFAULT
  if (!Number.isFinite(n) || n < 500) return SLOW_ROW_MS_DEFAULT
  return Math.min(Math.floor(n), 120_000)
}

export function logScrappingBulk(event: string, fields?: Record<string, unknown>): void {
  if (!scrappingBulkLogEnabled()) return
  const line = {
    ts: new Date().toISOString(),
    scope: 'scrapping-bulk',
    event,
    ...fields,
  }
  console.info(`[scrapping-bulk] ${JSON.stringify(line)}`)
}

export function logScrappingBulkRowSlow(fields: Record<string, unknown>): void {
  if (!scrappingBulkRowLogEnabled()) return
  logScrappingBulk('row_slow', fields)
}
