/**
 * Motor vnext (plan homologación) para paso 2 scrapping · Captura cadenas 2.
 * Opcional: SCRAPPING_USE_ENGINE_VNEXT=1
 */

import {
  brandHintInName,
  type DecideRetailMasterParams,
  type MatchCandidate,
  type RetailResolveDecision,
  shouldForceAmbiguousDuplicateRisk,
} from '@/lib/retail-association'
import { normalizeSearchText } from '@/lib/search'
import { calculatePriceScore } from '@/server/retail/homologation/engine-vnext/calculate-price-score'
import {
  detectPenaltySignals,
  type PenaltySignals,
  penaltySumTable,
} from '@/server/retail/homologation/engine-vnext/detect-penalty-signals'
import { normalizedTokenOverlapScore } from '@/server/retail/homologation/engine-vnext/text-similarity'

const W_NAME = 0.38
const W_FORMAT = 0.22
const W_PRICE = 0.18
const W_CATEGORY = 0.12
const W_BRAND = 0.1

const AUTO_GAP_MIN = 0.08

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/** placeholder hasta extracción de formato explícito */
function baselineFormatScore(): number {
  return 0.82
}

type ScoredCand = MatchCandidate & {
  S_name: number
  S_format: number
  S_price: number
  S_category: number
  S_brand: number
  S_global: number
  penaltyFlags: PenaltySignals
}

function scoreCandidate(
  c: MatchCandidate,
  retailTitle: string | null,
  retailPrice: number | null,
  brandHint: string | null,
  scrapedCategoryId: string | null,
): ScoredCand {
  const pname = normalizeSearchText(c.product_name)
  const rt = normalizeSearchText(retailTitle ?? '')
  const compositeIn = clamp01(Number(c.match_score ?? 0))
  const overlap = normalizedTokenOverlapScore(retailTitle, c.product_name)
  const S_name = clamp01(0.55 * overlap + 0.45 * compositeIn)

  const S_price = calculatePriceScore(retailPrice, c.default_reference_price)
  const S_format = baselineFormatScore()
  const S_category =
    scrapedCategoryId && c.category_id && scrapedCategoryId === c.category_id ? 1 : 0.72

  let S_brand = 1
  if (brandHint?.trim() && !brandHintInName(brandHint, c.product_name)) {
    S_brand = 0.42
  }

  const penaltyFlags = detectPenaltySignals({
    retailTitleNorm: rt,
    masterTitleNorm: pname,
    categoryMismatch:
      Boolean(scrapedCategoryId) && Boolean(c.category_id) && scrapedCategoryId !== c.category_id,
    weakBrandAlias: S_brand < 0.5,
  })
  const penalties = penaltySumTable(penaltyFlags)
  const mixed = W_NAME * S_name + W_FORMAT * S_format + W_PRICE * S_price + W_CATEGORY * S_category + W_BRAND * S_brand
  const S_global = clamp01(mixed - penalties)

  return {
    ...c,
    match_score: S_global,
    S_name,
    S_format,
    S_price,
    S_category,
    S_brand,
    S_global,
    penaltyFlags,
  }
}

function autoLinkHardBlock(flags: PenaltySignals): boolean {
  return Boolean(
    flags.packVsUnit ||
      flags.zeroVsNormal ||
      flags.sinAzucarVsNormal ||
      flags.tipoBaseDistinto ||
      flags.saborDistinto,
  )
}

export function scrappingSimilarityUseEngineVnext(): boolean {
  const v = process.env.SCRAPPING_USE_ENGINE_VNEXT?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

export function decideScrappingSimilarityEngineVnext(
  params: DecideRetailMasterParams & {
    scrapedCategoryId?: string | null
    retailerLinkBoost?: number
  },
): RetailResolveDecision {
  const {
    candidates: rawCandidates,
    brandHint,
    descriptionHint,
    retailTitle,
    retailPrice,
    ambiguousMin,
    novelMax,
    minGapFirstSecond,
    scrapedCategoryId = null,
    retailerLinkBoost = 0,
  } = params

  if (!rawCandidates.length) {
    return {
      action: 'create_novel',
      catalogProductId: null,
      bestScore: 0,
      reason: 'sin_candidatos_en_catalogo',
    }
  }

  let scored = rawCandidates.map((c) =>
    scoreCandidate({ ...c }, retailTitle ?? null, retailPrice ?? null, brandHint, scrapedCategoryId),
  )

  if (retailerLinkBoost && retailerLinkBoost > 0) {
    scored = scored
      .map((c) => {
        const bump =
          c.S_name >= 0.45 && normalizedTokenOverlapScore(retailTitle, c.product_name) >= 0.35 ?
            Math.min(retailerLinkBoost, 0.12)
          : 0
        const S_global = clamp01(c.S_global + bump)
        return { ...c, S_global, match_score: S_global }
      })
      .sort((a, b) => b.S_global - a.S_global)
  } else {
    scored.sort((a, b) => b.S_global - a.S_global)
  }

  const top = scored[0]!
  const second = scored.length > 1 ? scored[1]! : null

  if (retailTitle?.trim()) {
    const rt = normalizeSearchText(retailTitle)
    if (rt.length >= 2) {
      for (const c of scored) {
        const pn = normalizeSearchText(c.product_name)
        if (pn === rt) {
          if (!brandHint?.trim() || brandHintInName(brandHint, c.product_name)) {
            return {
              action: 'link',
              catalogProductId: c.catalog_product_id,
              bestScore: Math.max(c.S_global, 0.995),
              reason: 'titulo_identico_normalizado_maestro_vnext',
            }
          }
          return {
            action: 'ambiguous',
            catalogProductId: c.catalog_product_id,
            bestScore: c.S_global,
            reason: 'titulo_identico_marca_incompatible_vnext',
          }
        }
      }
    }
  }

  const bestScore = top.S_global
  const secondScore = second?.S_global ?? 0
  const gap = second ? bestScore - secondScore : 1

  const minGapEff = Math.max(Number(minGapFirstSecond ?? 0.09), AUTO_GAP_MIN)

  const safeAuto =
    bestScore >= 0.94 &&
    top.S_name >= 0.55 &&
    top.S_format >= 0.75 &&
    top.S_price >= 0.45 &&
    gap >= minGapEff &&
    !autoLinkHardBlock(top.penaltyFlags)

  const pname = top.product_name ?? ''

  if (brandHint?.trim() && !brandHintInName(brandHint, pname)) {
    if (bestScore >= ambiguousMin!) {
      return {
        action: 'ambiguous',
        catalogProductId: top.catalog_product_id,
        bestScore,
        reason: 'marca_no_aparece_en_nombre_del_mejor_candidato_vnext',
      }
    }
  }

  if (descriptionHint?.trim() && pname) {
    const sim = normalizedTokenOverlapScore(descriptionHint, pname)
    if (sim > 0.55 && bestScore < 0.75) {
      return {
        action: 'ambiguous',
        catalogProductId: top.catalog_product_id,
        bestScore,
        reason: 'descripcion_muy_similar_al_maestro_puntaje_insuficiente_vnext',
      }
    }
  }

  if (safeAuto) {
    return {
      action: 'link',
      catalogProductId: top.catalog_product_id,
      bestScore,
      reason: 'motor_vnext_GAP_y_seguridad_OK',
    }
  }

  if (bestScore >= ambiguousMin!) {
    return {
      action: 'ambiguous',
      catalogProductId: top.catalog_product_id,
      bestScore,
      reason: 'zona_ambigua_revisar_manual_vnext',
    }
  }

  if (bestScore <= novelMax! && gap >= Number(minGapFirstSecond)) {
    const originalsSorted = [...rawCandidates].sort(
      (a, b) => Number(b.match_score) - Number(a.match_score),
    )
    if (shouldForceAmbiguousDuplicateRisk(originalsSorted, retailTitle ?? null, retailPrice ?? null)) {
      return {
        action: 'ambiguous',
        catalogProductId: top.catalog_product_id,
        bestScore,
        reason: 'riesgo_duplicado_maestro_revisar_nombre_precio_vnext',
      }
    }
    return {
      action: 'create_novel',
      catalogProductId: null,
      bestScore,
      reason: 'baja_similitud_y_separacion_entre_candidatos_vnext',
    }
  }

  return {
    action: 'ambiguous',
    catalogProductId: top.catalog_product_id,
    bestScore,
    reason: 'candidatos_muy_pegados_o_similitud_intermedia_vnext',
  }
}
