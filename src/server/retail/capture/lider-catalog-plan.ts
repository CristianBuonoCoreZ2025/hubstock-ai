/**
 * Plan de captura Lider: descubre URLs del storefront por capas (sitemap, home, enlaces internos,
 * variables de entorno opcionales, semillas internas). Arma la cola `retail_capture_pages`.
 * Paginación por `page` en listados HTML habituales de la tienda.
 *
 * Compatibilidad: colas antiguas con URL JSON `/api/catalog_system/pub/products/search`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { retailSweepLogInfo } from '@/lib/retail-sweep-log'

const DEFAULT_STORE = 'https://super.lider.cl'
const HTML_LIST_PAGE_SIZE_HINT = 40

/** Landings `/content/{slug}/{id}` (hubs comerciales) siempre en el plan de URLs. */
const LIDER_CONTENT_HUB_REL_PATHS: readonly string[] = [
  '/content/la-boti/60338008',
  '/content/marcas-propias/69507955',
  '/content/marcas-americanas/27359988',
  '/content/soy-pyme/52660800',
  '/content/campanas/31828696',
]

function liderContentHubSeedUrls(origin: string): string[] {
  const base = trimBase(origin)
  return LIDER_CONTENT_HUB_REL_PATHS.map((rel) => `${base}${rel}`)
}

function mergeLiderContentHubSeedUrls(origin: string, urls: string[]): string[] {
  const seeded = liderContentHubSeedUrls(origin)
  return dedupeByPath([...seeded, ...urls])
}

const FETCH_TIMEOUT_MS = 26_000
const MAX_SITEMAP_INDEX_ENTRIES = 24
const MAX_LOCS_PER_SITEMAP = 900
const MAX_HREFS_FROM_HOME = 4000
const MAX_FINAL_SEEDS = 1500

/** Semillas internas amplias (solo si el descubrimiento no devolvió suficiente). No requieren configuración del usuario. */
const INTERNAL_FALLBACK_PATHS = ['/', '/browse', '/search']

function trimBase(url: string): string {
  return url.replace(/\/+$/, '')
}

export function resolveLiderStoreBaseUrl(): string {
  const fromOrigin = process.env.RETAIL_LIDER_STORE_ORIGIN?.trim()
  if (fromOrigin) return trimBase(fromOrigin)
  const legacy = process.env.RETAIL_LIDER_VTEX_BASE_URL?.trim()
  if (legacy) return trimBase(legacy)
  return DEFAULT_STORE
}

function defaultHeaders(): Record<string, string> {
  return {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-CL,es;q=0.9',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  }
}

async function fetchText(url: string, signal: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal,
      cache: 'no-store',
      redirect: 'follow',
      headers: defaultHeaders(),
    })
    if (!res.ok) return null
    const t = await res.text()
    return t.trim().length > 0 ? t : null
  } catch {
    return null
  }
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
}

/** Extrae URLs de `<loc>` en sitemap o sitemap index. */
function extractLocTags(xml: string): string[] {
  const out: string[] = []
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const v = decodeXmlEntities(m[1] ?? '')
    if (v.length > 4) out.push(v)
  }
  return out
}

function isJunkPathname(pathname: string): boolean {
  const p = pathname.toLowerCase()
  if (p.includes('/api/')) return true
  if (/\.(js|mjs|css|json|map|ico|png|jpg|jpeg|gif|webp|svg|woff2?|ttf|eot)(\?|$)/i.test(p)) return true
  if (
    p.includes('/login') ||
    p.includes('/signin') ||
    p.includes('/cart') ||
    p.includes('/checkout') ||
    p.includes('/account') ||
    p.includes('/wallet') ||
    p.includes('/order')
  ) {
    return true
  }
  return false
}

function isLikelyProductPath(pathname: string): boolean {
  const p = pathname.toLowerCase()
  if (isJunkPathname(p)) return false
  return (
    /\/ip\//.test(p) ||
    /\/p\//.test(p) ||
    /\/product\//.test(p) ||
    (p.endsWith('.html') && p.split('/').filter(Boolean).length >= 3)
  )
}

function isLikelyListingPath(pathname: string): boolean {
  const p = pathname.toLowerCase()
  if (isJunkPathname(p)) return false
  if (isLikelyProductPath(p)) return false
  return (
    p.includes('/browse') ||
    p === '/search' ||
    p.startsWith('/search/') ||
    p.includes('collection') ||
    p.includes('categoria') ||
    p.includes('category') ||
    p.includes('shelf') ||
    p.includes('department') ||
    p.includes('/shop') ||
    p.includes('/all-') ||
    p.includes('/departments')
  )
}

function urlPriorityScore(pathname: string): number {
  if (isLikelyListingPath(pathname)) return 100
  if (isLikelyProductPath(pathname)) return 60
  if (pathname === '/' || pathname === '') return 10
  return 5
}

/**
 * Normaliza una URL candidata al mismo host de la tienda; descarta basura y ancla.
 * No exige `/browse`: acepta listados, búsqueda sin término forzado, PDP, etc.
 */
export function normalizeLiderStorefrontUrl(originBase: string, raw: string): string | null {
  try {
    const absolute = raw.startsWith('http') ? raw : `${trimBase(originBase)}/${raw.replace(/^\//, '')}`
    const u = new URL(absolute)
    const origin = new URL(trimBase(originBase))
    if (u.hostname !== origin.hostname) return null
    if (isJunkPathname(u.pathname)) return null
    u.hash = ''
    if (u.pathname !== '/' && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '')
    return u.toString()
  } catch {
    return null
  }
}

/** URLs opcionales desde env (fallback técnico avanzado); cualquier ruta del mismo host válida. */
function envAdvancedSeedUrls(origin: string): string[] {
  const raw =
    process.env.RETAIL_LIDER_STOREFRONT_BROWSE_URLS?.split(',') ??
    process.env.RETAIL_LIDER_BROWSE_URLS?.split(',') ??
    []
  const out: string[] = []
  for (const s of raw.map((x) => x.trim()).filter(Boolean)) {
    const n = normalizeLiderStorefrontUrl(origin, s)
    if (n) out.push(n)
  }
  return out
}

function dedupeByPath(urls: string[]): string[] {
  const byPath = new Map<string, string>()
  for (const href of urls) {
    try {
      const u = new URL(href)
      u.hash = ''
      const key = `${u.origin}${u.pathname}`.toLowerCase()
      if (!byPath.has(key)) byPath.set(key, u.toString())
    } catch {
      /* skip */
    }
  }
  return [...byPath.values()]
}

function urlPathKey(href: string): string | null {
  try {
    const u = new URL(href)
    return `${u.origin}${u.pathname}`.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Aplica límite manteniendo siempre URLs críticas (hubs content + env explícito).
 */
function applyMaxFinalSeedsKeepingSticky(urls: string[], sticky: string[], max: number): string[] {
  if (urls.length <= max) return urls

  const stickyKeys = new Set(sticky.map((u) => urlPathKey(u)).filter(Boolean) as string[])
  const stickyPresent: string[] = []
  const rest: string[] = []
  const seenSticky = new Set<string>()
  for (const u of urls) {
    const k = urlPathKey(u)
    if (k && stickyKeys.has(k)) {
      if (!seenSticky.has(k)) {
        stickyPresent.push(u)
        seenSticky.add(k)
      }
    } else {
      rest.push(u)
    }
  }
  const merged = [...stickyPresent, ...rest]
  return merged.slice(0, max)
}

function isSitemapUrl(href: string): boolean {
  try {
    const p = new URL(href).pathname.toLowerCase()
    return p.endsWith('.xml') && (p.includes('sitemap') || p.includes('siteindex'))
  } catch {
    return false
  }
}

async function collectUrlsFromSitemaps(origin: string, signal: AbortSignal): Promise<string[]> {
  const base = trimBase(origin)
  const collected = new Set<string>()
  const indexCandidates = [`${base}/sitemap.xml`, `${base}/sitemap_index.xml`]

  for (const idxUrl of indexCandidates) {
    const xml = await fetchText(idxUrl, signal)
    if (!xml || !xml.includes('<')) continue

    const locs = extractLocTags(xml)
    const childSitemaps = locs.filter(isSitemapUrl)
    const directUrls = locs.filter((u) => !isSitemapUrl(u))

    for (const u of directUrls) {
      const n = normalizeLiderStorefrontUrl(origin, u)
      if (n) collected.add(n)
    }

    let childCount = 0
    for (const sm of childSitemaps) {
      if (childCount++ >= MAX_SITEMAP_INDEX_ENTRIES) break
      const inner = await fetchText(sm, signal)
      if (!inner) continue
      let nLoc = 0
      for (const u of extractLocTags(inner)) {
        if (nLoc++ >= MAX_LOCS_PER_SITEMAP) break
        const n = normalizeLiderStorefrontUrl(origin, u)
        if (n) collected.add(n)
      }
    }

    if (collected.size > 0) break
  }

  return [...collected]
}

const HREF_RE = /href\s*=\s*["']([^"'#]+)["']/gi

function extractHrefsFromHtml(html: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = HREF_RE.exec(html)) !== null) {
    const raw = m[1]?.trim()
    if (raw && !raw.startsWith('javascript:') && !raw.startsWith('mailto:')) out.push(raw)
  }
  return out
}

function collectPathLikeStringsFromJson(node: unknown, out: Set<string>): void {
  if (node === null || node === undefined) return
  if (typeof node === 'string') {
    const s = node.trim()
    if (s.startsWith('/') && s.length >= 2 && s.length < 400 && !s.includes('{{') && !s.includes('${')) {
      if (/^\/[A-Za-z0-9\-_/%.]*$/.test(s) && !s.includes('..')) out.add(s)
    }
    if (s.includes('super.lider.cl') && s.startsWith('http')) out.add(s)
    return
  }
  if (Array.isArray(node)) {
    for (const x of node) collectPathLikeStringsFromJson(x, out)
    return
  }
  if (typeof node === 'object') {
    for (const v of Object.values(node as Record<string, unknown>)) {
      collectPathLikeStringsFromJson(v, out)
    }
  }
}

function parseNextDataJson(html: string): unknown | null {
  const re = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  const m = re.exec(html)
  if (!m?.[1]) return null
  try {
    return JSON.parse(m[1].trim()) as unknown
  } catch {
    return null
  }
}

async function collectUrlsFromHomepage(origin: string, signal: AbortSignal): Promise<string[]> {
  const collected = new Set<string>()
  const html = await fetchText(`${trimBase(origin)}/`, signal)
  if (!html) return []

  let n = 0
  for (const href of extractHrefsFromHtml(html)) {
    if (n++ > MAX_HREFS_FROM_HOME) break
    const nurl = normalizeLiderStorefrontUrl(origin, href)
    if (nurl) collected.add(nurl)
  }

  const nextData = parseNextDataJson(html)
  if (nextData) {
    const strSet = new Set<string>()
    collectPathLikeStringsFromJson(nextData, strSet)
    for (const s of strSet) {
      const nurl = normalizeLiderStorefrontUrl(origin, s)
      if (nurl) collected.add(nurl)
    }
  }

  return [...collected]
}

function applyInternalFallbackSeeds(origin: string, urls: string[]): string[] {
  const set = new Set(urls)
  for (const path of INTERNAL_FALLBACK_PATHS) {
    const n = normalizeLiderStorefrontUrl(origin, path)
    if (n) set.add(n)
  }
  return [...set]
}

function sortSeedsByPriority(urls: string[]): string[] {
  return [...urls].sort((a, b) => {
    try {
      const pa = new URL(a).pathname
      const pb = new URL(b).pathname
      const sa = urlPriorityScore(pa)
      const sb = urlPriorityScore(pb)
      if (sa !== sb) return sb - sa
      return a.localeCompare(b)
    } catch {
      return 0
    }
  })
}

export type LiderCapturePlanDiscoveryMeta = {
  fromSitemap: number
  fromHomepage: number
  fromEnv: number
  fromFallback: number
  finalCount: number
}

/**
 * Descubre URLs de captura por capas (sin exigir `/browse` ni configuración del usuario).
 */
export async function discoverLiderCapturePlanUrls(): Promise<{
  urls: string[]
  meta: LiderCapturePlanDiscoveryMeta
}> {
  const origin = resolveLiderStoreBaseUrl()
  const ctl = new AbortController()
  const tm = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
  const meta: LiderCapturePlanDiscoveryMeta = {
    fromSitemap: 0,
    fromHomepage: 0,
    fromEnv: 0,
    fromFallback: 0,
    finalCount: 0,
  }

  try {
    const fromSitemap = await collectUrlsFromSitemaps(origin, ctl.signal)
    meta.fromSitemap = fromSitemap.length

    const fromHome = await collectUrlsFromHomepage(origin, ctl.signal)
    meta.fromHomepage = fromHome.length

    const fromEnv = envAdvancedSeedUrls(origin)
    meta.fromEnv = fromEnv.length

    let merged = dedupeByPath([...fromSitemap, ...fromHome, ...fromEnv])
    merged = mergeLiderContentHubSeedUrls(origin, merged)
    const beforeFallback = merged.length

    merged = applyInternalFallbackSeeds(origin, merged)
    if (merged.length > beforeFallback) meta.fromFallback = merged.length - beforeFallback

    merged = sortSeedsByPriority(merged)
    const sticky = dedupeByPath([...liderContentHubSeedUrls(origin), ...fromEnv])
    merged = applyMaxFinalSeedsKeepingSticky(merged, sticky, MAX_FINAL_SEEDS)

    meta.finalCount = merged.length

    retailSweepLogInfo('plan captura Lider: descubrimiento', meta as unknown as Record<string, unknown>)

    return { urls: merged, meta }
  } catch {
    const home = normalizeLiderStorefrontUrl(origin, '/')!
    meta.fromFallback = 1
    meta.finalCount = 1
    return { urls: [home], meta }
  } finally {
    clearTimeout(tm)
  }
}

/** @deprecated Usar `discoverLiderCapturePlanUrls`; se mantiene por compatibilidad de importaciones. */
export async function discoverLiderBrowseListingUrls(): Promise<string[]> {
  const { urls } = await discoverLiderCapturePlanUrls()
  return urls
}

/**
 * Listado o búsqueda en HTML que suele paginarse con `page` (no solo `/browse`).
 */
export function isLiderHtmlPaginatorListingUrl(pageUrl: string): boolean {
  try {
    const u = new URL(pageUrl)
    if (u.pathname.toLowerCase().includes('/api/')) return false
    const p = u.pathname.toLowerCase()
    if (p.includes('/browse')) return true
    if (p === '/search' || p.startsWith('/search/')) return true
    if (p.includes('collection') || p.includes('shelf') || p.includes('department')) return true
    if (p.includes('categoria') || p.includes('category')) return true
    return false
  } catch {
    return false
  }
}

/** Alias histórico: incluye listados paginables además de browse. */
export function isLiderHtmlBrowseListingUrl(pageUrl: string): boolean {
  return isLiderHtmlPaginatorListingUrl(pageUrl)
}

function htmlListPageSizeHint(): number {
  const raw = process.env.RETAIL_LIDER_HTML_LIST_PAGE_SIZE_HINT?.trim()
  const n = raw ? Number(raw) : HTML_LIST_PAGE_SIZE_HINT
  if (!Number.isFinite(n) || n < 8) return HTML_LIST_PAGE_SIZE_HINT
  return Math.min(Math.floor(n), 120)
}

export function nextLiderHtmlBrowseListingPageUrl(pageUrl: string, lastPageProductCount: number): string | null {
  if (!isLiderHtmlPaginatorListingUrl(pageUrl)) return null
  const hint = htmlListPageSizeHint()
  if (lastPageProductCount < hint) return null
  try {
    const u = new URL(pageUrl)
    const cur = Math.max(1, Number.parseInt(u.searchParams.get('page') ?? '1', 10) || 1)
    const copy = new URL(u.toString())
    copy.searchParams.set('page', String(cur + 1))
    return copy.toString()
  } catch {
    return null
  }
}

const LEGACY_PAGE_SLICE = 50

export function isLiderCatalogSystemSearchUrl(pageUrl: string): boolean {
  try {
    const u = new URL(pageUrl)
    return u.pathname.includes('/catalog_system/pub/products/search')
  } catch {
    return false
  }
}

export function nextLiderCatalogSystemSliceUrl(pageUrl: string, lastPageProductCount: number): string | null {
  if (lastPageProductCount < LEGACY_PAGE_SLICE) return null
  try {
    const u = new URL(pageUrl)
    if (!u.pathname.includes('/catalog_system/pub/products/search')) return null
    const from = Number(u.searchParams.get('_from') ?? '0')
    const to = Number(u.searchParams.get('_to') ?? String(LEGACY_PAGE_SLICE - 1))
    const span = Math.max(1, to - from + 1)
    const nextFrom = from + span
    const nextTo = nextFrom + span - 1
    u.searchParams.set('_from', String(nextFrom))
    u.searchParams.set('_to', String(nextTo))
    return u.toString()
  } catch {
    return null
  }
}

export type LiderPageSeed = { page_url: string; page_index: number }

export async function buildLiderFullCatalogPageSeeds(): Promise<LiderPageSeed[]> {
  const { urls } = await discoverLiderCapturePlanUrls()
  const origin = resolveLiderStoreBaseUrl()
  const fallback = normalizeLiderStorefrontUrl(origin, '/') ?? `${trimBase(origin)}/`
  const list = urls.length > 0 ? urls : [fallback]
  return list.map((href, page_index) => ({ page_url: href, page_index }))
}

export async function insertRetailCapturePageRows(
  admin: SupabaseClient,
  batchId: string,
  retailer: string,
  seeds: LiderPageSeed[],
): Promise<{ error: unknown | null }> {
  if (seeds.length === 0) return { error: new Error('empty_seeds') }
  const rows = seeds.map((s) => ({
    batch_id: batchId,
    retailer,
    page_url: s.page_url,
    page_index: s.page_index,
    status: 'pending',
  }))
  const { error } = await admin.from('retail_capture_pages').insert(rows as never)
  return { error }
}

export async function appendRetailCapturePage(
  admin: SupabaseClient,
  batchId: string,
  retailer: string,
  pageUrl: string,
): Promise<{ error: unknown | null }> {
  const { data: maxRow, error: qErr } = await admin
    .from('retail_capture_pages')
    .select('page_index')
    .eq('batch_id', batchId)
    .order('page_index', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (qErr) return { error: qErr }
  const nextIndex = typeof (maxRow as { page_index?: number } | null)?.page_index === 'number' ?
      (maxRow as { page_index: number }).page_index + 1
    : 0

  const { error } = await admin
    .from('retail_capture_pages')
    .insert({
      batch_id: batchId,
      retailer,
      page_url: pageUrl,
      page_index: nextIndex,
      status: 'pending',
    } as never)

  return { error }
}

export async function countRetailCapturePages(
  admin: SupabaseClient,
  batchId: string,
): Promise<{ total: number; pending: number; processing: number; done: number; failed: number; skipped: number }> {
  const { data, error } = await admin.from('retail_capture_pages').select('status').eq('batch_id', batchId)
  if (error || !data) {
    return { total: 0, pending: 0, processing: 0, done: 0, failed: 0, skipped: 0 }
  }
  const tallies = { total: 0, pending: 0, processing: 0, done: 0, failed: 0, skipped: 0 }
  for (const r of data as { status: string }[]) {
    tallies.total++
    const s = (r.status ?? '').toLowerCase()
    if (s === 'pending') tallies.pending++
    else if (s === 'processing') tallies.processing++
    else if (s === 'done') tallies.done++
    else if (s === 'failed') tallies.failed++
    else if (s === 'skipped') tallies.skipped++
  }
  return tallies
}

export type RetailCapturePageJob = {
  id: string
  batch_id: string
  retailer: string
  page_url: string
  page_index: number
  status: string
}

export async function claimNextRetailCapturePage(
  admin: SupabaseClient,
  batchId: string,
): Promise<RetailCapturePageJob | null> {
  const { data: next, error: selErr } = await admin
    .from('retail_capture_pages')
    .select('id,batch_id,retailer,page_url,page_index,status')
    .eq('batch_id', batchId)
    .eq('status', 'pending')
    .order('page_index', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (selErr || !next) return null

  const started = new Date().toISOString()
  const { data: claimed, error: upErr } = await admin
    .from('retail_capture_pages')
    .update({ status: 'processing', started_at: started } as never)
    .eq('id', (next as { id: string }).id)
    .eq('status', 'pending')
    .select('id,batch_id,retailer,page_url,page_index,status')
    .maybeSingle()

  if (upErr || !claimed) return null
  return claimed as RetailCapturePageJob
}

export async function finalizeRetailCapturePage(
  admin: SupabaseClient,
  pageId: string,
  patch: {
    status: 'done' | 'failed' | 'skipped'
    products_found: number
    clean_products: number
    discarded_products: number
    error_message?: string | null
  },
): Promise<void> {
  await admin
    .from('retail_capture_pages')
    .update({
      status: patch.status,
      products_found: patch.products_found,
      clean_products: patch.clean_products,
      discarded_products: patch.discarded_products,
      error_message: patch.error_message ?? null,
      finished_at: new Date().toISOString(),
    } as never)
    .eq('id', pageId)
}

export async function resetStaleRetailCapturePagesProcessing(
  admin: SupabaseClient,
  batchId: string,
  maxAgeMs = 600_000,
): Promise<void> {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString()
  await admin
    .from('retail_capture_pages')
    .update({ status: 'pending', started_at: null, error_message: null } as never)
    .eq('batch_id', batchId)
    .eq('status', 'processing')
    .lt('started_at', cutoff)
}
