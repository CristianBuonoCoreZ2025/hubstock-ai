/**
 * Paso 2 manual: candidatos por marca + nombre (RPC trigram + score compuesto) y precio maestro
 * dentro de ±band CLP respecto al precio capturado; el usuario elige en UI o marca pending_new.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeCatalogAlias } from '@/lib/catalog-alias'
import {
  brandHintInName,
  enrichRetailCandidatesCompositeScore,
  type MatchCandidate,
} from '@/lib/retail-association'
import { normalizeSearchText } from '@/lib/search'
import { getUserFriendlyErrorMessage, isUniqueViolation } from '@/lib/user-friendly-errors'
import {
  scrappingCategoryMismatchPenalty,
  scrappingRetailerLinkScoreBoost,
} from '@/server/retail/scrapping/scrapping-similarity-config'
import { resolveCatalogCategoryIdForScrappingRow } from '@/server/retail/scrapping/scrapping-similarity-taxonomy'

const DEFAULT_PRICE_BAND_CLP = 3000

function similarityPriceBandClp(): number {
  const raw = process.env.SCRAPPING_SIMILARITY_PRICE_BAND_CLP?.trim()
  const n = raw ? Number(raw) : DEFAULT_PRICE_BAND_CLP
  if (!Number.isFinite(n) || n < 0) return DEFAULT_PRICE_BAND_CLP
  return Math.min(Math.floor(n), 500_000)
}

export type ScrappingSimilarityManualCandidate = {
  catalogProductId: string
  label: string
  defaultReferencePrice: number | null
  matchScore: number
  categoryId: string | null
}

export type ScrappingRowForSimilarity = {
  id: string
  retailer: string
  external_ref: string
  product_name: string
  brand: string | null
  price: number | string
  sections: string | null
  categories: string | null
  catalog_match_status?: string | null
}

function matchCandidatesFromRpc(candRaw: unknown): MatchCandidate[] {
  const candList = Array.isArray(candRaw) ? candRaw : []
  return candList.map(
    (r: {
      catalog_product_id: string
      product_name: string
      category_id: string
      default_reference_price: number | null
      match_score: number
    }) => ({
      catalog_product_id: String(r.catalog_product_id),
      product_name: String(r.product_name),
      category_id: String(r.category_id),
      default_reference_price:
        r.default_reference_price != null ? Number(r.default_reference_price) : null,
      match_score: Number(r.match_score),
    }),
  )
}

function scrapBrandMatchesCatalog(
  scrapBrand: string | null,
  catalogBrand: string | null,
  catalogName: string,
): boolean {
  const s = scrapBrand?.trim()
  if (!s) return true
  const cb = catalogBrand?.trim()
  if (cb) {
    const ns = normalizeSearchText(s)
    const nb = normalizeSearchText(cb)
    if (ns && nb && (ns === nb || nb.includes(ns) || ns.includes(nb))) return true
  }
  return brandHintInName(scrapBrand, catalogName)
}

function withinPriceBandClp(
  scrapPrice: number | null,
  refPrice: number | null,
  band: number,
): boolean {
  if (scrapPrice == null || !Number.isFinite(scrapPrice) || scrapPrice <= 0) return true
  if (refPrice == null || !Number.isFinite(refPrice) || refPrice <= 0) return false
  return Math.abs(refPrice - scrapPrice) <= band
}

function labelForMaster(name: string, brand: string | null, ref: number | null): string {
  const refTxt =
    ref != null && Number.isFinite(ref) ? `$${Math.round(ref).toLocaleString('es-CL')}` : 'sin precio ref.'
  const b = brand?.trim() ? brand.trim() : '—'
  return `${name.slice(0, 120)} · ${b} · ${refTxt}`
}

async function boostCandidatesByRetailerLinkHistory(
  admin: SupabaseClient,
  retailer: string,
  candidates: ScrappingSimilarityManualCandidate[],
): Promise<ScrappingSimilarityManualCandidate[]> {
  if (candidates.length === 0) return candidates
  const boost = scrappingRetailerLinkScoreBoost()
  if (boost <= 0) return candidates

  const ids = candidates.map((c) => c.catalogProductId)
  const { data: links } = await admin
    .from('catalog_retail_links')
    .select('catalog_product_id')
    .eq('retailer', retailer)
    .in('catalog_product_id', ids)

  const linked = new Set(
    (links ?? []).map((r) => String((r as { catalog_product_id: string }).catalog_product_id)),
  )
  if (linked.size === 0) return candidates

  return candidates
    .map((c) =>
      linked.has(c.catalogProductId) ?
        { ...c, matchScore: Math.min(1, c.matchScore + boost) }
      : c,
    )
    .sort((a, b) => b.matchScore - a.matchScore)
}

function applyCategoryContextToScores(
  candidates: ScrappingSimilarityManualCandidate[],
  catalogCategoryId: string | null,
): ScrappingSimilarityManualCandidate[] {
  if (!catalogCategoryId) return candidates
  const penalty = scrappingCategoryMismatchPenalty()
  if (penalty <= 0) return candidates

  return candidates
    .map((c) => {
      if (!c.categoryId || c.categoryId === catalogCategoryId) return c
      return { ...c, matchScore: Math.max(0, c.matchScore - penalty) }
    })
    .sort((a, b) => b.matchScore - a.matchScore)
}

function applyRetailerLinkBoostInMemory(
  candidates: ScrappingSimilarityManualCandidate[],
  linkedCatalogProductIds: Set<string>,
): ScrappingSimilarityManualCandidate[] {
  if (candidates.length === 0) return candidates
  const boost = scrappingRetailerLinkScoreBoost()
  if (boost <= 0) return candidates
  return candidates
    .map((c) =>
      linkedCatalogProductIds.has(c.catalogProductId) ?
        { ...c, matchScore: Math.min(1, c.matchScore + boost) }
      : c,
    )
    .sort((a, b) => b.matchScore - a.matchScore)
}

/**
 * Construye la misma lista de candidatos que `fetchScrappingSimilarityManualCandidates`,
 * pero a partir del JSON devuelto por `scrapping_similarity_prep_candidates_for_ids` (sin 2.ª RPC por fila).
 */
export async function buildManualCandidatesFromPrepSlice(
  admin: SupabaseClient,
  row: ScrappingRowForSimilarity,
  rpcCandidatesJson: unknown,
  linkedCatalogProductIds: Set<string>,
): Promise<{ ok: true; candidates: ScrappingSimilarityManualCandidate[] } | { ok: false; error: string }> {
  try {
    const title = row.product_name?.trim() || ''
    const priceNum = typeof row.price === 'string' ? Number(row.price) : row.price
    const scrapPrice = Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null
    const band = similarityPriceBandClp()

    const catalogCategoryId = await resolveCatalogCategoryIdForScrappingRow(admin, {
      retailer: row.retailer,
      sections: row.sections,
      categories: row.categories,
    })

    const rawList = Array.isArray(rpcCandidatesJson) ? rpcCandidatesJson : []
    const brandByProductId = new Map<string, string | null>()
    for (const x of rawList) {
      if (!x || typeof x !== 'object') continue
      const o = x as { catalog_product_id?: unknown; catalog_brand?: unknown }
      const pid = o.catalog_product_id != null ? String(o.catalog_product_id) : ''
      if (!pid) continue
      brandByProductId.set(pid, o.catalog_brand != null ? String(o.catalog_brand) : null)
    }

    const matchCandidates = matchCandidatesFromRpc(rawList)

    const enriched = enrichRetailCandidatesCompositeScore(matchCandidates, title, scrapPrice)

    let filtered: ScrappingSimilarityManualCandidate[] = []
    for (const c of enriched) {
      const catalogBrand = brandByProductId.get(c.catalog_product_id) ?? null
      if (!scrapBrandMatchesCatalog(row.brand, catalogBrand, c.product_name)) continue
      if (!withinPriceBandClp(scrapPrice, c.default_reference_price, band)) continue
      filtered.push({
        catalogProductId: c.catalog_product_id,
        label: labelForMaster(c.product_name, catalogBrand, c.default_reference_price),
        defaultReferencePrice: c.default_reference_price,
        matchScore: Number(c.match_score ?? 0),
        categoryId: c.category_id ? String(c.category_id) : null,
      })
    }

    filtered = applyCategoryContextToScores(filtered, catalogCategoryId)
    filtered = applyRetailerLinkBoostInMemory(filtered, linkedCatalogProductIds)

    const scrapP = scrapPrice ?? 0
    filtered.sort((a, b) => {
      const da =
        a.defaultReferencePrice != null && scrapP > 0 ?
          Math.abs(a.defaultReferencePrice - scrapP)
        : 999999999
      const db =
        b.defaultReferencePrice != null && scrapP > 0 ?
          Math.abs(b.defaultReferencePrice - scrapP)
        : 999999999
      if (da !== db) return da - db
      return b.matchScore - a.matchScore
    })

    return { ok: true, candidates: filtered.slice(0, 24) }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

/**
 * Candidatos para combo: RPC por nombre/precio/categoría, luego filtro marca y precio ±band.
 */
export async function fetchScrappingSimilarityManualCandidates(
  admin: SupabaseClient,
  row: ScrappingRowForSimilarity,
): Promise<{ ok: true; candidates: ScrappingSimilarityManualCandidate[] } | { ok: false; error: string }> {
  try {
    const hints = [row.sections?.trim(), row.categories?.trim()].filter(Boolean).join(' · ')
    const title = row.product_name?.trim() || ''
    const searchTitle = hints ? `${title} ${hints}`.trim() : title
    const priceNum = typeof row.price === 'string' ? Number(row.price) : row.price
    const scrapPrice = Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null
    const band = similarityPriceBandClp()

    const catalogCategoryId = await resolveCatalogCategoryIdForScrappingRow(admin, {
      retailer: row.retailer,
      sections: row.sections,
      categories: row.categories,
    })

    const { data: candRaw, error: cErr } = await admin.rpc('catalog_retail_match_candidates', {
      p_search_title: searchTitle,
      p_price: scrapPrice,
      p_category_id: catalogCategoryId,
      p_limit: 40,
    } as never)
    if (cErr) {
      return { ok: false, error: getUserFriendlyErrorMessage(cErr, 'generic') }
    }

    const enriched = enrichRetailCandidatesCompositeScore(
      matchCandidatesFromRpc(candRaw),
      title,
      scrapPrice,
    )

    const ids = [...new Set(enriched.map((c) => c.catalog_product_id))]
    if (ids.length === 0) return { ok: true, candidates: [] }

    const { data: masters, error: mErr } = await admin
      .from('catalog_products')
      .select('id, name, brand, default_reference_price, category_id')
      .in('id', ids)
      .eq('active', true)

    if (mErr) {
      return { ok: false, error: getUserFriendlyErrorMessage(mErr, 'generic') }
    }

    const byId = new Map(
      (masters ?? []).map((m) => [
        String((m as { id: string }).id),
        m as {
          id: string
          name: string
          brand: string | null
          default_reference_price: number | null
          category_id: string | null
        },
      ]),
    )

    let filtered: ScrappingSimilarityManualCandidate[] = []
    for (const c of enriched) {
      const m = byId.get(c.catalog_product_id)
      if (!m) continue
      if (!scrapBrandMatchesCatalog(row.brand, m.brand, m.name)) continue
      if (!withinPriceBandClp(scrapPrice, m.default_reference_price, band)) continue
      filtered.push({
        catalogProductId: c.catalog_product_id,
        label: labelForMaster(m.name, m.brand, m.default_reference_price),
        defaultReferencePrice: m.default_reference_price,
        matchScore: Number(c.match_score ?? 0),
        categoryId: m.category_id ? String(m.category_id) : null,
      })
    }

    filtered = applyCategoryContextToScores(filtered, catalogCategoryId)
    filtered = await boostCandidatesByRetailerLinkHistory(admin, row.retailer, filtered)

    const scrapP = scrapPrice ?? 0
    filtered.sort((a, b) => {
      const da =
        a.defaultReferencePrice != null && scrapP > 0 ?
          Math.abs(a.defaultReferencePrice - scrapP)
        : 999999999
      const db =
        b.defaultReferencePrice != null && scrapP > 0 ?
          Math.abs(b.defaultReferencePrice - scrapP)
        : 999999999
      if (da !== db) return da - db
      return b.matchScore - a.matchScore
    })

    return { ok: true, candidates: filtered.slice(0, 24) }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

async function upsertRetailLinkAndAlias(
  admin: SupabaseClient,
  input: {
    retailer: string
    external_ref: string
    catalog_product_id: string
    listingTitle?: string
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error: linkError } = await admin.from('catalog_retail_links').upsert(
    {
      retailer: input.retailer,
      external_ref: input.external_ref,
      catalog_product_id: input.catalog_product_id,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: 'retailer,external_ref' },
  )

  if (linkError) {
    return { ok: false, error: getUserFriendlyErrorMessage(linkError, 'generic') }
  }

  if (input.listingTitle?.trim()) {
    const normalized = normalizeCatalogAlias(input.listingTitle)
    if (normalized.length >= 2) {
      const ins = await admin.from('catalog_product_aliases').insert({
        catalog_product_id: input.catalog_product_id,
        alias_normalized: normalized,
      } as never)
      if (ins.error && !isUniqueViolation(ins.error)) {
        return { ok: false, error: getUserFriendlyErrorMessage(ins.error, 'generic') }
      }
    }
  }

  return { ok: true }
}

async function bumpMasterReferencePriceIfHigher(
  admin: SupabaseClient,
  catalogProductId: string,
  capturedPrice: number,
): Promise<void> {
  if (!Number.isFinite(capturedPrice) || capturedPrice <= 0) return
  const { data: row, error } = await admin
    .from('catalog_products')
    .select('default_reference_price')
    .eq('id', catalogProductId)
    .maybeSingle()
  if (error || !row) return
  const current = Number((row as { default_reference_price?: unknown }).default_reference_price ?? 0)
  const base = Number.isFinite(current) && current > 0 ? current : 0
  const next = Math.max(capturedPrice, base)
  if (!(next > 0) || next === base) return
  await admin
    .from('catalog_products')
    .update({ default_reference_price: next, updated_at: new Date().toISOString() } as never)
    .eq('id', catalogProductId)
}

export type ConfirmScrappingSimilarityLinkOptions = {
  /** Paso 2 bulk: candidatos ya validados en la misma pasada (evita 2.ª RPC). */
  skipCandidateRevalidation?: boolean
}

export type PersistedScrappingIaHint = {
  ai_hint: string
  candidate_suggested: string | null
  ai_score: number | null
  reason: string
  stored_at: string
  /** Motor base (composite/RPC enriquecido) antes de IA */
  base_best_catalog_product_id?: string | null
  base_best_score?: number | null
  base_second_score?: number | null
  base_gap?: number | null
  /** La IA considera el mismo producto físico (presentación / volumen / variante). */
  same_product?: boolean | null
  /** IA marcó que no es el mismo ítem pese a score base alto */
  ia_rejected_pair?: boolean
  /** ambiguous_review | autolink_validation */
  ia_context?: string | null
}

/** Persiste sugerencia IA (no vincula). Requiere columna similarity_ia_hint en scrapping (migración). */
export async function persistScrappingSimilarityIaHint(
  admin: SupabaseClient,
  scrappingId: string,
  payload: Omit<PersistedScrappingIaHint, 'stored_at'> & { stored_at?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const stored_at = payload.stored_at ?? new Date().toISOString()
  const blob: PersistedScrappingIaHint = {
    ai_hint: payload.ai_hint.slice(0, 2000),
    candidate_suggested: payload.candidate_suggested,
    ai_score:
      payload.ai_score != null && Number.isFinite(payload.ai_score) ? payload.ai_score
      : null,
    reason: payload.reason.slice(0, 500),
    stored_at,
    base_best_catalog_product_id: payload.base_best_catalog_product_id ?? null,
    base_best_score:
      payload.base_best_score != null && Number.isFinite(payload.base_best_score) ?
        payload.base_best_score
      : null,
    base_second_score:
      payload.base_second_score != null && Number.isFinite(payload.base_second_score) ?
        payload.base_second_score
      : null,
    base_gap: payload.base_gap != null && Number.isFinite(payload.base_gap) ? payload.base_gap : null,
    same_product:
      payload.same_product === true ? true
      : payload.same_product === false ? false
      : null,
    ia_rejected_pair: payload.ia_rejected_pair === true,
    ia_context: payload.ia_context?.trim().slice(0, 48) || null,
  }

  const { error } = await admin
    .from('scrapping')
    .update({
      similarity_ia_hint: blob as unknown as Record<string, unknown>,
    } as never)
    .eq('id', scrappingId)
    .eq('catalog_match_status', 'pending')

  if (error) return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  return { ok: true }
}

export async function confirmManualScrappingSimilarityLink(
  admin: SupabaseClient,
  scrappingId: string,
  catalogProductId: string,
  options?: ConfirmScrappingSimilarityLinkOptions,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: row, error: rErr } = await admin
    .from('scrapping')
    .select('id, retailer, external_ref, product_name, brand, price, sections, categories, catalog_match_status')
    .eq('id', scrappingId)
    .maybeSingle()

  if (rErr || !row) {
    return { ok: false, error: 'No se encontró la fila de scrapping.' }
  }
  const st = (row as { catalog_match_status?: string }).catalog_match_status
  if (st !== 'pending') {
    return { ok: false, error: 'Esa fila ya no está pendiente de similitud.' }
  }

  const r = row as ScrappingRowForSimilarity
  const priceNum = typeof r.price === 'string' ? Number(r.price) : r.price
  const scrapPrice = Number.isFinite(priceNum) ? priceNum : null

  if (!options?.skipCandidateRevalidation) {
    const cand = await fetchScrappingSimilarityManualCandidates(admin, r as ScrappingRowForSimilarity)
    if (!cand.ok) return { ok: false, error: cand.error }
    const allowed = new Set(cand.candidates.map((c) => c.catalogProductId))
    if (!allowed.has(catalogProductId)) {
      return {
        ok: false,
        error: 'El maestro elegido no está entre los candidatos válidos para esta fila. Volvé a cargar la lista.',
      }
    }
  }

  const linkTry = await upsertRetailLinkAndAlias(admin, {
    retailer: r.retailer,
    external_ref: r.external_ref,
    catalog_product_id: catalogProductId,
    listingTitle: r.product_name,
  })
  if (!linkTry.ok) return { ok: false, error: linkTry.error }

  if (scrapPrice != null && scrapPrice > 0) {
    await bumpMasterReferencePriceIfHigher(admin, catalogProductId, scrapPrice)
  }

  const { error: dErr } = await admin.from('scrapping').delete().eq('id', scrappingId)
  if (dErr) {
    return { ok: false, error: getUserFriendlyErrorMessage(dErr, 'generic') }
  }

  return { ok: true }
}

export async function markScrappingRowPendingNew(
  admin: SupabaseClient,
  scrappingId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: before, error: qErr } = await admin
    .from('scrapping')
    .select('id, catalog_match_status')
    .eq('id', scrappingId)
    .maybeSingle()
  if (qErr || !before) {
    return { ok: false, error: 'No se encontró la fila de scrapping.' }
  }
  if ((before as { catalog_match_status: string }).catalog_match_status !== 'pending') {
    return { ok: false, error: 'Esa fila ya no está pendiente de similitud.' }
  }

  const { error } = await admin
    .from('scrapping')
    .update({
      catalog_match_status: 'pending_new',
      matched_catalog_product_id: null,
      catalog_matched_at: null,
      similarity_ia_hint: null,
      homolog_final_status: 'PENDING_NEW',
      homolog_user_decision: null,
      homolog_reviewed_at: null,
    } as never)
    .eq('id', scrappingId)
    .eq('catalog_match_status', 'pending')

  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  }

  return { ok: true }
}
