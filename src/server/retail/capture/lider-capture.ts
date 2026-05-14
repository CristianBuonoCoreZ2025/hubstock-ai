/**
 * Captura Lider (super.lider.cl) por páginas pequeñas para Vercel.
 * Flujo principal: listados HTML (Next.js / __NEXT_DATA__) vía `extract-products-from-retail-html.ts`.
 * Rama JSON legacy: solo si la URL apunta a `/api/catalog_system/pub/products/search` (colas antiguas).
 */

import { extractListedProductsFromRetailHtml, htmlListedProductToSyntheticVtex } from '@/server/retail-capture/extract-products-from-retail-html'
import { extractVtexProductArrayFromResponse } from '@/server/retail-capture/parse-json-products'
import {
  mapVtexProductToSnapshot,
  type RetailSnapshotRow,
} from '@/server/retail-capture/map-vtex-product'
import { isLiderCatalogSystemSearchUrl, resolveLiderStoreBaseUrl } from '@/server/retail/capture/lider-catalog-plan'
import type { RetailCapturedProductInput } from '@/server/retail/capture/retail-types'
import { normalizeRetailCapturedInput } from '@/server/retail/normalize/normalize-retail-product'

function maxPagesPerSeed(): number {
  const raw = process.env.RETAIL_LIDER_CAPTURE_MAX_PAGE_PER_SEED?.trim()
  const n = raw ? Number(raw) : 3
  if (!Number.isFinite(n) || n < 1) return 3
  return Math.min(Math.floor(n), 8)
}

/**
 * Solo diagnóstico: URLs desde `RETAIL_LIDER_BROWSE_URLS` (coma). Sin variable no hay plan.
 * No usar como flujo principal de producción.
 */
export function buildLiderDiagnosticBrowsePlanUrls(): string[] {
  const env =
    process.env.RETAIL_LIDER_BROWSE_URLS?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? []
  const maxPage = maxPagesPerSeed()
  const urls: string[] = []

  for (const seed of env) {
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

async function fetchLiderJsonPage(
  pageUrl: string,
): Promise<{ ok: true; parsed: unknown } | { ok: false; error: string }> {
  const ctl = new AbortController()
  const tm = setTimeout(() => ctl.abort(), 26_000)
  try {
    const res = await fetch(pageUrl, {
      signal: ctl.signal,
      redirect: 'follow',
      cache: 'no-store',
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'Accept-Language': 'es-CL,es;q=0.9',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })
    if (!res.ok) {
      return { ok: false, error: `La tienda respondió HTTP ${res.status}.` }
    }
    const text = (await res.text()).trim()
    if (text.length < 2) {
      return { ok: false, error: 'Respuesta JSON vacía desde la tienda.' }
    }
    try {
      return { ok: true, parsed: JSON.parse(text) as unknown }
    } catch {
      return { ok: false, error: 'La respuesta no es JSON válido.' }
    }
  } catch {
    return { ok: false, error: 'Tiempo agotado o error de red al cargar Lider.' }
  } finally {
    clearTimeout(tm)
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
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
  /** Productos devueltos por la tienda antes de filtrar calidad (VTEX/HTML). */
  rawProductCount: number
}

function isCleanRetailSnapshot(s: RetailSnapshotRow): boolean {
  if (!s.external_ref?.trim()) return false
  if (!s.title?.trim()) return false
  if (s.price == null || !Number.isFinite(s.price) || s.price <= 0) return false
  return true
}

/**
 * Separa filas limpias (staging + snapshots alineados) del resto contabilizado como descartado.
 */
export function partitionLiderCaptureForCleanInsert(input: {
  snapshots: RetailSnapshotRow[]
  stagingRows: LiderCapturePageResult['stagingRows']
  rawProductCount?: number
}): {
  cleanSnapshots: RetailSnapshotRow[]
  cleanStaging: LiderCapturePageResult['stagingRows']
  productsFound: number
  discardedProducts: number
} {
  const raw =
    input.rawProductCount ?? Math.max(input.snapshots.length, input.stagingRows.length)
  const cleanSnapshots: RetailSnapshotRow[] = []
  const cleanStaging: LiderCapturePageResult['stagingRows'] = []
  const n = Math.min(input.snapshots.length, input.stagingRows.length)
  for (let i = 0; i < n; i++) {
    const s = input.snapshots[i]!
    const st = input.stagingRows[i]!
    if (!isCleanRetailSnapshot(s)) continue
    cleanSnapshots.push(s)
    cleanStaging.push(st)
  }
  const discardedProducts = Math.max(0, raw - cleanSnapshots.length)
  return {
    cleanSnapshots,
    cleanStaging,
    productsFound: raw,
    discardedProducts,
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

async function captureLiderCatalogSystemJsonPage(pageUrl: string): Promise<
  | { ok: true; data: LiderCapturePageResult }
  | { ok: false; error: string }
> {
  const base = resolveLiderStoreBaseUrl()
  const fetched = await fetchLiderJsonPage(pageUrl)
  if (!fetched.ok) return fetched

  const arr = extractVtexProductArrayFromResponse(fetched.parsed)
  if (!arr) {
    return { ok: false, error: 'El JSON de la tienda no contiene una lista de productos reconocible.' }
  }

  const ctx = {
    retailer: 'lider' as const,
    vtexBaseUrl: base,
    matchMethod: 'retail_batch_lider_catalog_system',
  }

  const snapshots: RetailSnapshotRow[] = []
  const stagingRows: LiderCapturePageResult['stagingRows'] = []
  const catHint = categoryHintFromPageUrl(pageUrl)

  for (const p of arr) {
    const snap = mapVtexProductToSnapshot(p, ctx)
    if (!snap) continue
    const raw = asRecord(p) ?? {}
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
    snapshots.push(snap)
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
      rawProductCount: arr.length,
    },
  }
}

/**
 * Descarga una URL de listado Lider (HTML) y devuelve filas para snapshots + staging.
 */
export async function captureLiderListingPage(pageUrl: string): Promise<
  | { ok: true; data: LiderCapturePageResult }
  | { ok: false; error: string }
> {
  const base = resolveLiderStoreBaseUrl()
  const fetched = await fetchLiderHtmlPage(pageUrl)
  if (!fetched.ok) return fetched

  const listed = extractListedProductsFromRetailHtml(fetched.html, pageUrl)
  const ctx = {
    retailer: 'lider' as const,
    vtexBaseUrl: base,
    matchMethod: 'retail_batch_lider_page' as const,
  }
  const catHint = categoryHintFromPageUrl(pageUrl)
  const snapshots: RetailSnapshotRow[] = []
  const stagingRows: LiderCapturePageResult['stagingRows'] = []

  // Un producto listado → un synthetic → un snapshot; no usar mapVtexProductList y luego indexar mal.
  for (const p of listed) {
    const synthetic = htmlListedProductToSyntheticVtex(p)
    const snap = mapVtexProductToSnapshot(synthetic, ctx)
    if (!snap) continue
    const raw = synthetic as Record<string, unknown>
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
    snapshots.push(snap)
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
      rawProductCount: listed.length,
    },
  }
}

/**
 * Enruta captura: HTML de tienda (principal) o JSON legacy si la URL es de catálogo antiguo.
 */
export async function captureLiderRetailPage(pageUrl: string): Promise<
  | { ok: true; data: LiderCapturePageResult }
  | { ok: false; error: string }
> {
  if (isLiderCatalogSystemSearchUrl(pageUrl)) {
    return captureLiderCatalogSystemJsonPage(pageUrl)
  }
  return captureLiderListingPage(pageUrl)
}
