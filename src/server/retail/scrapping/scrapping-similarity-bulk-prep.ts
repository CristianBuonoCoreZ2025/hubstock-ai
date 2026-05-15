/**
 * Paso 2 · pasada masiva: resuelve filas `pending` en servidor (vínculo automático, producto nuevo o deja en revisión).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  decideRetailMaster,
  RETAIL_COMPOSITE_THRESHOLDS,
  type MatchCandidate,
} from '@/lib/retail-association'
import { getUserFriendlyErrorMessage } from '@/lib/user-friendly-errors'
import {
  confirmManualScrappingSimilarityLink,
  fetchScrappingSimilarityManualCandidates,
  markScrappingRowPendingNew,
} from '@/server/retail/scrapping/scrapping-similarity-manual'

const BULK_BATCH_DEFAULT = 35
const BULK_BATCH_MAX = 60

type ScrappingRowForSimilarity = {
  id: string
  retailer: string
  external_ref: string
  product_name: string
  brand: string | null
  price: number | string
  sections: string | null
  categories: string | null
}

export type SimilarityBulkBatchStats = {
  processed: number
  autoLinked: number
  autoPendingNew: number
  leftForReview: number
  failed: number
  lastId: string | null
  hasMore: boolean
}

export type SimilarityRowResolveOutcome =
  | { outcome: 'auto_linked' }
  | { outcome: 'auto_pending_new' }
  | { outcome: 'needs_review' }
  | { outcome: 'error' }

export async function countScrappingSimilarityPending(admin: SupabaseClient): Promise<number> {
  const { count, error } = await admin
    .from('scrapping')
    .select('id', { count: 'exact', head: true })
    .eq('catalog_match_status', 'pending')
  if (error) return 0
  return count ?? 0
}

function masterNameFromCandidateLabel(label: string): string {
  const idx = label.indexOf(' · ')
  return idx > 0 ? label.slice(0, idx) : label
}

export async function resolveScrappingSimilarityRowAutomatic(
  admin: SupabaseClient,
  row: ScrappingRowForSimilarity,
): Promise<SimilarityRowResolveOutcome> {
  const cand = await fetchScrappingSimilarityManualCandidates(admin, row)
  if (!cand.ok) return { outcome: 'error' }

  const priceNum = typeof row.price === 'string' ? Number(row.price) : row.price
  const scrapPrice = Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null

  if (cand.candidates.length === 0) {
    const r = await markScrappingRowPendingNew(admin, row.id)
    return r.ok ? { outcome: 'auto_pending_new' } : { outcome: 'error' }
  }

  const matchCandidates: MatchCandidate[] = cand.candidates.map((c) => ({
    catalog_product_id: c.catalogProductId,
    product_name: masterNameFromCandidateLabel(c.label),
    category_id: '',
    default_reference_price: c.defaultReferencePrice,
    match_score: c.matchScore,
  }))

  const hints = [row.sections?.trim(), row.categories?.trim()].filter(Boolean).join(' · ')
  const decision = decideRetailMaster({
    candidates: matchCandidates,
    brandHint: row.brand,
    descriptionHint: hints || null,
    retailTitle: row.product_name,
    retailPrice: scrapPrice,
    linkMin: RETAIL_COMPOSITE_THRESHOLDS.linkMin,
    ambiguousMin: RETAIL_COMPOSITE_THRESHOLDS.ambiguousMin,
    novelMax: RETAIL_COMPOSITE_THRESHOLDS.novelMax,
    minGapFirstSecond: RETAIL_COMPOSITE_THRESHOLDS.minGapFirstSecond,
  })

  if (decision.action === 'link' && decision.catalogProductId) {
    const allowed = new Set(cand.candidates.map((c) => c.catalogProductId))
    if (!allowed.has(decision.catalogProductId)) {
      return { outcome: 'needs_review' }
    }
    const link = await confirmManualScrappingSimilarityLink(admin, row.id, decision.catalogProductId)
    return link.ok ? { outcome: 'auto_linked' } : { outcome: 'error' }
  }

  if (decision.action === 'create_novel') {
    const r = await markScrappingRowPendingNew(admin, row.id)
    return r.ok ? { outcome: 'auto_pending_new' } : { outcome: 'error' }
  }

  return { outcome: 'needs_review' }
}

export async function processScrappingSimilarityBulkBatch(
  admin: SupabaseClient,
  input: { afterId?: string | null; limit?: number },
): Promise<{ ok: true; stats: SimilarityBulkBatchStats } | { ok: false; error: string }> {
  const limit = Math.min(Math.max(input.limit ?? BULK_BATCH_DEFAULT, 1), BULK_BATCH_MAX)

  let q = admin
    .from('scrapping')
    .select('id, retailer, external_ref, product_name, brand, price, sections, categories, catalog_match_status')
    .eq('catalog_match_status', 'pending')
    .order('id', { ascending: true })
    .limit(limit)

  if (input.afterId?.trim()) {
    q = q.gt('id', input.afterId.trim())
  }

  const { data: rows, error } = await q
  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  }

  const list = (rows ?? []) as ScrappingRowForSimilarity[]
  if (list.length === 0) {
    return {
      ok: true,
      stats: {
        processed: 0,
        autoLinked: 0,
        autoPendingNew: 0,
        leftForReview: 0,
        failed: 0,
        lastId: input.afterId ?? null,
        hasMore: false,
      },
    }
  }

  let autoLinked = 0
  let autoPendingNew = 0
  let leftForReview = 0
  let failed = 0

  for (const row of list) {
    const r = await resolveScrappingSimilarityRowAutomatic(admin, row)
    if (r.outcome === 'auto_linked') autoLinked++
    else if (r.outcome === 'auto_pending_new') autoPendingNew++
    else if (r.outcome === 'needs_review') leftForReview++
    else failed++
  }

  const lastId = list[list.length - 1]!.id

  return {
    ok: true,
    stats: {
      processed: list.length,
      autoLinked,
      autoPendingNew,
      leftForReview,
      failed,
      lastId,
      hasMore: list.length >= limit,
    },
  }
}
