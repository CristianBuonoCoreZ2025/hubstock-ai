/**
 * Etapa C: resuelve category_id del catálogo desde sección/categoría retail (retail_taxonomy_mappings).
 * - Lider: usa tabla retail_taxonomy_lider_sections + retail_taxonomy_mappings (mapeo explícito linked).
 * - VTEX (Jumbo, Central Mayorista): fallback fuzzy sobre nombres de categories del catálogo.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  normalizeLiderCategoryKeyStrong,
  normalizeLiderSectionKeyStrong,
} from '@/lib/lider-taxonomy-section-heuristics'

const taxonomyCache = new Map<string, string | null>()

export function clearScrappingTaxonomyCache(): void {
  taxonomyCache.clear()
}

function cacheKey(retailer: string, sections: string | null, categories: string | null): string {
  return `${retailer}|${normalizeLiderSectionKeyStrong(sections ?? '')}|${normalizeLiderCategoryKeyStrong(categories ?? '')}`
}

/**
 * Fallback fuzzy para retailers sin mapeo explícito (VTEX):
 * busca la categoría del catálogo cuyo nombre normalizado coincide con el hint de categoría o sección.
 */
async function resolveCategoryByFuzzyName(
  admin: SupabaseClient,
  categoryHint: string | null,
  sectionHint: string | null,
): Promise<string | null> {
  const { data: allCats } = await admin
    .from('categories')
    .select('id, name, section_id')
    .order('sort_order', { ascending: true })

  if (!allCats || allCats.length === 0) return null

  type CatRow = { id: string; name: string; section_id: string }
  const cats = allCats as CatRow[]

  const normalize = normalizeLiderCategoryKeyStrong

  const catNorm = normalize(categoryHint ?? '')
  const secNorm = normalize(sectionHint ?? '')

  if (catNorm) {
    const exact = cats.find((c) => normalize(c.name) === catNorm)
    if (exact) return exact.id
    const partial = cats.find((c) => normalize(c.name).includes(catNorm) || catNorm.includes(normalize(c.name)))
    if (partial) return partial.id
  }

  if (secNorm) {
    const bySection = cats.find((c) => normalize(c.name) === secNorm)
    if (bySection) return bySection.id
  }

  return null
}

/** Mapeo retail → category_id maestro. Lider usa tabla explícita; VTEX usa fuzzy por nombre. */
export async function resolveCatalogCategoryIdForScrappingRow(
  admin: SupabaseClient,
  input: {
    retailer: string
    sections: string | null
    categories: string | null
  },
): Promise<string | null> {
  const retailer = input.retailer?.trim().toLowerCase()

  const key = cacheKey(retailer, input.sections, input.categories)
  if (taxonomyCache.has(key)) return taxonomyCache.get(key) ?? null

  if (retailer !== 'lider') {
    const result = await resolveCategoryByFuzzyName(admin, input.categories, input.sections)
    taxonomyCache.set(key, result)
    return result
  }

  const ns = normalizeLiderSectionKeyStrong(input.sections ?? '')
  const nc = normalizeLiderCategoryKeyStrong(input.categories ?? '')
  if (!ns || !nc) {
    taxonomyCache.set(key, null)
    return null
  }

  const { data: liderSec, error: e1 } = await admin
    .from('retail_taxonomy_lider_sections')
    .select('id, section_id')
    .eq('retailer', 'lider')
    .eq('normalized_external_section', ns)
    .eq('status', 'linked')
    .maybeSingle()

  if (e1 || !liderSec) {
    taxonomyCache.set(key, null)
    return null
  }

  const ls = liderSec as { id: string; section_id: string | null }
  if (!ls.section_id) {
    taxonomyCache.set(key, null)
    return null
  }

  const { data: map, error: e2 } = await admin
    .from('retail_taxonomy_mappings')
    .select('category_id, section_id')
    .eq('retailer', 'lider')
    .eq('lider_section_id', ls.id)
    .eq('normalized_external_category', nc)
    .eq('status', 'linked')
    .maybeSingle()

  if (e2 || !map) {
    taxonomyCache.set(key, null)
    return null
  }

  const row = map as { category_id: string | null; section_id: string | null }
  const categoryId =
    row.category_id && row.section_id === ls.section_id ? String(row.category_id) : null
  taxonomyCache.set(key, categoryId)
  return categoryId
}
