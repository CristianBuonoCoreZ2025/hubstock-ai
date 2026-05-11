/**
 * Captura Lider (super.lider.cl) por páginas pequeñas para Vercel.
 * Reutiliza el parseo HTML/__NEXT_DATA__ de `extract-products-from-retail-html.ts`
 * (misma lógica que `lider/scraper.py`).
 */

import { extractListedProductsFromRetailHtml, htmlListedProductToSyntheticVtex } from '@/server/retail-capture/extract-products-from-retail-html'
import { mapVtexProductList, type RetailSnapshotRow } from '@/server/retail-capture/map-vtex-product'
import { resolveVtexBaseUrlForRetailer } from '@/server/retail-capture/fetch-vtex-search'
import type { RetailCapturedProductInput } from '@/server/retail/capture/retail-types'
import { normalizeRetailCapturedInput } from '@/server/retail/normalize/normalize-retail-product'

/** Semillas internas (no UI): rutas acotadas para avanzar el batch sin barrido manual. */
const DEFAULT_LIDER_CAPTURE_SEEDS = [
  'https://super.lider.cl/search?q=arroz',
  'https://super.lider.cl/search?q=aceite',
  'https://super.lider.cl/search?q=leche',
  'https://super.lider.cl/search?q=bebida',
  'https://super.lider.cl/search?q=limpieza',
  'https://super.lider.cl/search?q=despensa',
  'https://super.lider.cl/search?q=fruta',
  'https://super.lider.cl/search?q=congelado',
]

function maxPagesPerSeed(): number {
  const raw = process.env.RETAIL_LIDER_CAPTURE_MAX_PAGE_PER_SEED?.trim()
  const n = raw ? Number(raw) : 3
  if (!Number.isFinite(n) || n < 1) return 3
  return Math.min(Math.floor(n), 8)
}

/**
 * Lista determinista de URLs a visitar (misma entrada en cada proceso del batch).
 * Override: `RETAIL_LIDER_BROWSE_URLS` = URLs completas separadas por coma (cada una puede incluir query).
 */
export function buildLiderCapturePlanUrls(): string[] {
  const env =
    process.env.RETAIL_LIDER_BROWSE_URLS?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? []
  const seeds = env.length > 0 ? env : DEFAULT_LIDER_CAPTURE_SEEDS
  const maxPage = maxPagesPerSeed()
  const urls: string[] = []

  for (const seed of seeds) {
    const absolute = seed.startsWith('http') ?
      seed
    : `https://super.lider.cl${seed.startsWith('/') ? '' : '/'}${seed}`
    let u: URL
    try {
      u = new URL(absolute)
    } catch {
      continue
    }
    for (let p = 1; p <= maxPage; p++) {
      const copy = new URL(u.toString())
      copy.searchParams.set('page', String(p))
      urls.push(copy.toString())
    }
  }
  return urls
}

function categoryHintFromPageUrl(pageUrl: string): string | null {
  try {
    const path = new URL(pageUrl).pathname.replace(/^\/+|\/+$/g, '')
    const parts = path.split('/').filter(Boolean)
    if (parts.length === 0) return null
    return parts.map((s) => s.replace(/-/g, ' ')).slice(0, 3).join(' › ')
  } catch {
    return null
  }
}

export async function fetchLiderHtmlPage(
  pageUrl: string,
): Promise<{ ok: true; html: string } | { ok: false; error: string }> {
  const ctl = new AbortController()
  const tm = setTimeout(() => ctl.abort(), 26_000)
  try {
    const res = await fetch(pageUrl, {
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
    if (!res.ok) {
      return { ok: false, error: `La tienda respondió HTTP ${res.status}.` }
    }
    const html = (await res.text()).trim()
    if (html.length < 200) {
      return { ok: false, error: 'Respuesta demasiado corta desde la tienda.' }
    }
    return { ok: true, html }
  } catch {
    return { ok: false, error: 'Tiempo agotado o error de red al cargar Lider.' }
  } finally {
    clearTimeout(tm)
  }
}

export type LiderCapturePageResult = {
  pageUrl: string
  snapshots: RetailSnapshotRow[]
  stagingRows: Array<
    RetailCapturedProductInput & {
      external_ref: string
      normalized_title: string
      normalized_brand: string
    }
  >
}

/**
 * Descarga una URL de listado Lider y devuelve filas para snapshots + staging.
 */
export async function captureLiderListingPage(pageUrl: string): Promise<
  | { ok: true; data: LiderCapturePageResult }
  | { ok: false; error: string }
> {
  const base = resolveVtexBaseUrlForRetailer('lider') ?? 'https://super.lider.cl'
  const fetched = await fetchLiderHtmlPage(pageUrl)
  if (!fetched.ok) return fetched

  const listed = extractListedProductsFromRetailHtml(fetched.html, pageUrl)
  const synthetic = listed.map((p) => htmlListedProductToSyntheticVtex(p))
  const snapshots = mapVtexProductList(synthetic, {
    retailer: 'lider',
    vtexBaseUrl: base,
    matchMethod: 'retail_batch_lider_page',
  })

  const catHint = categoryHintFromPageUrl(pageUrl)
  const stagingRows: LiderCapturePageResult['stagingRows'] = []

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i]!
    const raw = synthetic[i] as Record<string, unknown>

    const input: RetailCapturedProductInput = {
      retailer: 'lider',
      external_ref: snap.external_ref,
      source_url: snap.source_url,
      title: snap.title,
      brand: snap.brand_hint,
      price: snap.price,
      unit_price: extractUnitPriceFromSynthetic(raw),
      category_hint: snap.category_hint ?? catHint,
      description_hint: snap.description_hint,
      image_url: extractThumbFromSynthetic(raw),
      raw_data: raw,
    }
    const norm = normalizeRetailCapturedInput(input)
    stagingRows.push({
      ...input,
      external_ref: snap.external_ref,
      normalized_title: norm.normalized_title,
      normalized_brand: norm.normalized_brand,
    })
  }

  return {
    ok: true,
    data: {
      pageUrl,
      snapshots,
      stagingRows,
    },
  }
}

function extractUnitPriceFromSynthetic(raw: Record<string, unknown>): string | null {
  const items = raw.items
  if (!Array.isArray(items) || items.length === 0) return null
  const first = items[0] as Record<string, unknown>
  const sellers = first?.sellers
  if (!Array.isArray(sellers) || sellers.length === 0) return null
  const offer = (sellers[0] as Record<string, unknown>)?.commertialOffer as
    | Record<string, unknown>
    | undefined
  const u = offer?.UnitPrice ?? offer?.unitPrice
  if (typeof u === 'string' && u.trim()) return u.trim()
  return null
}

function extractThumbFromSynthetic(raw: Record<string, unknown>): string | null {
  const items = raw.items
  if (!Array.isArray(items) || items.length === 0) return null
  const first = items[0] as Record<string, unknown>
  const img = first?.images
  if (Array.isArray(img) && img.length > 0) {
    const u = (img[0] as Record<string, unknown>)?.imageUrl
    if (typeof u === 'string' && u.trim()) return u.trim()
  }
  return null
}
