/**
 * Etapa C/D: OpenRouter cuando el motor base deja la fila ambigua o antes de autovincular (opcional).
 * La IA puede marcar same_product=false para frenar falsos positivos (misma marca, distinto artículo).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { MatchCandidate } from '@/lib/retail-association'
import {
  isRetailIaHomologationConfigured,
  resolveRetailCatalogHomologIaHintOpenRouter,
  retailIaHomologationEnabled,
  retailIaHomologationMaxCallsPerRun,
} from '@/server/retail-openrouter-match'
import { persistScrappingSimilarityIaHint } from '@/server/retail/scrapping/scrapping-similarity-manual'
import type { SimilarityRowResolveOutcome } from '@/server/retail/scrapping/scrapping-similarity-fast-path'
import { logScrappingBulk } from '@/server/retail/scrapping/scrapping-similarity-bulk-log'

export type ScrappingIaBudget = { remaining: number }

export type ScrappingSimilarityBaseRanking = {
  topCatalogProductId: string | null
  topScore: number
  secondScore: number | null
  gap: number
}

export type ScrappingSimilarityIaPurpose = 'ambiguous_hint' | 'validate_autolink'

export function createScrappingIaBudget(): ScrappingIaBudget | null {
  if (!retailIaHomologationEnabled() || !isRetailIaHomologationConfigured()) return null
  return { remaining: retailIaHomologationMaxCallsPerRun() }
}

function candidatesPayloadForOpenRouter(candidates: MatchCandidate[]): Array<{
  id: string
  nombre: string
  precio_referencia: number | null
}> {
  return candidates.slice(0, 12).map((c) => ({
    id: c.catalog_product_id,
    nombre: c.product_name.slice(0, 220),
    precio_referencia: c.default_reference_price,
  }))
}

export async function tryResolveScrappingSimilarityWithIa(
  admin: SupabaseClient,
  input: {
    scrappingId: string
    productName: string
    brand: string | null
    price: number | null
    descriptionHint: string | null
    matchCandidates: MatchCandidate[]
    allowedCatalogIds: Set<string>
    purpose: ScrappingSimilarityIaPurpose
    proposedCatalogProductId?: string | null
    baseRanking: ScrappingSimilarityBaseRanking
    minBaseScoreToInvokeIa: number
  },
  iaBudget: ScrappingIaBudget | null,
): Promise<SimilarityRowResolveOutcome | null> {
  if (!iaBudget || iaBudget.remaining <= 0 || input.matchCandidates.length === 0) return null

  if (input.baseRanking.topScore < input.minBaseScoreToInvokeIa) {
    logScrappingBulk('ia_call_skip', {
      scrappingId: input.scrappingId,
      reason: 'base_score_below_ia_floor',
      topScore: input.baseRanking.topScore,
      floor: input.minBaseScoreToInvokeIa,
    })
    return null
  }

  const payload = candidatesPayloadForOpenRouter(input.matchCandidates)
  if (payload.length === 0) return null

  iaBudget.remaining -= 1
  const tIa = Date.now()
  logScrappingBulk('ia_call_start', {
    scrappingId: input.scrappingId,
    candidates: payload.length,
    iaRemainingAfter: iaBudget.remaining,
    mode: input.purpose,
  })

  const mode = input.purpose === 'validate_autolink' ? 'autolink_validation' : 'ambiguous_review'

  const ai = await resolveRetailCatalogHomologIaHintOpenRouter({
    retailTitle: input.productName,
    retailPrice: input.price,
    brandHint: input.brand,
    descriptionHint: input.descriptionHint,
    candidates: payload,
    mode,
    baseTopScore: input.baseRanking.topScore,
    baseGap: input.baseRanking.gap,
    proposedCatalogProductId:
      input.purpose === 'validate_autolink' ? input.proposedCatalogProductId?.trim() ?? null : null,
  })
  const iaMs = Date.now() - tIa

  const iaContextStored =
    input.purpose === 'validate_autolink' ? 'autolink_validation' : 'ambiguous_review'

  const basePersist = {
    base_best_catalog_product_id: input.baseRanking.topCatalogProductId,
    base_best_score: input.baseRanking.topScore,
    base_second_score: input.baseRanking.secondScore,
    base_gap: input.baseRanking.gap,
    ia_context: iaContextStored,
  }

  if (input.purpose === 'validate_autolink') {
    if (!ai) {
      logScrappingBulk('ia_call_skip', {
        scrappingId: input.scrappingId,
        ms: iaMs,
        reason: 'validate_no_response_allow_link',
      })
      return null
    }

    const approved = ai.sameProduct === true
    if (approved) {
      logScrappingBulk('ia_autolink_approved', {
        scrappingId: input.scrappingId,
        ms: iaMs,
        aiScore: ai.aiScore,
      })
      return null
    }

    const safeSuggested =
      ai.candidateSuggested && input.allowedCatalogIds.has(ai.candidateSuggested) ?
        ai.candidateSuggested
      : null

    const persist = await persistScrappingSimilarityIaHint(admin, input.scrappingId, {
      ...basePersist,
      ai_hint: ai.aiHint,
      candidate_suggested: safeSuggested,
      ai_score: ai.aiScore,
      reason: ai.reason,
      same_product: ai.sameProduct,
      ia_rejected_pair: true,
    })

    logScrappingBulk('ia_autolink_blocked', {
      scrappingId: input.scrappingId,
      ms: iaMs,
      sameProduct: ai.sameProduct,
      persistOk: persist.ok,
    })

    return {
      outcome: 'needs_review',
      iaHintApplied: persist.ok,
      iaBlockedAutolink: true,
      iaHint: ai.aiHint,
      candidateSuggested: safeSuggested,
      aiScore: ai.aiScore,
      aiReason: ai.reason || null,
      sameProduct: ai.sameProduct,
    }
  }

  /** ambiguous_hint */
  if (!ai || (!ai.aiHint.trim() && ai.candidateSuggested == null && !ai.reason.trim() && ai.sameProduct == null)) {
    logScrappingBulk('ia_call_skip', {
      scrappingId: input.scrappingId,
      ms: iaMs,
      reason: 'no_hint_payload',
    })
    return null
  }

  const safeSuggested =
    ai.candidateSuggested && input.allowedCatalogIds.has(ai.candidateSuggested) ?
      ai.candidateSuggested
    : null

  const iaRejected = ai.sameProduct === false

  const persist = await persistScrappingSimilarityIaHint(admin, input.scrappingId, {
    ...basePersist,
    ai_hint: ai.aiHint,
    candidate_suggested: safeSuggested,
    ai_score: ai.aiScore,
    reason: ai.reason,
    same_product: ai.sameProduct,
    ia_rejected_pair: iaRejected,
  })

  logScrappingBulk('ia_hint_stored', {
    scrappingId: input.scrappingId,
    ms: iaMs,
    catalogProductId: safeSuggested,
    persistOk: persist.ok,
    sameProduct: ai.sameProduct,
  })

  return {
    outcome: 'needs_review',
    iaHintApplied: persist.ok,
    iaHint: ai.aiHint,
    candidateSuggested: safeSuggested,
    aiScore: ai.aiScore,
    aiReason: ai.reason || null,
    sameProduct: ai.sameProduct,
    iaBlockedAutolink: false,
  }
}
