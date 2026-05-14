/**
 * Misma lógica de negocio que scripts/retail_import_decision.py:
 * vincular solo con confianza; dejar ambigüedad o novedad para revisión humana.
 *
 * Pasada compuesta (nombre + precio cadena + RPC): refuerza coincidencias entre retailers
 * con variaciones mínimas de texto y precios relativamente cercanos (competencia).
 * Si parece el mismo ítem que un maestro pero no alcanza vínculo automático, se fuerza
 * «ambiguo» para evitar crear maestros duplicados sin revisión.
 */

import { normalizeSearchText } from '@/lib/search'

/** Umbrales cuando `match_score` proviene de `enrichRetailCandidatesCompositeScore`. */
export const RETAIL_COMPOSITE_THRESHOLDS = {
  linkMin: 0.52,
  ambiguousMin: 0.35,
  novelMax: 0.26,
  minGapFirstSecond: 0.07,
} as const

export type MatchCandidate = {
  catalog_product_id: string
  product_name: string
  category_id: string
  default_reference_price: number | null
  match_score: number
}

export type RetailResolveDecision =
  | { action: 'link'; catalogProductId: string; bestScore: number; reason: string }
  | { action: 'ambiguous'; catalogProductId: string | null; bestScore: number; reason: string }
  | { action: 'create_novel'; catalogProductId: null; bestScore: number; reason: string }

function norm(s: string | null | undefined): string {
  return (s ?? '')
    .trim()
    .split(/\s+/)
    .join(' ')
    .toLowerCase()
}

/** Similaridad tipo solapamiento de tokens (compatible con heurísticas del script Python). */
function textSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const na = norm(a)
  const nb = norm(b)
  if (!na.length && !nb.length) return 1
  if (!na.length || !nb.length) return 0
  const sa = new Set(na.split(/\s+/).filter(Boolean))
  const sb = new Set(nb.split(/\s+/).filter(Boolean))
  let inter = 0
  for (const x of sa) {
    if (sb.has(x)) inter++
  }
  const union = sa.size + sb.size - inter
  return union ? inter / union : 0
}

/**
 * Qué tan cercanos son precio observado en cadena vs precio referencia del maestro (0–1).
 * Sin referencia en maestro devuelve neutral 0.55 para no dominar el score.
 */
export function priceProximityScore(
  retailPrice: number,
  masterReferencePrice: number | null | undefined,
): number {
  if (!(Number.isFinite(retailPrice) && retailPrice > 0)) return 0.55
  if (
    masterReferencePrice == null ||
    !Number.isFinite(masterReferencePrice) ||
    masterReferencePrice <= 0
  ) {
    return 0.55
  }
  const rel = Math.abs(retailPrice - masterReferencePrice) / Math.max(retailPrice, masterReferencePrice)
  return Math.max(0, Math.min(1, 1 - rel / 0.55))
}

/**
 * Fusiona puntaje RPC con similitud de nombre (post-normalización) y proximidad de precio.
 * Ordena candidatos por score descendente para `decideRetailMaster`.
 */
export function enrichRetailCandidatesCompositeScore(
  candidates: MatchCandidate[],
  retailTitle: string | null,
  retailPrice: number | null,
): MatchCandidate[] {
  if (candidates.length === 0) return candidates

  const nt = normalizeSearchText(retailTitle ?? '')
  const rp = retailPrice != null && Number.isFinite(retailPrice) ? Number(retailPrice) : null

  const enriched = candidates.map((c) => {
    const rpc = Number(c.match_score ?? 0)
    const nn = normalizeSearchText(c.product_name)
    const nameSim = nt.length >= 2 && nn.length >= 2 ? textSimilarity(nt, nn) : textSimilarity(retailTitle, c.product_name)
    const priceProx = priceProximityScore(rp ?? 0, c.default_reference_price)
    const composite = Math.min(
      1,
      0.42 * rpc + 0.33 * nameSim + 0.25 * priceProx,
    )
    return { ...c, match_score: composite }
  })

  return enriched.sort((a, b) => Number(b.match_score) - Number(a.match_score))
}

/** Marca de la tienda coherente con nombre de maestro (inclusión / similitud simple). */
export function brandHintInName(brandHint: string | null | undefined, productName: string): boolean {
  if (!brandHint?.trim()) return true
  const nb = norm(brandHint)
  const nn = norm(productName)
  if (nb.length < 2) return true
  return (
    nn.includes(nb) ||
    nb.includes(nn) ||
    textSimilarity(brandHint, productName) > 0.42
  )
}

export type DecideRetailMasterParams = {
  candidates: MatchCandidate[]
  brandHint: string | null
  descriptionHint: string | null
  /** Título del ítem retail; si coincide normalizado con un maestro, se prioriza vínculo automático. */
  retailTitle?: string | null
  /** Precio capturado en la cadena (para proximidad vs referencia maestro y anti-duplicado). */
  retailPrice?: number | null
  linkMin?: number
  ambiguousMin?: number
  novelMax?: number
  minGapFirstSecond?: number
}

/** Si el mejor candidato parece el mismo producto que el maestro pero no damos link automático → revisión (anti-duplicado). */
function shouldForceAmbiguousDuplicateRisk(
  candidates: MatchCandidate[],
  retailTitle: string | null | undefined,
  retailPrice: number | null | undefined,
): boolean {
  if (candidates.length === 0) return false
  const top = candidates[0]!
  const rt = normalizeSearchText(retailTitle ?? '')
  const pn = normalizeSearchText(top.product_name)
  if (rt.length < 2 || pn.length < 2) return false

  const nameSim = textSimilarity(rt, pn)
  const priceProx = priceProximityScore(
    retailPrice != null && Number.isFinite(retailPrice) ? Number(retailPrice) : 0,
    top.default_reference_price,
  )

  if (nameSim >= 0.82) return true
  if (nameSim >= 0.68 && priceProx >= 0.5) return true
  if (nameSim >= 0.58 && priceProx >= 0.62) return true
  return false
}

/**
 * Decide si un ítem retail puede vincularse de forma automática al maestro,
 * quedar en zona ambigua o tratarse como candidato a producto nuevo (sin crear maestro aquí).
 */
export function decideRetailMaster(params: DecideRetailMasterParams): RetailResolveDecision {
  const {
    candidates,
    brandHint,
    descriptionHint,
    retailTitle,
    retailPrice,
    linkMin = 0.58,
    ambiguousMin = 0.38,
    novelMax = 0.34,
    minGapFirstSecond = 0.09,
  } = params

  if (!candidates.length) {
    return {
      action: 'create_novel',
      catalogProductId: null,
      bestScore: 0,
      reason: 'sin_candidatos_en_catalogo',
    }
  }

  if (retailTitle?.trim()) {
    const rt = normalizeSearchText(retailTitle)
    if (rt.length >= 2) {
      for (const c of candidates) {
        const pn = normalizeSearchText(c.product_name)
        if (pn === rt) {
          if (!brandHint?.trim() || brandHintInName(brandHint, c.product_name)) {
            return {
              action: 'link',
              catalogProductId: c.catalog_product_id,
              bestScore: Math.max(Number(c.match_score ?? 0), 0.995),
              reason: 'titulo_identico_normalizado_maestro',
            }
          }
          return {
            action: 'ambiguous',
            catalogProductId: c.catalog_product_id,
            bestScore: Number(c.match_score ?? 0),
            reason: 'titulo_identico_marca_incompatible',
          }
        }
      }
    }
  }

  const top = candidates[0]!
  const second = candidates.length > 1 ? candidates[1]! : null
  const bestId = top.catalog_product_id
  const bestScore = Number(top.match_score ?? 0)
  const secondScore = second ? Number(second.match_score ?? 0) : 0
  const gap = second ? bestScore - secondScore : 1

  const pname = top.product_name ?? ''

  if (brandHint?.trim() && !brandHintInName(brandHint, pname)) {
    if (bestScore >= ambiguousMin) {
      return {
        action: 'ambiguous',
        catalogProductId: bestId ?? null,
        bestScore,
        reason: 'marca_no_aparece_en_nombre_del_mejor_candidato',
      }
    }
  }

  if (descriptionHint?.trim() && pname) {
    if (textSimilarity(descriptionHint, pname) > 0.55 && bestScore < linkMin) {
      return {
        action: 'ambiguous',
        catalogProductId: bestId ?? null,
        bestScore,
        reason: 'descripcion_muy_similar_al_maestro_puntaje_insuficiente',
      }
    }
  }

  if (bestScore >= linkMin) {
    if (brandHint?.trim() && !brandHintInName(brandHint, pname)) {
      return {
        action: 'ambiguous',
        catalogProductId: bestId ?? null,
        bestScore,
        reason: 'vinculo_alto_pero_marca_incompatible',
      }
    }
    return {
      action: 'link',
      catalogProductId: bestId,
      bestScore,
      reason: 'mejor_candidato_supera_umbral_vinculo',
    }
  }

  if (bestScore >= ambiguousMin) {
    return {
      action: 'ambiguous',
      catalogProductId: bestId ?? null,
      bestScore,
      reason: 'zona_ambigua_revisar_manual',
    }
  }

  if (bestScore <= novelMax && gap >= minGapFirstSecond) {
    if (
      shouldForceAmbiguousDuplicateRisk(candidates, retailTitle ?? null, retailPrice ?? null)
    ) {
      return {
        action: 'ambiguous',
        catalogProductId: bestId ?? null,
        bestScore,
        reason: 'riesgo_duplicado_maestro_revisar_nombre_precio',
      }
    }
    return {
      action: 'create_novel',
      catalogProductId: null,
      bestScore,
      reason: 'baja_similitud_y_separacion_entre_candidatos',
    }
  }

  return {
    action: 'ambiguous',
    catalogProductId: bestId ?? null,
    bestScore,
    reason: 'candidatos_muy_pegados_o_similitud_intermedia',
  }
}
