/**
 * Resumen previo paso 2: totales desde motor base (sin ejecutar IA ni escribir vínculos).
 * Sirve para que el usuario vea el alcance antes/durante la pasada masiva.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { decideRetailMaster, type MatchCandidate } from '@/lib/retail-association'
import { getUserFriendlyErrorMessage } from '@/lib/user-friendly-errors'
import {
  isRetailIaHomologationConfigured,
  retailIaHomologationEnabled,
  retailIaHomologationMaxCallsPerRun,
} from '@/server/retail-openrouter-match'
import {
  buildManualCandidatesFromPrepSlice,
  type ScrappingRowForSimilarity,
  type ScrappingSimilarityManualCandidate,
} from '@/server/retail/scrapping/scrapping-similarity-manual'
import {
  callPrepCandidatesForIds,
  computeMatchRanking,
  countScrappingSimilarityPending,
  fetchLinkedCatalogIdsForPrepBatch,
  scrappingBulkUsePrepSliceRpc,
} from '@/server/retail/scrapping/scrapping-similarity-bulk-prep'
import {
  scrappingSimilarityDecisionThresholds,
  scrappingSimilarityIaInvokeMinBaseScore,
  scrappingSimilarityIaValidateBeforeAutolink,
} from '@/server/retail/scrapping/scrapping-similarity-config'
import {
  clearScrappingTaxonomyCache,
  resolveCatalogCategoryIdForScrappingRow,
} from '@/server/retail/scrapping/scrapping-similarity-taxonomy'
import {
  decideScrappingSimilarityEngineVnext,
  scrappingSimilarityUseEngineVnext,
} from '@/server/retail/homologation/engine-vnext/decide-scrapping-similarity-vnext'

const SUMMARY_PAGE_SIZE = 400
const PREP_IDS_CHUNK = 80

/** Máximo `match_score` del RPC dentro del JSON ya devuelto por `scrapping_similarity_prep_candidates_for_ids` (evita segunda pasada SQL). */
function maxRpcScoreFromPrepCandidatesJson(rpc: unknown): number {
  if (!Array.isArray(rpc)) return 0
  let max = 0
  for (const item of rpc) {
    if (!item || typeof item !== 'object') continue
    const n = Number((item as { match_score?: unknown }).match_score)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max
}

function summaryRowConcurrency(): number {
  const raw = process.env.SCRAPPING_SUMMARY_ROW_CONCURRENCY?.trim()
  const n = raw ? Number(raw) : 20
  if (!Number.isFinite(n) || n < 1) return 20
  return Math.min(Math.floor(n), 32)
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

function masterNameFromCandidateLabel(label: string): string {
  const idx = label.indexOf(' · ')
  return idx > 0 ? label.slice(0, idx) : label
}

async function classifySimilarityRetailDecision(
  admin: SupabaseClient,
  row: ScrappingRowForSimilarity,
  cand: ScrappingSimilarityManualCandidate[],
): Promise<{ action: 'link' | 'create_novel' | 'ambiguous'; matchCandidates: MatchCandidate[] }> {
  if (cand.length === 0) {
    return { action: 'create_novel', matchCandidates: [] }
  }

  const matchCandidates: MatchCandidate[] = cand.map((c) => ({
    catalog_product_id: c.catalogProductId,
    product_name: masterNameFromCandidateLabel(c.label),
    category_id: c.categoryId ?? '',
    default_reference_price: c.defaultReferencePrice,
    match_score: c.matchScore,
  }))

  const hints = [row.sections?.trim(), row.categories?.trim()].filter(Boolean).join(' · ')
  const priceNum = typeof row.price === 'string' ? Number(row.price) : row.price
  const scrapPrice = Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null
  const thresholds = scrappingSimilarityDecisionThresholds()
  const scrapedCategoryId =
    scrappingSimilarityUseEngineVnext() ?
      await resolveCatalogCategoryIdForScrappingRow(admin, {
        retailer: row.retailer,
        sections: row.sections,
        categories: row.categories,
      })
    : null

  const decision = scrappingSimilarityUseEngineVnext() ?
    decideScrappingSimilarityEngineVnext({
      candidates: matchCandidates,
      brandHint: row.brand,
      descriptionHint: hints || null,
      retailTitle: row.product_name,
      retailPrice: scrapPrice,
      scrapedCategoryId,
      ...thresholds,
    })
  : decideRetailMaster({
      candidates: matchCandidates,
      brandHint: row.brand,
      descriptionHint: hints || null,
      retailTitle: row.product_name,
      retailPrice: scrapPrice,
      ...thresholds,
    })

  if (decision.action === 'link' && decision.catalogProductId) {
    return { action: 'link', matchCandidates }
  }
  if (decision.action === 'create_novel') {
    return { action: 'create_novel', matchCandidates }
  }
  return { action: 'ambiguous', matchCandidates }
}

function wouldCountIaInvocation(
  cls: { action: 'link' | 'create_novel' | 'ambiguous'; matchCandidates: MatchCandidate[] },
): boolean {
  if (!retailIaHomologationEnabled() || !isRetailIaHomologationConfigured()) return false
  const thresholds = scrappingSimilarityDecisionThresholds()
  const floor = scrappingSimilarityIaInvokeMinBaseScore(thresholds.ambiguousMin)
  const rank = computeMatchRanking(cls.matchCandidates)
  if (rank.topScore < floor) return false
  if (cls.action === 'ambiguous') return true
  if (cls.action === 'link' && scrappingSimilarityIaValidateBeforeAutolink()) return true
  return false
}

export type ScrappingSimilarityPrepSummary = {
  totalPending: number
  rowsAnalyzed: number
  estimatedAutoLink: number
  estimatedAutoPendingNew: number
  /** Ambiguo motor base: revisión humana; parte puede recibir IA en la pasada si hay presupuesto. */
  estimatedNeedsReview: number
  /** Llamadas IA máximas que haría la pasada masiva (sin tope de presupuesto por corrida). */
  estimatedIaInvocations: number
  iaEnabled: boolean
  iaMaxPerRun: number
  usedPrepSliceRpc: boolean
  prepSliceError: string | null
  disclaimer: string
  /**
   * Métricas rápidas desde el JSON de candidatos RPC (misma consulta que el motor; sin segunda pasada SQL).
   * `conservativeNoIaByCompositeCeil`: filas donde el techo 0.42*topRpc+0.58 queda por debajo del piso de invocación IA (cota del compuesto en `enrichRetailCandidatesCompositeScore`).
   */
  fastBaseRpc?: {
    rowsScored: number
    conservativeNoIaByCompositeCeil: number
    maxTopRpc: number
    minTopRpc: number
  }
}

/**
 * Lee todos los pending (paginado), RPC por chunks y clasificación en memoria (sin side effects).
 */
export async function computeScrappingSimilarityPrepSummary(
  admin: SupabaseClient,
): Promise<{ ok: true; summary: ScrappingSimilarityPrepSummary } | { ok: false; error: string }> {
  clearScrappingTaxonomyCache()

  const totalPending = await countScrappingSimilarityPending(admin)
  const emptySummary = (): ScrappingSimilarityPrepSummary => ({
    totalPending,
    rowsAnalyzed: 0,
    estimatedAutoLink: 0,
    estimatedAutoPendingNew: 0,
    estimatedNeedsReview: 0,
    estimatedIaInvocations: 0,
    iaEnabled: retailIaHomologationEnabled() && isRetailIaHomologationConfigured(),
    iaMaxPerRun: retailIaHomologationMaxCallsPerRun(),
    usedPrepSliceRpc: false,
    prepSliceError: null,
    disclaimer:
      'Estos valores son una estimación previa. Los resultados finales pueden variar ligeramente.',
  })

  if (totalPending === 0) {
    return { ok: true, summary: emptySummary() }
  }

  if (!scrappingBulkUsePrepSliceRpc()) {
    return {
      ok: true,
      summary: {
        ...emptySummary(),
        prepSliceError:
          'Resumen por motor base desactivado (SCRAPPING_BULK_USE_PREP_SLICE_RPC=0). Solo se muestra el total pending.',
      },
    }
  }

  let estimatedAutoLink = 0
  let estimatedAutoPendingNew = 0
  let estimatedNeedsReview = 0
  let estimatedIaInvocations = 0
  let rowsAnalyzed = 0
  let usedPrepSliceRpc = true
  let prepSliceError: string | null = null

  const thresholds = scrappingSimilarityDecisionThresholds()
  const iaFloor = scrappingSimilarityIaInvokeMinBaseScore(thresholds.ambiguousMin)
  let fastRowsScored = 0
  let fastConservativeNoIa = 0
  let fastMaxRpc = 0
  let fastMinRpc: number | null = null
  const rowConc = summaryRowConcurrency()

  try {
    let afterId: string | null = null
    for (;;) {
      let q = admin
        .from('scrapping')
        .select('id, retailer, external_ref, product_name, brand, price, sections, categories, catalog_match_status')
        .eq('catalog_match_status', 'pending')
        .order('id', { ascending: true })
        .limit(SUMMARY_PAGE_SIZE)

      if (afterId?.trim()) {
        q = q.gt('id', afterId.trim())
      }

      const { data: batch, error } = await q
      if (error) {
        return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
      }

      const rows = (batch ?? []) as ScrappingRowForSimilarity[]
      if (rows.length === 0) break

      for (let i = 0; i < rows.length; i += PREP_IDS_CHUNK) {
        const slice = rows.slice(i, i + PREP_IDS_CHUNK)
        const sliceIds = slice.map((r) => r.id)
        const prepMap = await callPrepCandidatesForIds(admin, sliceIds)

        for (const row of slice) {
          const pr = prepMap.get(row.id)
          if (!pr) continue
          const top = maxRpcScoreFromPrepCandidatesJson(pr.rpc_candidates)
          fastRowsScored += 1
          fastMaxRpc = Math.max(fastMaxRpc, top)
          fastMinRpc = fastMinRpc == null ? top : Math.min(fastMinRpc, top)
          const compositeCeil = 0.42 * top + 0.58
          if (compositeCeil < iaFloor) fastConservativeNoIa += 1
        }

        const linkMap = await fetchLinkedCatalogIdsForPrepBatch(admin, slice, prepMap)

        const tallies = await mapWithConcurrency(slice, rowConc, async (row) => {
          const pr = prepMap.get(row.id)
          if (!pr) return null
          const built = await buildManualCandidatesFromPrepSlice(
            admin,
            row,
            pr.rpc_candidates,
            linkMap.get(row.retailer?.trim() || '') ?? new Set(),
          )
          if (!built.ok) return null
          return classifySimilarityRetailDecision(admin, row, built.candidates)
        })

        for (const cls of tallies) {
          if (!cls) continue
          rowsAnalyzed += 1
          if (cls.action === 'link') estimatedAutoLink += 1
          else if (cls.action === 'create_novel') estimatedAutoPendingNew += 1
          else estimatedNeedsReview += 1

          if (wouldCountIaInvocation(cls)) estimatedIaInvocations += 1
        }
      }

      afterId = rows[rows.length - 1]!.id
      if (rows.length < SUMMARY_PAGE_SIZE) break
    }

    const fastBaseRpc: ScrappingSimilarityPrepSummary['fastBaseRpc'] =
      fastRowsScored > 0 ?
        {
          rowsScored: fastRowsScored,
          conservativeNoIaByCompositeCeil: fastConservativeNoIa,
          maxTopRpc: fastMaxRpc,
          minTopRpc: fastMinRpc ?? 0,
        }
      : undefined

    return {
      ok: true,
      summary: {
        totalPending,
        rowsAnalyzed,
        estimatedAutoLink,
        estimatedAutoPendingNew,
        estimatedNeedsReview,
        estimatedIaInvocations,
        iaEnabled: retailIaHomologationEnabled() && isRetailIaHomologationConfigured(),
        iaMaxPerRun: retailIaHomologationMaxCallsPerRun(),
        usedPrepSliceRpc,
        prepSliceError,
        fastBaseRpc,
        disclaimer:
          'Estos valores son una estimación previa. Los resultados finales pueden variar ligeramente.' +
          (fastBaseRpc ?
            ' Algunos productos podrían no requerir evaluación con IA si su coincidencia es suficientemente alta.'
          : ''),
      },
    }
  } catch (e) {
    usedPrepSliceRpc = false
    prepSliceError = getUserFriendlyErrorMessage(e, 'generic')
    return {
      ok: true,
      summary: {
        totalPending,
        rowsAnalyzed,
        estimatedAutoLink: 0,
        estimatedAutoPendingNew: 0,
        estimatedNeedsReview: 0,
        estimatedIaInvocations: 0,
        iaEnabled: retailIaHomologationEnabled() && isRetailIaHomologationConfigured(),
        iaMaxPerRun: retailIaHomologationMaxCallsPerRun(),
        usedPrepSliceRpc,
        prepSliceError,
        disclaimer:
          'No se pudo calcular el desglose completo. Solo el total de productos pendientes es confiable.',
      },
    }
  }
}
