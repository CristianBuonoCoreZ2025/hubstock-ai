/**
 * Extracción de segmentos de ruta desde listing_url según configuración por retail.
 * Convención: segmentos = pathname.split('/').filter(Boolean) (0-based).
 * Ej. Lider https://super.lider.cl/browse/marcas-propias/limpieza-hogar/69507955_15116335
 * → ['browse','marcas-propias','limpieza-hogar','69507955_15116335'] → section índice 1, category índice 2.
 */

export type RetailListingPathSegmentIndices = {
  section: number
  category: number
}

export type RetailListingPathConfig = {
  listingPathSegmentIndices?: RetailListingPathSegmentIndices | null
}

function parseIndices(raw: unknown): RetailListingPathSegmentIndices | null {
  if (!raw || typeof raw !== 'object') return null
  const root = raw as Record<string, unknown>
  const inner = root.listingPathSegmentIndices
  if (!inner || typeof inner !== 'object') return null
  const o = inner as Record<string, unknown>
  const section = o.section
  const category = o.category
  if (typeof section !== 'number' || typeof category !== 'number') return null
  if (!Number.isInteger(section) || !Number.isInteger(category)) return null
  if (section < 0 || category < 0) return null
  return { section, category }
}

export function deriveSectionCategoryFromListingUrl(
  listingUrl: string,
  config: RetailListingPathConfig | null | undefined,
): { sections: string | null; categories: string | null } {
  const indices = parseIndices(config)
  if (!indices) {
    return { sections: null, categories: null }
  }
  try {
    const u = new URL(listingUrl.trim())
    const parts = u.pathname.split('/').filter((p) => p.length > 0)
    const sec = parts[indices.section] ?? null
    const cat = parts[indices.category] ?? null
    return {
      sections: sec ?? null,
      categories: cat ?? null,
    }
  } catch {
    return { sections: null, categories: null }
  }
}
