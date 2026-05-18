/**
 * Cola IA: solo filas `ai_required` con `homolog_final_status = GRAY_IA_QUEUED` tras el motor DB paso 2.
 * Aplica reglas post-IA sobre `homolog_final_status` y `catalog_match_status`. No crea maestros ni vínculos definitivos.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { MatchCandidate } from '@/lib/retail-association'
import { getUserFriendlyErrorMessage } from '@/lib/user-friendly-errors'
import {
  isRetailIaHomologationConfigured,
  resolveRetailCatalogHomologIaHintOpenRouter,
  retailIaHomologationEnabled,
  retailIaHomologationMaxCallsPerRun,
} from '@/server/retail-openrouter-match'
import { fetchScrappingSimilarityManualCandidates } from '@/server/retail/scrapping/scrapping-similarity-manual'

export type HomologGrayIaSummary = {
  processed: number
  userReview: number
  tentativeAi: number
  rejected: number
  errors: number
}

function masterNameFromCandidateLabel(label: string): string {
  const idx = label.indexOf(' · ')
  return idx > 0 ? label.slice(0, idx) : label
}

export type HomologGrayIaBatchResult = {
  stats: HomologGrayIaSummary
  hasMore: boolean
  lastId: string | null
  total: number
}

/**
 * Procesa un lote de filas de la cola IA gris (GRAY_IA_QUEUED + ai_required).
 * Devuelve stats parciales, `hasMore` y `lastId` para paginación cursor.
 */
export async function processHomologationGrayIaBatch(
  admin: SupabaseClient,
  input: { afterId?: string | null; batchSize?: number },
): Promise<{ ok: true; result: HomologGrayIaBatchResult } | { ok: false; error: string }> {
  if (!retailIaHomologationEnabled() || !isRetailIaHomologationConfigured()) {
    return { ok: false, error: 'La IA no está configurada o está desactivada.' }
  }

  const limit = Math.min(Math.max(input.batchSize ?? 10, 1), 50)

  // Contar total restante (para que el cliente sepa el denominador)
  const { count: totalRemaining } = await admin
    .from('scrapping')
    .select('id', { count: 'exact', head: true })
    .eq('catalog_match_status', 'pending')
    .eq('homolog_final_status', 'GRAY_IA_QUEUED')
    .eq('ai_required', true)

  let q = admin
    .from('scrapping')
    .select(
      'id, retailer, external_ref, product_name, brand, price, sections, categories, catalog_match_status, homolog_final_status, base_best_product_id, base_gap, base_score',
    )
    .eq('catalog_match_status', 'pending')
    .eq('homolog_final_status', 'GRAY_IA_QUEUED')
    .eq('ai_required', true)
    .order('id', { ascending: true })
    .limit(limit)

  if (input.afterId?.trim()) {
    q = q.gt('id', input.afterId.trim())
  }

  const { data: rows, error } = await q
  if (error) return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }

  const list = rows ?? []
  const summary: HomologGrayIaSummary = { processed: 0, userReview: 0, tentativeAi: 0, rejected: 0, errors: 0 }
  let lastId: string | null = null

  for (const row of list) {
    lastId = row.id
    const singleResult = await processOneGrayIaRow(admin, row)
    summary.processed += 1
    summary.userReview += singleResult.userReview
    summary.tentativeAi += singleResult.tentativeAi
    summary.rejected += singleResult.rejected
    summary.errors += singleResult.errors
  }

  return {
    ok: true,
    result: {
      stats: summary,
      hasMore: list.length === limit,
      lastId,
      total: totalRemaining ?? 0,
    },
  }
}

/** Procesa una sola fila de la cola IA gris. Extrae lógica reutilizable. */
async function processOneGrayIaRow(
  admin: SupabaseClient,
  row: Record<string, unknown>,
): Promise<{ userReview: number; tentativeAi: number; rejected: number; errors: number }> {
  const result = { userReview: 0, tentativeAi: 0, rejected: 0, errors: 0 }
  try {
    const cand = await fetchScrappingSimilarityManualCandidates(admin, row as never)
    if (!cand.ok) { result.errors = 1; return result }

    const mcs: MatchCandidate[] = cand.candidates.map((c) => ({
      catalog_product_id: c.catalogProductId,
      product_name: masterNameFromCandidateLabel(c.label),
      category_id: c.categoryId ?? '',
      default_reference_price: c.defaultReferencePrice,
      match_score: c.matchScore,
    }))

    const payloadCand = mcs.slice(0, 12).map((c) => ({
      id: c.catalog_product_id,
      nombre: c.product_name.slice(0, 220),
      precio_referencia: c.default_reference_price,
    }))

    if (payloadCand.length === 0) {
      await admin.from('scrapping').update({
        homolog_final_status: 'USER_REVIEW',
        ai_required: false,
        ai_decision: 'AI_UNSURE',
        ai_result: { reason: 'sin_candidatos_post_motor' } as never,
      }).eq('id', row.id)
      result.userReview = 1
      return result
    }

    const hints = [
      (row.sections as string)?.trim(),
      (row.categories as string)?.trim(),
    ].filter(Boolean).join(' · ')
    const priceNum = typeof row.price === 'string' ? Number(row.price) : Number(row.price)
    const scrapPrice = Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null

    const ia = await resolveRetailCatalogHomologIaHintOpenRouter({
      retailTitle: row.product_name as string,
      retailPrice: scrapPrice,
      brandHint: row.brand as string | null,
      descriptionHint: hints || null,
      candidates: payloadCand,
      mode: 'ambiguous_review',
      baseTopScore: row.base_score != null ? Number(row.base_score) : null,
      baseGap: row.base_gap != null ? Number(row.base_gap) : null,
      proposedCatalogProductId: (row as { base_best_product_id?: string }).base_best_product_id ?? null,
    })

    if (!ia) {
      await admin.from('scrapping').update({
        homolog_final_status: 'USER_REVIEW',
        ai_required: false,
        ai_decision: 'AI_UNSURE',
        ai_result: { reason: 'sin_respuesta_ia' } as never,
      }).eq('id', row.id)
      result.userReview = 1
      return result
    }

    const aiDecision =
      ia.sameProduct === false ? 'AI_REJECT'
      : ia.sameProduct === true ? 'AI_SUPPORT'
      : 'AI_UNSURE'

    let finalStatus: string
    let nextCatalogStatus: string
    let matched: string | null = null

    if (aiDecision === 'AI_UNSURE') {
      finalStatus = 'USER_REVIEW'; nextCatalogStatus = 'pending'; result.userReview = 1
    } else if (aiDecision === 'AI_REJECT' || (ia.aiScore != null && ia.aiScore < 0.65)) {
      finalStatus = 'PENDING_NEW_AI_REJECTED'; nextCatalogStatus = 'pending_new'; result.rejected = 1
    } else if (ia.aiScore != null && ia.aiScore >= 0.88 && aiDecision === 'AI_SUPPORT') {
      finalStatus = 'ACTIVE_TENTATIVE_AI_SUPPORTED'; nextCatalogStatus = 'pending_homolog'
      matched = ia.candidateSuggested ?? (row as { base_best_product_id?: string }).base_best_product_id ?? null
      result.tentativeAi = 1
    } else {
      finalStatus = 'USER_REVIEW'; nextCatalogStatus = 'pending'; result.userReview = 1
    }

    const aiResult = {
      ai_hint: ia.aiHint,
      candidate_suggested: ia.candidateSuggested,
      ai_score: ia.aiScore,
      reason: ia.reason,
      same_product: ia.sameProduct,
      ai_decision: aiDecision,
      stored_at: new Date().toISOString(),
    }

    const { error: upErr } = await admin.from('scrapping').update({
      ai_score: ia.aiScore,
      ai_decision: aiDecision,
      ai_result: aiResult as never,
      homolog_final_status: finalStatus,
      catalog_match_status: nextCatalogStatus,
      matched_catalog_product_id: matched,
      ai_required: false,
    }).eq('id', row.id)

    if (upErr) result.errors = 1
  } catch {
    result.errors = 1
  }
  return result
}

/**
 * Versión legacy (procesa todo de golpe sin feedback intermedio).
 * Se mantiene para `runScrappingHomologationGrayIaAction`.
 */
export async function processHomologationGrayIaQueue(
  admin: SupabaseClient,
): Promise<{ ok: true; summary: HomologGrayIaSummary } | { ok: false; error: string }> {
  if (!retailIaHomologationEnabled() || !isRetailIaHomologationConfigured()) {
    return { ok: false, error: 'La IA no está configurada o está desactivada.' }
  }

  const max = retailIaHomologationMaxCallsPerRun()
  const { data: rows, error } = await admin
    .from('scrapping')
    .select(
      'id, retailer, external_ref, product_name, brand, price, sections, categories, catalog_match_status, homolog_final_status, base_best_product_id, base_gap, base_score',
    )
    .eq('catalog_match_status', 'pending')
    .eq('homolog_final_status', 'GRAY_IA_QUEUED')
    .eq('ai_required', true)
    .order('id', { ascending: true })
    .limit(max)

  if (error) return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }

  const list = rows ?? []
  const summary: HomologGrayIaSummary = { processed: 0, userReview: 0, tentativeAi: 0, rejected: 0, errors: 0 }

  for (const row of list) {
    const r = await processOneGrayIaRow(admin, row)
    summary.processed += 1
    summary.userReview += r.userReview
    summary.tentativeAi += r.tentativeAi
    summary.rejected += r.rejected
    summary.errors += r.errors
  }

  return { ok: true, summary }
}
