import { matchesSearch } from '@/lib/search'
import type { TaxonomyCategory } from '@/types/taxonomy'

/**
 * Asigna sección/categoría del catálogo global a partir del texto sugerido por la IA.
 * Si no hay coincidencia, usa la primera categoría por sort_order.
 */
export function pickCatalogTaxonomyFromGuess(
  categoryGuess: string | null | undefined,
  categories: TaxonomyCategory[]
): { sectionId: string; categoryId: string } | null {
  if (categories.length === 0) return null

  const sorted = [...categories].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  )

  const g = categoryGuess?.trim()
  if (g) {
    for (const c of sorted) {
      if (matchesSearch(c.name, g)) {
        return { sectionId: c.section_id, categoryId: c.id }
      }
    }
  }

  const first = sorted[0]
  if (!first) return null
  return { sectionId: first.section_id, categoryId: first.id }
}
