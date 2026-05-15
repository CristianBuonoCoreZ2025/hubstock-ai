/**
 * Paso 2 · pasada masiva: resuelve filas `pending` en servidor (vínculo automático, producto nuevo o deja en revisión).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { decideRetailMaster, type MatchCandidate } from '@/lib/retail-association'
import { scrappingSimilarityDecisionThresholds } from '@/server/retail/scrapping/scrapping-similarity-config'
import { clearScrappingTaxonomyCache } from '@/server/retail/scrapping/scrapping-similarity-taxonomy'
import { getUserFriendlyErrorMessage } from '@/lib/user-friendly-errors'
import {
  confirmManualScrappingSimilarityLink,
  fetchScrappingSimilarityManualCandidates,
  markScrappingRowPendingNew,
} from '@/server/retail/scrapping/scrapping-similarity-manual'
import {
  tryScrappingSimilarityFastPaths,
  type SimilarityRowResolveOutcome,
} from '@/server/retail/scrapping/scrapping-similarity-fast-path'
import {
  createScrappingIaBudget,
  tryResolveScrappingSimilarityWithIa,
  type ScrappingIaBudget,
} from '@/server/retail/scrapping/scrapping-similarity-ia-resolve'
import {
  logScrappingBulk,
  logScrappingBulkRowSlow,
  scrappingBulkSlowRowMs,
} from '@/server/retail/scrapping/scrapping-similarity-bulk-log'
import { patchSimilarityBulkJob } from '@/server/retail/scrapping/scrapping-similarity-bulk-job-store'

const BULK_BATCH_DEFAULT = 50
const BULK_BATCH_MAX = 80
const BULK_CONCURRENCY_DEFAULT = 8
const BULK_MULTI_BATCH_DEFAULT = 5
const BULK_MULTI_BATCH_MAX = 20

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
  autoLinkedByIa: number
  autoPendingNew: number
  leftForReview: number
  failed: number
  lastId: string | null
  hasMore: boolean
}

export type SimilarityBulkRunStats = Omit<SimilarityBulkBatchStats, 'lastId' | 'hasMore'> & {
  batchesRun: number
}

export function scrappingBulkUseBackgroundJob(): boolean {
  const v = process.env.SCRAPPING_BULK_USE_BACKGROUND_JOB?.trim().toLowerCase()
  if (v === '0' || v === 'false' || v === 'no') return false
  return true
}

export function scrappingBulkSkipAutoOnModalOpen(): boolean {
  const v = process.env.SCRAPPING_BULK_SKIP_AUTO_ON_OPEN?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

export type { SimilarityRowResolveOutcome }

function envInt(name: string, fallback: number, max: number): number {
  const raw = process.env[name]?.trim()
  const n = raw ? Number(raw) : fallback
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(Math.floor(n), max)
}

/** Filas por lote SQL (`SCRAPPING_BULK_BATCH_SIZE`, default 50). */
export function scrappingSimilarityBulkBatchSize(): number {
  if (process.env.SCRAPPING_BULK_FORCE_SERIAL?.trim() === '1') {
    return envInt('SCRAPPING_BULK_BATCH_SIZE', BULK_BATCH_DEFAULT, BULK_BATCH_MAX)
  }
  return envInt('SCRAPPING_BULK_BATCH_SIZE', BULK_BATCH_DEFAULT, BULK_BATCH_MAX)
}

/** Filas en paralelo dentro del lote (`SCRAPPING_BULK_CONCURRENCY`, default 8). */
export function scrappingSimilarityBulkConcurrency(): number {
  if (process.env.SCRAPPING_BULK_FORCE_SERIAL?.trim() === '1') return 1
  return envInt('SCRAPPING_BULK_CONCURRENCY', BULK_CONCURRENCY_DEFAULT, 16)
}

/** Lotes internos por request HTTP (`SCRAPPING_BULK_MULTI_BATCH_COUNT`, default 5). */
export function scrappingSimilarityBulkMultiBatchCount(): number {
  return envInt('SCRAPPING_BULK_MULTI_BATCH_COUNT', BULK_MULTI_BATCH_DEFAULT, BULK_MULTI_BATCH_MAX)
}

let warnedForceSerial = false

const PROGRESS_PATCH_EVERY_ROWS = 5

function warnIfForceSerial(): void {
  if (process.env.SCRAPPING_BULK_FORCE_SERIAL?.trim() !== '1') return
  if (warnedForceSerial) return
  warnedForceSerial = true
  console.warn(
    '[scrapping-bulk] SCRAPPING_BULK_FORCE_SERIAL=1 → sin paralelismo (modo lento). Quita esa variable y reinicia el servidor de desarrollo.',
  )
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const workers = Math.min(Math.max(1, concurrency), items.length)
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex
      nextIndex += 1
      if (i >= items.length) return
      results[i] = await fn(items[i]!)
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()))
  return results
}

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
  iaBudget?: ScrappingIaBudget | null,
): Promise<SimilarityRowResolveOutcome> {
  const fast = await tryScrappingSimilarityFastPaths(admin, row)
  if (fast) return fast

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
    category_id: c.categoryId ?? '',
    default_reference_price: c.defaultReferencePrice,
    match_score: c.matchScore,
  }))

  const hints = [row.sections?.trim(), row.categories?.trim()].filter(Boolean).join(' · ')
  const thresholds = scrappingSimilarityDecisionThresholds()
  const decision = decideRetailMaster({
    candidates: matchCandidates,
    brandHint: row.brand,
    descriptionHint: hints || null,
    retailTitle: row.product_name,
    retailPrice: scrapPrice,
    ...thresholds,
  })

  if (decision.action === 'link' && decision.catalogProductId) {
    const allowed = new Set(cand.candidates.map((c) => c.catalogProductId))
    if (!allowed.has(decision.catalogProductId)) {
      return { outcome: 'needs_review' }
    }
    const link = await confirmManualScrappingSimilarityLink(admin, row.id, decision.catalogProductId, {
      skipCandidateRevalidation: true,
    })
    return link.ok ? { outcome: 'auto_linked' } : { outcome: 'error' }
  }

  if (decision.action === 'create_novel') {
    const r = await markScrappingRowPendingNew(admin, row.id)
    return r.ok ? { outcome: 'auto_pending_new' } : { outcome: 'error' }
  }

  const ia = await tryResolveScrappingSimilarityWithIa(
    admin,
    {
      scrappingId: row.id,
      productName: row.product_name,
      brand: row.brand,
      price: scrapPrice,
      descriptionHint: hints || null,
      matchCandidates,
      allowedCatalogIds: new Set(cand.candidates.map((c) => c.catalogProductId)),
    },
    iaBudget ?? null,
  )
  if (ia) return ia

  return { outcome: 'needs_review' }
}

function emptyBatchStats(afterId: string | null): SimilarityBulkBatchStats {
  return {
    processed: 0,
    autoLinked: 0,
    autoLinkedByIa: 0,
    autoPendingNew: 0,
    leftForReview: 0,
    failed: 0,
    lastId: afterId,
    hasMore: false,
  }
}

function accumulateBatchStats(
  acc: SimilarityBulkRunStats,
  batch: SimilarityBulkBatchStats,
): void {
  acc.processed += batch.processed
  acc.autoLinked += batch.autoLinked
  acc.autoLinkedByIa += batch.autoLinkedByIa
  acc.autoPendingNew += batch.autoPendingNew
  acc.leftForReview += batch.leftForReview
  acc.failed += batch.failed
  acc.batchesRun += 1
}

export async function processScrappingSimilarityBulkBatch(
  admin: SupabaseClient,
  input: {
    afterId?: string | null
    limit?: number
    jobId?: string | null
    processedBase?: number
    batchNumber?: number
  },
): Promise<{ ok: true; stats: SimilarityBulkBatchStats } | { ok: false; error: string }> {
  warnIfForceSerial()
  clearScrappingTaxonomyCache()
  const limit = Math.min(
    Math.max(input.limit ?? scrappingSimilarityBulkBatchSize(), 1),
    BULK_BATCH_MAX,
  )
  const concurrency = scrappingSimilarityBulkConcurrency()
  const jobId = input.jobId?.trim() || null
  const processedBase = input.processedBase ?? 0
  const batchNumber = input.batchNumber ?? 0
  const slowRowMs = scrappingBulkSlowRowMs()
  const tBatchStart = Date.now()

  logScrappingBulk('batch_start', {
    jobId,
    batchNumber,
    afterId: input.afterId ?? null,
    limit,
    concurrency,
    processedBase,
  })

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
    return { ok: true, stats: emptyBatchStats(input.afterId ?? null) }
  }

  const iaBudget = createScrappingIaBudget()
  let rowsDoneInBatch = 0
  let progressChain: Promise<void> = Promise.resolve()
  const outcomes = await mapWithConcurrency(list, concurrency, async (row) => {
    const tRow = Date.now()
    const outcome = await resolveScrappingSimilarityRowAutomatic(admin, row, iaBudget)
    const rowMs = Date.now() - tRow
    if (rowMs >= slowRowMs) {
      logScrappingBulkRowSlow({
        jobId,
        batchNumber,
        scrappingId: row.id,
        ms: rowMs,
        outcome: outcome.outcome,
        productName: row.product_name.slice(0, 80),
      })
    }
    progressChain = progressChain.then(() => {
      rowsDoneInBatch += 1
      if (jobId && rowsDoneInBatch % PROGRESS_PATCH_EVERY_ROWS === 0) {
        patchSimilarityBulkJob(jobId, { processed: processedBase + rowsDoneInBatch })
      }
    })
    return outcome
  })
  await progressChain

  let autoLinked = 0
  let autoLinkedByIa = 0
  let autoPendingNew = 0
  let leftForReview = 0
  let failed = 0
  for (const r of outcomes) {
    if (r.outcome === 'auto_linked' || r.outcome === 'auto_linked_ia') {
      autoLinked++
      if (r.outcome === 'auto_linked_ia') autoLinkedByIa++
    } else if (r.outcome === 'auto_pending_new') autoPendingNew++
    else if (r.outcome === 'needs_review') leftForReview++
    else failed++
  }

  const lastId = list[list.length - 1]!.id
  const batchMs = Date.now() - tBatchStart
  logScrappingBulk('batch_end', {
    jobId,
    batchNumber,
    rows: list.length,
    concurrency,
    ms: batchMs,
    msPerRow: list.length > 0 ? Math.round(batchMs / list.length) : 0,
    autoLinked,
    autoLinkedByIa,
    autoPendingNew,
    leftForReview,
    failed,
    iaBudgetRemaining: iaBudget?.remaining ?? null,
    lastId,
    hasMore: list.length >= limit,
  })

  return {
    ok: true,
    stats: {
      processed: list.length,
      autoLinked,
      autoLinkedByIa,
      autoPendingNew,
      leftForReview,
      failed,
      lastId,
      hasMore: list.length >= limit,
    },
  }
}

/** Varios lotes en una sola invocación (menos round-trips desde el modal). */
export async function processScrappingSimilarityBulkMultiBatch(
  admin: SupabaseClient,
  input: { afterId?: string | null; maxBatches?: number },
): Promise<
  | { ok: true; stats: SimilarityBulkRunStats; lastId: string | null; hasMore: boolean }
  | { ok: false; error: string }
> {
  const maxBatches = Math.min(
    Math.max(input.maxBatches ?? scrappingSimilarityBulkMultiBatchCount(), 1),
    BULK_MULTI_BATCH_MAX,
  )
  const acc: SimilarityBulkRunStats = {
    processed: 0,
    autoLinked: 0,
    autoLinkedByIa: 0,
    autoPendingNew: 0,
    leftForReview: 0,
    failed: 0,
    batchesRun: 0,
  }
  let afterId = input.afterId?.trim() || null
  let hasMore = false

  const t0 = Date.now()
  for (let i = 0; i < maxBatches; i++) {
    const r = await processScrappingSimilarityBulkBatch(admin, { afterId })
    if (!r.ok) return r
    accumulateBatchStats(acc, r.stats)
    afterId = r.stats.lastId
    hasMore = r.stats.hasMore
    if (!hasMore || !afterId) break
  }

  logScrappingBulk('multi_batch', {
    batchesRun: acc.batchesRun,
    processed: acc.processed,
    ms: Date.now() - t0,
    hasMore,
  })

  return { ok: true, stats: acc, lastId: afterId, hasMore }
}
