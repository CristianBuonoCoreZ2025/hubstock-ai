const DIACRITIC_MARK = /\p{M}/gu
const NON_SEARCH_CHAR = /[^\p{L}\p{N}\s]/gu
const MULTI_SPACE = /\s+/g
const REPEATED_LETTERS = /(\p{L})\1+/gu

function collapseRepeatedLetters(value: string): string {
  return value.replace(REPEATED_LETTERS, '$1')
}

/**
 * Normaliza texto para búsqueda base:
 * - minúsculas
 * - sin acentos
 * - sin signos
 * - espacios colapsados
 */
export function normalizeSearchText(input: string | null | undefined): string {
  if (!input) return ''

  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITIC_MARK, '')
    .replace(NON_SEARCH_CHAR, '')
    .replace(MULTI_SPACE, ' ')
    .trim()
}

/**
 * Normaliza texto en modo tolerante:
 * - aplica normalizeSearchText
 * - reduce letras repetidas
 *
 * Ejemplo:
 * hellmanns -> helmans
 * hellmans -> helmans
 * helmans -> helmans
 */
export function normalizeSearchLoose(input: string | null | undefined): string {
  const normalized = normalizeSearchText(input)

  if (!normalized) return ''

  return normalized
    .split(' ')
    .map(collapseRepeatedLetters)
    .join(' ')
    .replace(MULTI_SPACE, ' ')
    .trim()
}

/**
 * Términos normales para búsqueda multi palabra.
 */
export function searchTermsFromQuery(query: string | null | undefined): string[] {
  const normalized = normalizeSearchText(query)

  if (!normalized) return []

  return normalized.split(' ').filter(Boolean)
}

/**
 * Términos tolerantes para búsqueda multi palabra.
 */
export function looseSearchTermsFromQuery(query: string | null | undefined): string[] {
  const normalized = normalizeSearchLoose(query)

  if (!normalized) return []

  return normalized.split(' ').filter(Boolean)
}

function buildSearchText(texts: string | string[] | null | undefined): string {
  if (!texts) return ''

  if (Array.isArray(texts)) {
    return texts
      .filter(Boolean)
      .map((text) => normalizeSearchText(text))
      .join(' ')
      .replace(MULTI_SPACE, ' ')
      .trim()
  }

  return normalizeSearchText(texts)
}

function buildLooseSearchText(texts: string | string[] | null | undefined): string {
  if (!texts) return ''

  if (Array.isArray(texts)) {
    return texts
      .filter(Boolean)
      .map((text) => normalizeSearchLoose(text))
      .join(' ')
      .replace(MULTI_SPACE, ' ')
      .trim()
  }

  return normalizeSearchLoose(texts)
}

/**
 * Evalúa si un texto cumple una búsqueda.
 *
 * Cumple:
 * - mayo encuentra Mayonesa
 * - mayó encuentra Mayonesa
 * - hellmanns encuentra Hellmann's
 * - hellmans encuentra Hellmann's
 * - helmans encuentra Hellmann's
 * - hell mayo encuentra Mayonesa Hellmann's
 */
export function matchesSearch(
  texts: string | string[] | null | undefined,
  query: string | null | undefined
): boolean {
  const terms = searchTermsFromQuery(query)
  const looseTerms = looseSearchTermsFromQuery(query)

  if (terms.length === 0 && looseTerms.length === 0) return true

  const haystack = buildSearchText(texts)
  const looseHaystack = buildLooseSearchText(texts)

  return terms.every((term, index) => {
    const looseTerm = looseTerms[index] ?? collapseRepeatedLetters(term)

    return haystack.includes(term) || looseHaystack.includes(looseTerm)
  })
}

/**
 * Filtra una lista usando una función que arma el texto buscable.
 */
export function filterBySearch<T>(
  items: T[],
  query: string | null | undefined,
  selector: (item: T) => string | string[] | null | undefined
): T[] {
  const terms = searchTermsFromQuery(query)

  if (terms.length === 0) return items

  return items.filter((item) => matchesSearch(selector(item), query))
}

export type CatalogProductRankInput = {
  productName: string
  brandCanonical: string | null
  brandText: string | null
  categoryName: string | null
  sectionName: string | null
  presentation: string | null
  aliasTexts: string[]
}

/**
 * Puntuación de relevancia para ordenar resultados de catálogo (menor = más relevante).
 * Orden conceptual: nombre producto → marca → categoría → sección → presentación → alias.
 */
export function rankCatalogProductRelevance(
  query: string | null | undefined,
  ctx: CatalogProductRankInput
): number {
  const q = normalizeSearchText(query)
  if (!q) return 0

  const pn = normalizeSearchText(ctx.productName)
  const terms = searchTermsFromQuery(query)
  const looseTerms = looseSearchTermsFromQuery(query)

  if (pn === q) return 0
  if (pn.startsWith(q)) return 2

  if (matchesSearch(ctx.productName, query)) return 5

  if (terms.length > 0 && terms.every((t, i) => pn.includes(t) || pn.includes(looseTerms[i] ?? collapseRepeatedLetters(t)))) {
    return 8
  }

  if (pn.includes(q)) return 12

  const brandHay = [ctx.brandCanonical, ctx.brandText].filter(Boolean) as string[]
  if (brandHay.length && matchesSearch(brandHay, query)) return 40

  if (ctx.categoryName && matchesSearch(ctx.categoryName, query)) return 55

  if (ctx.sectionName && matchesSearch(ctx.sectionName, query)) return 70

  if (ctx.presentation && matchesSearch(ctx.presentation, query)) return 85

  if (ctx.aliasTexts.some((a) => matchesSearch(a, query))) return 95

  return 200
}