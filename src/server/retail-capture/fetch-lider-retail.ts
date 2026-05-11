/**
 * Lider (super.lider.cl): listados Next.js con datos embebidos, mismo enfoque que `lider/scraper.py`.
 * No usar APIs VTEX públicas masivas para esta cadena.
 */

import type { VtexFetchResult } from '@/server/retail-capture/fetch-vtex-search'
import {
  extractListedProductsFromRetailHtml,
  htmlListedProductToSyntheticVtex,
} from '@/server/retail-capture/extract-products-from-retail-html'

/**
 * URLs candidatas de búsqueda en super.lider.cl (Next.js Walmart Chile).
 * Override: RETAIL_LIDER_SEARCH_URL_TEMPLATE — ruta relativa con `{query}` y `{page}`
 * (ej. search?q={query}&page={page}).
 */
function liderHtmlSearchCandidates(base: string, rawQuery: string, pageNum: number): string[] {
  const b = base.replace(/\/+$/, '')
  const enc = encodeURIComponent(rawQuery.trim())
  const pn = Math.max(1, pageNum)
  const qsPage = pn > 1 ? `&page=${pn}` : ''

  const template = process.env.RETAIL_LIDER_SEARCH_URL_TEMPLATE?.trim()
  const custom: string[] = []
  if (template) {
    const path = template
      .replace(/\{query\}/g, enc)
      .replace(/\{q\}/g, enc)
      .replace(/\{page\}/g, String(pn))
    custom.push(path.startsWith('http') ? path : `${b}/${path.replace(/^\//, '')}`)
  }

  return [
    ...custom,
    `${b}/search?q=${enc}${qsPage}`,
    `${b}/search/?q=${enc}${qsPage}`,
    `${b}/s?q=${enc}${qsPage}`,
    `${b}/search?query=${enc}${qsPage}`,
    `${b}/search?search_query=${enc}${qsPage}`,
    `${b}/browse?search-value=${enc}${qsPage}`,
    `${b}/buscar?q=${enc}${qsPage}`,
  ].filter((u, i, a) => a.indexOf(u) === i)
}

/** Una «página» de resultado de búsqueda HTML para barrido/import web (no VTEX). */
export async function fetchLiderRetailSearchPage(
  baseUrl: string,
  query: string,
  offset: number,
  chunkSize: number,
): Promise<VtexFetchResult> {
  const pageNum = Math.floor(Math.max(0, offset) / Math.max(chunkSize, 1)) + 1

  const ctl = new AbortController()
  const tm = setTimeout(() => ctl.abort(), 28_000)
  try {
    const urls = liderHtmlSearchCandidates(baseUrl, query, pageNum)
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          signal: ctl.signal,
          redirect: 'follow',
          cache: 'no-store',
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'es-CL,es;q=0.9',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        })
        if (!res.ok) continue
        const html = (await res.text()).trim()
        const listed = extractListedProductsFromRetailHtml(html, url)
        if (listed.length === 0) continue
        return {
          ok: true,
          products: listed.map((item) => htmlListedProductToSyntheticVtex(item)),
        }
      } catch {
        /* siguiente URL candidata */
      }
    }
    return { ok: false, reason: 'not_json' }
  } finally {
    clearTimeout(tm)
  }
}

/** Primera «página» hasta maxItems para búsqueda puntual web. */
export async function fetchLiderRetailProducts(
  baseUrl: string,
  query: string,
  maxItems: number,
): Promise<VtexFetchResult> {
  const n = Math.min(Math.max(maxItems, 1), 100)
  return fetchLiderRetailSearchPage(baseUrl, query, 0, n)
}
