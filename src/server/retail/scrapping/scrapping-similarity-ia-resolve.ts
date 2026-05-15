/**
 * Etapa C/D: segunda pasada con OpenRouter solo cuando la heurística deja la fila ambigua.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { MatchCandidate } from '@/lib/retail-association'
import {
  isRetailIaHomologationConfigured,
  resolveRetailCatalogMatchWithOpenRouter,
  retailIaHomologationEnabled,
  retailIaHomologationMaxCallsPerRun,
} from '@/server/retail-openrouter-match'
import { confirmManualScrappingSimilarityLink } from '@/server/retail/scrapping/scrapping-similarity-manual'
import type { SimilarityRowResolveOutcome } from '@/server/retail/scrapping/scrapping-similarity-fast-path'
import { logScrappingBulk } from '@/server/retail/scrapping/scrapping-similarity-bulk-log'

export type ScrappingIaBudget = { remaining: number }

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
  },
  iaBudget: ScrappingIaBudget | null,
): Promise<SimilarityRowResolveOutcome | null> {
  if (!iaBudget || iaBudget.remaining <= 0 || input.matchCandidates.length === 0) return null

  const payload = candidatesPayloadForOpenRouter(input.matchCandidates)
  if (payload.length === 0) return null

  iaBudget.remaining -= 1
  const tIa = Date.now()
  logScrappingBulk('ia_call_start', {
    scrappingId: input.scrappingId,
    candidates: payload.length,
    iaRemainingAfter: iaBudget.remaining,
  })
  const ai = await resolveRetailCatalogMatchWithOpenRouter({
    retailTitle: input.productName,
    retailPrice: input.price,
    brandHint: input.brand,
    descriptionHint: input.descriptionHint,
    candidates: payload,
  })
  const iaMs = Date.now() - tIa
  if (!ai || !input.allowedCatalogIds.has(ai.catalogProductId)) {
    logScrappingBulk('ia_call_skip', {
      scrappingId: input.scrappingId,
      ms: iaMs,
      reason: !ai ? 'no_match' : 'not_in_allowed',
    })
    return null
  }

  const link = await confirmManualScrappingSimilarityLink(admin, input.scrappingId, ai.catalogProductId, {
    skipCandidateRevalidation: true,
  })
  logScrappingBulk('ia_call_end', {
    scrappingId: input.scrappingId,
    ms: iaMs,
    catalogProductId: ai.catalogProductId,
    linked: link.ok,
  })
  return link.ok ? { outcome: 'auto_linked_ia' } : { outcome: 'error' }
}
