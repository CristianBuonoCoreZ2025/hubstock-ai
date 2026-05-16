/**
 * Umbrales configurables para homologación scrapping (paso 2).
 *
 * Motor alternativo (weights S_global, GAP, penalizaciones): definir `SCRAPPING_USE_ENGINE_VNEXT=1`
 * y revisar `engine-vnext/decide-scrapping-similarity-vnext.ts`.
 */

import { RETAIL_COMPOSITE_THRESHOLDS } from '@/lib/retail-association'

function envFloat(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim()
  const n = raw ? Number(raw) : fallback
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** Bonus al score si el maestro ya tiene vínculo en esta cadena (`SCRAPPING_SIMILARITY_RETAILER_LINK_BOOST`). */
export function scrappingRetailerLinkScoreBoost(): number {
  return envFloat('SCRAPPING_SIMILARITY_RETAILER_LINK_BOOST', 0.09, 0, 0.25)
}

/** Penalización si candidato está en otra categoría maestra (`SCRAPPING_SIMILARITY_CATEGORY_MISMATCH_PENALTY`). */
export function scrappingCategoryMismatchPenalty(): number {
  return envFloat('SCRAPPING_SIMILARITY_CATEGORY_MISMATCH_PENALTY', 0.12, 0, 0.4)
}

export function scrappingSimilarityDecisionThresholds(): {
  linkMin: number
  ambiguousMin: number
  novelMax: number
  minGapFirstSecond: number
} {
  return {
    linkMin: envFloat(
      'SCRAPPING_SIMILARITY_LINK_MIN',
      RETAIL_COMPOSITE_THRESHOLDS.linkMin,
      0.35,
      0.95,
    ),
    ambiguousMin: envFloat(
      'SCRAPPING_SIMILARITY_AMBIGUOUS_MIN',
      RETAIL_COMPOSITE_THRESHOLDS.ambiguousMin,
      0.2,
      0.9,
    ),
    novelMax: envFloat(
      'SCRAPPING_SIMILARITY_NOVEL_MAX',
      RETAIL_COMPOSITE_THRESHOLDS.novelMax,
      0.1,
      0.5,
    ),
    minGapFirstSecond: envFloat(
      'SCRAPPING_SIMILARITY_MIN_GAP',
      RETAIL_COMPOSITE_THRESHOLDS.minGapFirstSecond,
      0.03,
      0.25,
    ),
  }
}

/**
 * Si está activo, un candidato que el motor base marcaría como `link` pasa primero por IA;
 * si la IA responde `same_product: false`, no se vincula y la fila queda en revisión con puntajes guardados.
 * Variable: SCRAPPING_SIMILARITY_IA_VALIDATE_AUTOLINK
 */
export function scrappingSimilarityIaValidateBeforeAutolink(): boolean {
  const v = process.env.SCRAPPING_SIMILARITY_IA_VALIDATE_AUTOLINK?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/**
 * No llamar a la IA si el mejor puntaje base está por debajo de este umbral (el caso ya va a producto nuevo).
 * Por defecto = ambiguousMin del proyecto (misma fuente que SCRAPPING_SIMILARITY_AMBIGUOUS_MIN).
 */
export function scrappingSimilarityIaInvokeMinBaseScore(ambiguousMinFallback: number): number {
  return envFloat(
    'SCRAPPING_SIMILARITY_IA_MIN_BASE_SCORE_TO_CALL',
    ambiguousMinFallback,
    0.05,
    0.95,
  )
}
