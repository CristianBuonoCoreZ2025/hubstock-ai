/**
 * Plan de captura VTEX para Jumbo y Central Mayorista.
 * Genera URLs de listado usando los endpoints de búsqueda de VTEX.
 * Mucho más simple que Lider porque VTEX expone APIs estructuradas.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveVtexBaseUrlForRetailer } from '@/server/retail-capture/fetch-vtex-search'
import { retailerDefinition, type RetailerCode } from '@/server/retail-capture/retailer-registry'

export type VtexPageSeed = {
  page_url: string
  page_index: number
  /** Tipo de endpoint para estrategia de parseo */
  endpoint_type: 'intelligent_search' | 'catalog_system' | 'shelf_html'
  /** Query de búsqueda o categoría */
  query?: string
}

const DEFAULT_VTEX_PAGE_SIZE = 20

/** Letras/vocales para barrido inicial de VTEX (términos de alta frecuencia) */
const VTEX_SWEEP_QUERIES = [
  'a', 'e', 'i', 'o', 'u', // vocales = muchos resultados
  'la', 'el', 'de', 'con', // palabras comunes
  '1', '2', '3', // números comunes en packaging
]

/**
 * Genera URLs de búsqueda VTEX Intelligent Search.
 * Jumbo: /_v/api/intelligent-search/product_search
 * Central Mayorista: usa el mismo patrón VTEX
 */
function buildVtexIntelligentSearchUrls(
  baseUrl: string,
  queries: string[],
  pagesPerQuery: number,
  pageSize: number,
): VtexPageSeed[] {
  const base = baseUrl.replace(/\/+$/, '')
  const seeds: VtexPageSeed[] = []
  let index = 0

  for (const q of queries) {
    for (let page = 1; page <= pagesPerQuery; page++) {
      const params = new URLSearchParams({
        count: String(pageSize),
        page: String(page),
        query: q,
        fuzzy: 'auto',
      })
      // Endpoint directo (sin /api/io/ que a veces está protegido)
      const url = `${base}/_v/api/intelligent-search/product_search?${params.toString()}`
      seeds.push({
        page_url: url,
        page_index: index++,
        endpoint_type: 'intelligent_search',
        query: q,
      })
    }
  }
  return seeds
}

/**
 * Genera URLs de catálogo VTEX Legacy (catalog_system).
 * Fallback si intelligent-search no responde.
 */
function buildVtexCatalogSystemUrls(
  baseUrl: string,
  queries: string[],
  itemsPerQuery: number,
): VtexPageSeed[] {
  const base = baseUrl.replace(/\/+$/, '')
  const seeds: VtexPageSeed[] = []
  let index = 0

  for (const q of queries) {
    const from = 0
    const to = Math.min(itemsPerQuery - 1, 49) // VTEX suele limitar a 50
    const url = `${base}/api/catalog_system/pub/products/search?_from=${from}&_to=${to}&ft=${encodeURIComponent(q)}`
    seeds.push({
      page_url: url,
      page_index: index++,
      endpoint_type: 'catalog_system',
      query: q,
    })
  }
  return seeds
}

/**
 * Genera URLs de listado HTML tipo /busca (fallback visual).
 */
function buildVtexHtmlShelfUrls(
  baseUrl: string,
  queries: string[],
  pagesPerQuery: number,
): VtexPageSeed[] {
  const base = baseUrl.replace(/\/+$/, '')
  const seeds: VtexPageSeed[] = []
  let index = 0

  for (const q of queries) {
    for (let page = 1; page <= pagesPerQuery; page++) {
      const ft = encodeURIComponent(q)
      const pn = Math.max(1, page)
      // Jumbo usa /busqueda con PageNumber
      const url = `${base}/busqueda?ft=${ft}&PageNumber=${pn}`
      seeds.push({
        page_url: url,
        page_index: index++,
        endpoint_type: 'shelf_html',
        query: q,
      })
    }
  }
  return seeds
}

/**
 * Descubre URLs iniciales para un retail VTEX (Phase 1).
 * Usa queries de barrido genéricas para obtener un muestreo representativo.
 */
export async function discoverVtexScrappingUrlsPhase1(
  retailer: RetailerCode,
  options?: {
    /** Queries personalizadas (default: vocales/palabras comunes) */
    queries?: string[]
    /** Páginas por query (default: 5) */
    pagesPerQuery?: number
    /** Items por página (default: 20) */
    pageSize?: number
  },
): Promise<{ ok: true; seeds: VtexPageSeed[]; total: number } | { ok: false; error: string }> {
  const def = retailerDefinition(retailer)
  if (!def) {
    return { ok: false, error: `Retail no registrado: ${retailer}` }
  }

  const baseUrl = resolveVtexBaseUrlForRetailer(retailer)
  if (!baseUrl) {
    return { ok: false, error: `No hay URL base configurada para ${retailer}. Configura ${def.vtexBaseUrlEnvVar}.` }
  }

  const queries = options?.queries ?? VTEX_SWEEP_QUERIES
  const pagesPerQuery = Math.min(Math.max(options?.pagesPerQuery ?? 5, 1), 20)
  const pageSize = Math.min(Math.max(options?.pageSize ?? DEFAULT_VTEX_PAGE_SIZE, 10), 50)

  // Prioridad: intelligent_search → catalog_system → shelf_html
  const seeds: VtexPageSeed[] = [
    ...buildVtexIntelligentSearchUrls(baseUrl, queries, pagesPerQuery, pageSize),
    ...buildVtexCatalogSystemUrls(baseUrl, queries, pagesPerQuery * pageSize),
    ...buildVtexHtmlShelfUrls(baseUrl, queries, Math.min(pagesPerQuery, 3)),
  ]

  // Deduplicar por URL
  const seen = new Set<string>()
  const unique = seeds.filter((s) => {
    if (seen.has(s.page_url)) return false
    seen.add(s.page_url)
    return true
  })

  return { ok: true, seeds: unique, total: unique.length }
}

/**
 * Calcula la siguiente página de un listado VTEX (para paginación dinámica).
 */
export function nextVtexIntelligentSearchPageUrl(
  currentUrl: string,
  currentProductsCount: number,
): string | null {
  try {
    const url = new URL(currentUrl)
    const page = parseInt(url.searchParams.get('page') ?? '1', 10)
    const count = parseInt(url.searchParams.get('count') ?? '20', 10)

    // Si la página actual devolvió menos productos que el page size,
    // probablemente es la última página
    if (currentProductsCount < count * 0.8) {
      return null
    }

    url.searchParams.set('page', String(page + 1))
    return url.toString()
  } catch {
    return null
  }
}

/**
 * Determina si una URL es de intelligent-search (para estrategia de parseo).
 */
export function isVtexIntelligentSearchUrl(url: string): boolean {
  return url.includes('/intelligent-search/')
}

/**
 * Determina si una URL es de catalog_system legacy.
 */
export function isVtexCatalogSystemUrl(url: string): boolean {
  return url.includes('/catalog_system/')
}

/**
 * Determina si una URL es de shelf HTML (/busca, /busqueda).
 */
export function isVtexHtmlShelfUrl(url: string): boolean {
  const p = url.toLowerCase()
  return p.includes('/busca') || p.includes('/busqueda')
}
