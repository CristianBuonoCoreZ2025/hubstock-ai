/**
 * Búsqueda catálogo VTEX:
 * - Legacy: /api/catalog_system/pub/products/search
 * - Intelligent Search: /api/io/_v/api/intelligent-search/product_search
 *
 * Algunas tiendas bloquean uno de los dos caminos (404/410). Por eso se prueban
 * variantes y se memoriza la que funciona por host.
 *
 * Si las APIs no devuelven JSON, se intentan páginas legacy `/busqueda?ft=…` y `/busca?ft=…`
 * y se leen productos desde JSON-LD, `__NEXT_DATA__` (Lider) o `__REACT_QUERY_STATE__` (Jumbo).
 */

import {
  extractListedProductsFromRetailHtml,
  htmlListedProductToSyntheticVtex,
} from '@/server/retail-capture/extract-products-from-retail-html'
import { extractVtexProductArrayFromResponse } from '@/server/retail-capture/parse-json-products'

export type VtexFetchAttempt = {
  endpoint: string
  reason: 'not_json' | 'http_error' | 'network'
  status?: number
}

export type VtexFetchResult =
  | { ok: true; products: unknown[] }
  | {
      ok: false
      reason: 'not_json' | 'http_error' | 'network'
      status?: number
      attempts?: VtexFetchAttempt[]
    }

function trimBase(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Por host de tienda: catalog_system vs intelligent-search. */
const searchBackendByBase = new Map<string, 'catalog' | 'intelligent'>()

/** Endpoints (URL completa por host) que ya fallaron persistentemente; se evitan en próximas páginas. */
const deadEndpointsByBase = new Map<string, Map<string, { reason: 'not_json' | 'http_error'; status?: number }>>()

function recordDead(
  base: string,
  url: string,
  reason: 'not_json' | 'http_error',
  status?: number,
): void {
  let set = deadEndpointsByBase.get(base)
  if (!set) {
    set = new Map()
    deadEndpointsByBase.set(base, set)
  }
  set.set(url, { reason, status })
}

function isDead(base: string, url: string): { reason: 'not_json' | 'http_error'; status?: number } | undefined {
  return deadEndpointsByBase.get(base)?.get(url)
}

/** Tiempo máximo por intento individual (cada URL). */
export const VTEX_SEARCH_PER_ATTEMPT_TIMEOUT_MS = 8_000
const PER_REQUEST_TIMEOUT_MS = VTEX_SEARCH_PER_ATTEMPT_TIMEOUT_MS
/**
 * Tiempo total máximo del barrido por una página (corta el bucle de candidatos).
 * Default alto: lista de URLs API + HTML; antes 45s cortaba antes de /busca.
 * Override: RETAIL_VTEX_PAGE_BUDGET_MS (mínimo 15000).
 */
const envPageBudget = Number(process.env.RETAIL_VTEX_PAGE_BUDGET_MS)
export const VTEX_SEARCH_PAGE_BUDGET_MS =
  Number.isFinite(envPageBudget) && envPageBudget >= 15_000 ? envPageBudget : 90_000
const PER_PAGE_BUDGET_MS = VTEX_SEARCH_PAGE_BUDGET_MS

type RawFetch =
  | { ok: true; products: unknown[] }
  | {
      ok: false
      reason: 'not_json' | 'http_error' | 'network'
      status?: number
    }

/** Página de listado tienda: VTEX `/busca` o Cencosud `/busqueda` (HTML con shelf embebido). */
function isStorefrontLegacySearchUrl(fetchUrl: string): boolean {
  try {
    const p = new URL(fetchUrl).pathname.toLowerCase()
    return p.includes('/busca') || p.includes('/busqueda')
  } catch {
    return false
  }
}

/** HTML de listado puede tardar más que respuestas JSON pequeñas. */
function requestTimeoutMs(fetchUrl: string): number {
  if (!isStorefrontLegacySearchUrl(fetchUrl)) return PER_REQUEST_TIMEOUT_MS
  const envHtml = Number(process.env.RETAIL_VTEX_HTML_TIMEOUT_MS)
  if (Number.isFinite(envHtml) && envHtml >= 8_000) return envHtml
  return 16_000
}

async function doGet(url: string, parentSignal: AbortSignal): Promise<RawFetch> {
  const ctrl = new AbortController()
  const onParentAbort = () => ctrl.abort()
  parentSignal.addEventListener('abort', onParentAbort, { once: true })
  const t = setTimeout(() => ctrl.abort(), requestTimeoutMs(url))
  try {
    const acceptHeader = isStorefrontLegacySearchUrl(url)
      ? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      : 'application/json'

    const res = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      cache: 'no-store',
      headers: {
        Accept: acceptHeader,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })

    if (!res.ok) {
      return { ok: false, reason: 'http_error', status: res.status }
    }

    const text = (await res.text()).trim()
    if (text.startsWith('<')) {
      const fromHtml = extractListedProductsFromRetailHtml(text, url)
      if (fromHtml.length > 0) {
        const products = fromHtml.map((p) => htmlListedProductToSyntheticVtex(p))
        return { ok: true, products }
      }
      return { ok: false, reason: 'not_json' }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return { ok: false, reason: 'not_json' }
    }

    const products = extractVtexProductArrayFromResponse(parsed)
    if (products === null) {
      return { ok: false, reason: 'not_json' }
    }

    return { ok: true, products }
  } catch (e) {
    const name = e instanceof Error ? e.name : ''
    if (name === 'AbortError') return { ok: false, reason: 'network' }
    return { ok: false, reason: 'network' }
  } finally {
    clearTimeout(t)
    parentSignal.removeEventListener('abort', onParentAbort)
  }
}

function isIntelligentEndpoint(url: string): boolean {
  return url.includes('/intelligent-search/')
}

function catalogPathUrl(base: string, q: string, from: number, to: number): string {
  return `${base}/api/catalog_system/pub/products/search/${encodeURIComponent(
    q,
  )}?_from=${from}&_to=${to}`
}

function catalogFtUrl(base: string, q: string, from: number, to: number): string {
  return `${base}/api/catalog_system/pub/products/search?_from=${from}&_to=${to}&ft=${encodeURIComponent(
    q,
  )}`
}

function searchParamsForIntelligent(
  q: string,
  page: number,
  count: number,
  locale?: string,
): URLSearchParams {
  const params = new URLSearchParams({
    count: String(count),
    page: String(page),
    query: q,
    fuzzy: 'auto',
  })
  if (locale) params.set('locale', locale)
  return params
}

function intelligentFtApiIoUrl(
  base: string,
  q: string,
  page: number,
  count: number,
  locale?: string,
): string {
  const params = searchParamsForIntelligent(q, page, count, locale)
  return `${base}/api/io/_v/api/intelligent-search/product_search/ft/${encodeURIComponent(
    q,
  )}?${params.toString()}`
}

function intelligentFtDirectUrl(
  base: string,
  q: string,
  page: number,
  count: number,
  locale?: string,
): string {
  const params = searchParamsForIntelligent(q, page, count, locale)
  return `${base}/_v/api/intelligent-search/product_search/ft/${encodeURIComponent(
    q,
  )}?${params.toString()}`
}

function intelligentQueryApiIoUrl(
  base: string,
  q: string,
  page: number,
  count: number,
  locale?: string,
): string {
  const params = searchParamsForIntelligent(q, page, count, locale)
  return `${base}/api/io/_v/api/intelligent-search/product_search?${params.toString()}`
}

function intelligentQueryDirectUrl(
  base: string,
  q: string,
  page: number,
  count: number,
  locale?: string,
): string {
  const params = searchParamsForIntelligent(q, page, count, locale)
  return `${base}/_v/api/intelligent-search/product_search?${params.toString()}`
}

function intelligentFacetApiIoUrl(
  base: string,
  q: string,
  page: number,
  count: number,
  locale?: string,
): string {
  const params = searchParamsForIntelligent(q, page, count, locale)
  return `${base}/api/io/_v/api/intelligent-search/product_search/ft/${encodeURIComponent(
    q,
  )}/?${params.toString()}`
}

function intelligentFacetDirectUrl(
  base: string,
  q: string,
  page: number,
  count: number,
  locale?: string,
): string {
  const params = searchParamsForIntelligent(q, page, count, locale)
  return `${base}/_v/api/intelligent-search/product_search/ft/${encodeURIComponent(
    q,
  )}/?${params.toString()}`
}

function dedupe(urls: string[]): string[] {
  return [...new Set(urls)]
}

/** Listado público tipo VTEX Legacy; paginación habitual con PageNumber. */
function storefrontLegacySearchUrls(trimmedBase: string, q: string, pageOneBased: number): string[] {
  const b = trimBase(trimmedBase)
  const pn = Math.max(1, pageOneBased)
  const ft = encodeURIComponent(q)
  // Jumbo.cl usa `/busqueda?ft=` y SSR con `__REACT_QUERY_STATE__`; `/busca` suele devolver shell sin shelf.
  const withPn = [
    `${b}/busqueda?ft=${ft}&PageNumber=${pn}`,
    `${b}/busqueda/?ft=${ft}&PageNumber=${pn}`,
    `${b}/busca?ft=${ft}&PageNumber=${pn}`,
    `${b}/busca/?ft=${ft}&PageNumber=${pn}`,
  ]
  if (pn <= 1) {
    return dedupe([
      ...withPn,
      `${b}/busqueda?ft=${ft}`,
      `${b}/busqueda/?ft=${ft}`,
      `${b}/busca?ft=${ft}`,
      `${b}/busca/?ft=${ft}`,
    ])
  }
  return dedupe(withPn)
}

function localeCandidates(base: string): string[] {
  const explicit = process.env.RETAIL_VTEX_SEARCH_LOCALE?.trim()
  if (explicit) return [explicit]
  if (base.endsWith('.cl')) return ['es-CL', 'es']
  return ['pt-BR', 'en-US']
}

/** Intelligent Search sin parámetro locale (primer intento). */
function intelligentUrlsCore(
  base: string,
  q: string,
  pageOneBased: number,
  size: number,
): string[] {
  return [
    intelligentFtApiIoUrl(base, q, pageOneBased, size),
    intelligentFtDirectUrl(base, q, pageOneBased, size),
    intelligentQueryApiIoUrl(base, q, pageOneBased, size),
    intelligentQueryDirectUrl(base, q, pageOneBased, size),
    intelligentFacetApiIoUrl(base, q, pageOneBased, size),
    intelligentFacetDirectUrl(base, q, pageOneBased, size),
  ]
}

function intelligentUrlsWithLocales(
  base: string,
  q: string,
  pageOneBased: number,
  size: number,
  locales: string[],
): string[] {
  return locales.flatMap((locale) => [
    intelligentFtApiIoUrl(base, q, pageOneBased, size, locale),
    intelligentFtDirectUrl(base, q, pageOneBased, size, locale),
    intelligentQueryApiIoUrl(base, q, pageOneBased, size, locale),
    intelligentQueryDirectUrl(base, q, pageOneBased, size, locale),
    intelligentFacetApiIoUrl(base, q, pageOneBased, size, locale),
    intelligentFacetDirectUrl(base, q, pageOneBased, size, locale),
  ])
}

function candidateUrls(
  base: string,
  q: string,
  from: number,
  to: number,
  pageOneBased: number,
  size: number,
  preferred: 'catalog' | 'intelligent' | undefined,
): string[] {
  const catalog = [catalogPathUrl(base, q, from, to), catalogFtUrl(base, q, from, to)]
  const locales = localeCandidates(base)
  const intelligentCore = intelligentUrlsCore(base, q, pageOneBased, size)
  const intelligentLocale = intelligentUrlsWithLocales(base, q, pageOneBased, size, locales)
  const shelfHtml = storefrontLegacySearchUrls(base, q, pageOneBased)

  /*
   * Orden crítico: las tiendas Chile suelen tener 410/404 en masa en APIs públicas;
   * si /busca (HTML + JSON-LD) va al final, PER_PAGE_BUDGET_MS corta antes de intentarlo.
   * Caso habitual: [...catalog 2 urls, shelfHtml pocas urls, intelligent…].
   */
  if (preferred === 'intelligent') {
    return dedupe([...intelligentCore, ...intelligentLocale, ...catalog, ...shelfHtml])
  }
  if (preferred === 'catalog') {
    return dedupe([...catalog, ...shelfHtml, ...intelligentCore, ...intelligentLocale])
  }
  return dedupe([...catalog, ...shelfHtml, ...intelligentCore, ...intelligentLocale])
}

/**
 * Una página de resultados: prueba variantes de endpoint y memoriza la familia que funciona.
 */
export async function fetchVtexSearchProductsPage(
  baseUrl: string,
  query: string,
  fromIndex: number,
  pageSize: number,
): Promise<VtexFetchResult> {
  const base = trimBase(baseUrl)
  const q = query.trim()
  const size = Math.min(Math.max(pageSize, 1), 100)
  const from = Math.max(0, Math.floor(fromIndex))
  const to = from + size - 1
  const pageOneBased = Math.floor(from / size) + 1

  const controller = new AbortController()
  const pageBudgetTimer = setTimeout(() => controller.abort(), PER_PAGE_BUDGET_MS)

  try {
    const preferred = searchBackendByBase.get(base)
    const urlsAll = candidateUrls(base, q, from, to, pageOneBased, size, preferred)
    const urls = urlsAll.filter((u) => !isDead(base, u))
    const attempts: VtexFetchAttempt[] = []

    // Si todo el host está marcado como muerto y no quedan candidatos, devolver lo que sabemos.
    if (urls.length === 0) {
      const lastDead = Array.from(deadEndpointsByBase.get(base)?.values() ?? []).pop()
      return {
        ok: false,
        reason: lastDead?.reason ?? 'http_error',
        status: lastDead?.status,
        attempts: Array.from(deadEndpointsByBase.get(base)?.entries() ?? []).map(
          ([endpoint, info]) => ({
            endpoint,
            reason: info.reason,
            status: info.status,
          }),
        ),
      }
    }

    for (const url of urls) {
      if (controller.signal.aborted) {
        // Presupuesto de página agotado; devolver lo acumulado.
        return {
          ok: false,
          reason: 'network',
          attempts,
        }
      }
      const r = await doGet(url, controller.signal)
      if (r.ok) {
        const fromHtmlShelf =
          isStorefrontLegacySearchUrl(url) && !url.includes('/api/') && !url.includes('/_v/')
        if (!fromHtmlShelf) {
          const detected = isIntelligentEndpoint(url) ? 'intelligent' : 'catalog'
          if (preferred && preferred !== detected) {
            console.info('[vtex-search] cambio de backend', { base, from: preferred, to: detected })
          }
          searchBackendByBase.set(base, detected)
        }
        return { ok: true, products: r.products }
      }
      attempts.push({
        endpoint: url,
        reason: r.reason,
        status: r.status,
      })
      // Marcar como muerto los errores persistentes (no transitorios)
      if (r.reason === 'http_error' && (r.status === 404 || r.status === 410)) {
        recordDead(base, url, 'http_error', r.status)
      } else if (r.reason === 'not_json') {
        recordDead(base, url, 'not_json')
      }
      // No abortamos el barrido por 'network' individual: puede ser un endpoint que cuelga
      // pero otro de la lista sí responde. El presupuesto global de página corta el bucle.
    }

    if (attempts.some((a) => a.reason === 'not_json')) {
      return { ok: false, reason: 'not_json', attempts }
    }

    const networkOnly = attempts.every((a) => a.reason === 'network')
    if (networkOnly) {
      return { ok: false, reason: 'network', attempts }
    }

    const last = attempts[attempts.length - 1]
    return {
      ok: false,
      reason: 'http_error',
      status: last?.status,
      attempts,
    }
  } finally {
    clearTimeout(pageBudgetTimer)
  }
}

/** Primera página hasta `maxItems` (máx. 100 por request VTEX). */
export async function fetchVtexSearchProducts(
  baseUrl: string,
  query: string,
  maxItems: number,
): Promise<VtexFetchResult> {
  const n = Math.min(Math.max(maxItems, 1), 100)
  return fetchVtexSearchProductsPage(baseUrl, query, 0, n)
}

export function resolveVtexBaseUrlForRetailer(
  retailer: 'jumbo' | 'lider' | 'central_mayorista',
): string | null {
  if (retailer === 'jumbo') {
    const fromEnv = process.env.RETAIL_JUMBO_VTEX_BASE_URL?.trim()
    return fromEnv || 'https://www.jumbo.cl'
  }
  if (retailer === 'lider') {
    const fromEnv = process.env.RETAIL_LIDER_VTEX_BASE_URL?.trim()
    /** Storefront Next (super.lider.cl); mismo origen que usa `lider/scraper.py` para URLs relativas. */
    return fromEnv || 'https://super.lider.cl'
  }
  return process.env.RETAIL_CENTRAL_MAYORISTA_VTEX_BASE_URL?.trim() || null
}
