/**
 * Etapa C: resuelve category_id del catálogo desde sección/categoría Lider (retail_taxonomy_mappings).
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

/** Mapeo Lider linked: sección + categoría externas → category_id maestro. */
export async function resolveCatalogCategoryIdForScrappingRow(
  admin: SupabaseClient,
  input: {
    retailer: string
    sections: string | null
    categories: string | null
  },
): Promise<string | null> {
  const retailer = input.retailer?.trim().toLowerCase()
  if (retailer !== 'lider') return null

  const ns = normalizeLiderSectionKeyStrong(input.sections ?? '')
  const nc = normalizeLiderCategoryKeyStrong(input.categories ?? '')
  if (!ns || !nc) return null

  const key = cacheKey(retailer, input.sections, input.categories)
  if (taxonomyCache.has(key)) return taxonomyCache.get(key) ?? null

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
