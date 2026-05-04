import type { VisionAnalysisMeta } from '@/types/vision-meta'

/** Contenido guardado en `stock_checks.ai_meta` (JSON). */
export type StockCheckAiMeta = {
  vision: VisionAnalysisMeta
  /** Media de `confidence` por ítem (0–1), si el modelo lo devolvió. */
  confidenceAvg: number | null
  /** Mínimo entre ítems con confidence. */
  confidenceMin: number | null
  detectedCount: number
  /** Qué fracción de ítems traía `confidence` en la respuesta. */
  confidenceCoverage: number | null
}

function isVisionMeta(x: unknown): x is VisionAnalysisMeta {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    (o.provider === 'gemini' ||
      o.provider === 'openrouter' ||
      o.provider === 'openrouter_free' ||
      o.provider === 'ollama') &&
    typeof o.model === 'string' &&
    typeof o.providerLabel === 'string'
  )
}

/** Lee `ai_meta` de Supabase de forma segura. */
export function parseStockCheckAiMeta(raw: unknown): StockCheckAiMeta | null {
  if (raw == null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (!isVisionMeta(o.vision)) return null
  const vision = o.vision
  const detectedCount =
    typeof o.detectedCount === 'number' && !Number.isNaN(o.detectedCount)
      ? o.detectedCount
      : 0
  const numOrNull = (v: unknown) =>
    typeof v === 'number' && !Number.isNaN(v) ? v : null
  return {
    vision,
    confidenceAvg: numOrNull(o.confidenceAvg),
    confidenceMin: numOrNull(o.confidenceMin),
    detectedCount,
    confidenceCoverage: numOrNull(o.confidenceCoverage),
  }
}
