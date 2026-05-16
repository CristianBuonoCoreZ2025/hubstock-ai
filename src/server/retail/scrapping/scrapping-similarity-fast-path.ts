/**
 * Etapa B: atajos antes de RPC catalog_retail_match_candidates (vínculo existente, alias exacto).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeCatalogAlias } from '@/lib/catalog-alias'
import { brandHintInName } from '@/lib/retail-association'
import { normalizeSearchText } from '@/lib/search'
import { confirmManualScrappingSimilarityLink } from '@/server/retail/scrapping/scrapping-similarity-manual'

export type SimilarityRowResolveOutcome =
  | { outcome: 'auto_linked' }
  | { outcome: 'auto_pending_new' }
  | {
      outcome: 'needs_review'
      iaHintApplied?: boolean
      iaHint?: string | null
      candidateSuggested?: string | null
      aiScore?: number | null
      aiReason?: string | null
      sameProduct?: boolean | null
      /** La IA vetó un autovínculo que el motor base había aprobado */
      iaBlockedAutolink?: boolean
    }
  | { outcome: 'error' }

export type ScrappingRowForSimilarityFastPath = {
  id: string
  retailer: string
  external_ref: string
  product_name: string
  brand: string | null
  price: number | string
}

function scrapPrice(row: ScrappingRowForSimilarityFastPath): number | null {
  const priceNum = typeof row.price === 'string' ? Number(row.price) : row.price
  return Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null
}

function similarityPriceBandClp(): number {
  const raw = process.env.SCRAPPING_SIMILARITY_PRICE_BAND_CLP?.trim()
  const n = raw ? Number(raw) : 3000
  if (!Number.isFinite(n) || n < 0) return 3000
  return Math.min(Math.floor(n), 500_000)
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
  scrap: number | null,
  refPrice: number | null,
  band: number,
): boolean {
  if (scrap == null || !Number.isFinite(scrap) || scrap <= 0) return true
  if (refPrice == null || !Number.isFinite(refPrice) || refPrice <= 0) return false
  return Math.abs(refPrice - scrap) <= band
}

/** Ya homologado en catálogo: solo quitar fila de scrapping. */
export async function tryResolveScrappingByExistingRetailLink(
  admin: SupabaseClient,
  row: ScrappingRowForSimilarityFastPath,
): Promise<SimilarityRowResolveOutcome | null> {
  const ref = String(row.external_ref ?? '').trim()
  if (!ref) return null

  const { data: link, error } = await admin
    .from('catalog_retail_links')
    .select('catalog_product_id')
    .eq('retailer', row.retailer)
    .eq('external_ref', ref)
    .maybeSingle()

  if (error || !link) return null

  const { error: dErr } = await admin.from('scrapping').delete().eq('id', row.id)
  if (dErr) return { outcome: 'error' }
  return { outcome: 'auto_linked' }
}

type MasterRow = {
  id: string
  name: string
  brand: string | null
  default_reference_price: number | null
}

async function loadActiveMastersByIds(
  admin: SupabaseClient,
  ids: string[],
): Promise<MasterRow[]> {
  if (ids.length === 0) return []
  const { data, error } = await admin
    .from('catalog_products')
    .select('id, name, brand, default_reference_price')
    .in('id', ids)
    .eq('active', true)
  if (error) return []
  return (data ?? []) as MasterRow[]
}

function filterMastersForScrappingRow(
  row: ScrappingRowForSimilarityFastPath,
  masters: MasterRow[],
): MasterRow[] {
  const band = similarityPriceBandClp()
  const scrap = scrapPrice(row)
  return masters.filter((m) => {
    if (!scrapBrandMatchesCatalog(row.brand, m.brand, m.name)) return false
    return withinPriceBandClp(scrap, m.default_reference_price, band)
  })
}

/** Alias normalizado del título de tienda = alias_normalized en catálogo. */
export async function tryResolveScrappingByCatalogAlias(
  admin: SupabaseClient,
  row: ScrappingRowForSimilarityFastPath,
): Promise<SimilarityRowResolveOutcome | null> {
  const norm = normalizeCatalogAlias(row.product_name ?? '')
  if (norm.length < 2) return null

  const { data: aliasRows, error } = await admin
    .from('catalog_product_aliases')
    .select('catalog_product_id')
    .eq('alias_normalized', norm)
    .limit(24)

  if (error || !aliasRows?.length) return null

  const ids = [...new Set(aliasRows.map((a) => String((a as { catalog_product_id: string }).catalog_product_id)))]
  const masters = filterMastersForScrappingRow(row, await loadActiveMastersByIds(admin, ids))
  if (masters.length !== 1) return null

  const link = await confirmManualScrappingSimilarityLink(admin, row.id, masters[0]!.id, {
    skipCandidateRevalidation: true,
  })
  return link.ok ? { outcome: 'auto_linked' } : { outcome: 'error' }
}

/** Atajos en orden: vínculo retail → alias exacto. */
export async function tryScrappingSimilarityFastPaths(
  admin: SupabaseClient,
  row: ScrappingRowForSimilarityFastPath,
): Promise<SimilarityRowResolveOutcome | null> {
  const byLink = await tryResolveScrappingByExistingRetailLink(admin, row)
  if (byLink) return byLink

  return tryResolveScrappingByCatalogAlias(admin, row)
}
