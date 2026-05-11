import { normalizeSearchText } from '@/lib/search'

export const RETAIL_LIDER_REVIEW_TRAYS = [
  'duplicate_risk',
  'new_master_candidate',
  'format_conflict',
  'category_uncertain',
  'low_confidence',
  'discarded_candidate',
] as const

export type RetailLiderReviewTray = (typeof RETAIL_LIDER_REVIEW_TRAYS)[number]

export function isRetailLiderReviewTray(s: string | null | undefined): s is RetailLiderReviewTray {
  return s != null && (RETAIL_LIDER_REVIEW_TRAYS as readonly string[]).includes(s)
}

/**
 * Clasifica el motivo de revisión en una bandeja para agrupación en UI.
 * `duplicate_risk` como estado de fila ya se maneja aparte en el motor.
 */
export function inferRetailLiderReviewTrayFromReason(reason: string): RetailLiderReviewTray {
  const r = normalizeSearchText(reason)

  if (r.includes('sin candidat') && r.includes('catalogo')) return 'new_master_candidate'
  if (r.includes('ningun candidat') && r.includes('formato')) return 'format_conflict'
  if (r.includes('formato distint') || r.includes('formato compatible')) return 'format_conflict'
  if (r.includes('categor')) return 'category_uncertain'
  if (r.includes('posible duplicad') || r.includes('maestro similar')) return 'duplicate_risk'
  if (r.includes('descart')) return 'discarded_candidate'
  if (
    r.includes('confianza') ||
    r.includes('umbral') ||
    r.includes('insuficiente') ||
    r.includes('ambiguo') ||
    r.includes('json valido') ||
    r.includes('revision manual')
  ) {
    return 'low_confidence'
  }

  return 'low_confidence'
}

export function buildRetailReviewGroupKey(input: {
  tray: RetailLiderReviewTray
  suggestedMasterId: string | null
  reasonSnippet: string
}): string {
  const snippet = normalizeSearchText(input.reasonSnippet).replace(/\s+/g, ' ').slice(0, 48)
  const sid = input.suggestedMasterId ?? 'none'
  return `${input.tray}::${sid}::${snippet}`
}

export function retailLiderTrayLabel(tray: RetailLiderReviewTray): string {
  const labels: Record<RetailLiderReviewTray, string> = {
    duplicate_risk: 'Riesgo duplicado',
    new_master_candidate: 'Nuevos candidatos a maestro',
    format_conflict: 'Formato conflictivo',
    category_uncertain: 'Categoría dudosa',
    low_confidence: 'Baja confianza',
    discarded_candidate: 'Descartables',
  }
  return labels[tray]
}

export function retailLiderTrayMotivation(tray: RetailLiderReviewTray): string {
  const m: Record<RetailLiderReviewTray, string> = {
    duplicate_risk: 'Varios maestros compiten con puntaje similar o la IA detectó posible duplicado.',
    new_master_candidate: 'No hay candidatos claros en catálogo; podría crearse un maestro nuevo.',
    format_conflict: 'El formato declarado no encaja con los candidatos o con la elección de la IA.',
    category_uncertain: 'La categoría o el rubro no es claro para asociar con confianza.',
    low_confidence: 'Puntaje o confianza por debajo del umbral seguro para enlace automático.',
    discarded_candidate: 'Ítems marcados como no útiles para el catálogo.',
  }
  return m[tray]
}

export function retailLiderSuggestedBulkAction(tray: RetailLiderReviewTray): string {
  const a: Record<RetailLiderReviewTray, string> = {
    duplicate_risk: 'Elegir un maestro ganador o marcar como duplicado según política.',
    new_master_candidate: 'Crear maestros en lote solo si no hay riesgo de duplicado.',
    format_conflict: 'Ajustar formato en maestro o descartar el grupo.',
    category_uncertain: 'Asignar categoría común al grupo tras validar muestra.',
    low_confidence: 'Aprobar vínculo sugerido para todo el grupo si la muestra es coherente.',
    discarded_candidate: 'Descartar grupo o archivar sin vínculo.',
  }
  return a[tray]
}
