/**
 * Plan de captura Lider: descubre URLs del storefront por capas (sitemap, home, enlaces internos,
 * variables de entorno opcionales, semillas internas). Arma la cola `retail_capture_pages`.
 * Paginación por `page` en listados HTML habituales de la tienda.
 *
 * Compatibilidad: colas antiguas con URL JSON `/api/catalog_system/pub/products/search`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { retailSweepLogInfo } from '@/lib/retail-sweep-log'

/**
 * Límites del plan de URLs (rendimiento: colas enormes degradan descubrimiento y scrapping).
 * Configurables en `.env.local` (servidor / build):
 *
 * - `RETAIL_LIDER_MAX_SEED_URLS` — tope de semillas finales (default 6000, rango 100–80000).
 * - `RETAIL_LIDER_MAX_CONTENT_STICKY_SEEDS` — landings `/content/…` preservadas al tope (default 900).
 * - `RETAIL_LIDER_MAX_CONTENT_SURFACE_VISITS` — visitas BFS content→browse (default 320).
 * - `RETAIL_LIDER_MAX_HREFS_FROM_HOME` — enlaces máx. en la home (default 8000).
 * - `RETAIL_LIDER_MAX_SITEMAP_CHILDREN` — sitemaps hijos a seguir desde el índice (default 48).
 * - `RETAIL_LIDER_MAX_LOCS_PER_SITEMAP` — `<loc>` máx. por sitemap hijo (default 2500).
 * - `RETAIL_LIDER_DISCOVERY_TIMEOUT_MS` — presupuesto global de descubrimiento en ms (default 60000; máx. 3600000 = 1 h).
 *   Incluye sitemap, home y expansión `/content`→`/browse`. Si es bajo, el plan queda corto antes de terminar de leer el sitio.
 * - `RETAIL_LIDER_MAX_BROWSE_LINKS_PER_HTML` — enlaces `/browse/` máx. extraídos por HTML (default 5000).
 * - `RETAIL_LIDER_MAX_LINKED_CONTENT_URLS_PER_HTML` — enlaces `/content/` máx. por HTML al expandir (default 800).
 *
 * Semillas extra: `RETAIL_LIDER_STOREFRONT_BROWSE_URLS` o `RETAIL_LIDER_BROWSE_URLS` (coma).
 * Las rutas `/ip/…` (Lider) se priorizan como listado en el plan de semillas para no quedar siempre fuera del tope frente a `/browse/`.
 */

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

const CONTENT_SURFACE_FETCH_MS = 14_000
const CONTENT_EXPAND_PARALLEL = 4

/** Por petición: tope por HTML + cancelación si vence el presupuesto global de descubrimiento. */
function surfaceFetchSignal(globalSignal: AbortSignal): AbortSignal {
  const perRequest = AbortSignal.timeout(CONTENT_SURFACE_FETCH_MS)
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([globalSignal, perRequest])
  }
  return perRequest
}

/** Semillas internas amplias (solo si el descubrimiento no devolvió suficiente). No requieren configuración del usuario. */
const INTERNAL_FALLBACK_PATHS = ['/', '/browse', '/search']

function trimBase(url: string): string {
  return url.replace(/\/+$/, '')
}

function readPositiveIntFromEnv(
  envName: string,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  const raw = process.env[envName]?.trim()
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(bounds.max, Math.max(bounds.min, n))
}

function maxFinalSeeds(): number {
  return readPositiveIntFromEnv('RETAIL_LIDER_MAX_SEED_URLS', 6000, { min: 100, max: 80_000 })
}

function maxContentSurfacesSticky(): number {
  return readPositiveIntFromEnv('RETAIL_LIDER_MAX_CONTENT_STICKY_SEEDS', 900, { min: 0, max: 10_000 })
}

function maxContentSurfaceVisits(): number {
  return readPositiveIntFromEnv('RETAIL_LIDER_MAX_CONTENT_SURFACE_VISITS', 320, { min: 0, max: 2000 })
}

function maxHrefsFromHome(): number {
  return readPositiveIntFromEnv('RETAIL_LIDER_MAX_HREFS_FROM_HOME', 8000, { min: 100, max: 30_000 })
}

function maxSitemapIndexChildren(): number {
  return readPositiveIntFromEnv('RETAIL_LIDER_MAX_SITEMAP_CHILDREN', 48, { min: 4, max: 200 })
}

function maxLocsPerSitemap(): number {
  return readPositiveIntFromEnv('RETAIL_LIDER_MAX_LOCS_PER_SITEMAP', 2500, { min: 50, max: 50_000 })
}

/** Tiempo máx. de todo el descubrimiento (sitemap + home + expansión content→browse). */
function discoveryAbortTimeoutMs(): number {
  return readPositiveIntFromEnv('RETAIL_LIDER_DISCOVERY_TIMEOUT_MS', 60_000, { min: 15_000, max: 3_600_000 })
}

function maxBrowseLinksPerHtml(): number {
  return readPositiveIntFromEnv('RETAIL_LIDER_MAX_BROWSE_LINKS_PER_HTML', 5000, { min: 200, max: 50_000 })
}

function maxLinkedContentUrlsPerHtml(): number {
  return readPositiveIntFromEnv('RETAIL_LIDER_MAX_LINKED_CONTENT_URLS_PER_HTML', 800, { min: 50, max: 5000 })
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
  // `/ip/` (Lider) no va aquí: se prioriza como semilla tipo listado en `isLikelyListingPath` para no quedar siempre al final del tope.
  return (
    /\/p\//.test(p) ||
    /\/product\//.test(p) ||
    (p.endsWith('.html') && p.split('/').filter(Boolean).length >= 3)
  )
}

function isLikelyListingPath(pathname: string): boolean {
  const p = pathname.toLowerCase()
  if (isJunkPathname(p)) return false
  // Lider: fichas y rutas de catálogo bajo `/ip/categoría/id` deben competir con `/browse/` en el plan de semillas.
  if (p.includes('/ip/')) return true
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
    p.includes('/departments') ||
    isLiderContentCommercialSurfacePath(p)
  )
}

/**
 * Landings comerciales `/content/{slug}/{id}` o sub-rutas con el mismo prefijo (id numérico en 3.er segmento).
 * No son PLP de productos: sirven para descubrir enlaces a `/browse/…`.
 */
function isLiderContentCommercialSurfacePath(pathname: string): boolean {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length < 3) return false
  if (parts[0]!.toLowerCase() !== 'content') return false
  // IDs VTEX / tienda suelen ser 5–8 dígitos; algunos hubs usan 4.
  return /^\d{4,14}$/.test(parts[2] ?? '')
}

function isLiderContentCommercialSurfaceUrl(href: string): boolean {
  try {
    return isLiderContentCommercialSurfacePath(new URL(href).pathname)
  } catch {
    return false
  }
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
      if (childCount++ >= maxSitemapIndexChildren()) break
      const inner = await fetchText(sm, signal)
      if (!inner) continue
      let nLoc = 0
      for (const u of extractLocTags(inner)) {
        if (nLoc++ >= maxLocsPerSitemap()) break
        const n = normalizeLiderStorefrontUrl(origin, u)
        if (n) collected.add(n)
      }
    }

    // Antes: `if (collected.size > 0) break` hacía que, si sitemap.xml devolvía algo, nunca se leía sitemap_index.xml (muchas URLs quedaban fuera).
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
    if (n++ > maxHrefsFromHome()) break
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

/**
 * Listados `/browse/sección/…/cola` enlazados desde HTML (landings content, home, etc.).
 * Exige al menos sección + categoría o colección tras `browse` para evitar solo el índice `/browse/{slug}`.
 */
function extractLiderBrowseListingUrlsFromHtml(html: string, pageUrl: string, originBase: string): string[] {
  const found = new Set<string>()
  const re = /href\s*=\s*["']([^"'#]*\/browse\/[^"'#?]+)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]?.trim()
    if (!raw) continue
    try {
      const abs = raw.startsWith('http') ? raw : new URL(raw, pageUrl).href
      const n = normalizeLiderStorefrontUrl(originBase, abs)
      if (!n) continue
      const u = new URL(n)
      const parts = u.pathname.split('/').filter(Boolean)
      const bi = parts.findIndex((p) => p.toLowerCase() === 'browse')
      if (bi < 0 || parts.length < bi + 3) continue
      found.add(n)
      if (found.size >= maxBrowseLinksPerHtml()) break
    } catch {
      /* skip */
    }
  }
  return [...found]
}

/** Otras landings `/content/{slug}/{id}/…` enlazadas desde una superficie content. */
function extractLiderLinkedContentSurfaceUrlsFromHtml(
  html: string,
  pageUrl: string,
  originBase: string,
): string[] {
  const found = new Set<string>()
  const re = /href\s*=\s*["']([^"'#]+)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]?.trim()
    if (!raw || !raw.toLowerCase().includes('/content/')) continue
    try {
      const abs = raw.startsWith('http') ? raw : new URL(raw, pageUrl).href
      const n = normalizeLiderStorefrontUrl(originBase, abs)
      if (!n || !isLiderContentCommercialSurfaceUrl(n)) continue
      found.add(n)
      if (found.size >= maxLinkedContentUrlsPerHtml()) break
    } catch {
      /* skip */
    }
  }
  return [...found]
}

/**
 * Recorre superficies `/content/…` (semillas + enlaces internos) y acumula URLs de listado `/browse/…`.
 * Cada HTML se descarga acotado en tiempo; no usa el mismo presupuesto global que sitemap/home.
 */
async function expandLiderContentSurfacesToBrowseListings(
  originBase: string,
  seedSurfaces: readonly string[],
  globalSignal: AbortSignal,
): Promise<string[]> {
  const browseFound = new Set<string>()
  const visitedPathKeys = new Set<string>()
  const queuedPathKeys = new Set<string>()
  const pending: string[] = []

  for (const u of dedupeByPath([...seedSurfaces])) {
    if (!isLiderContentCommercialSurfaceUrl(u)) continue
    const k = urlPathKey(u)
    if (!k || queuedPathKeys.has(k)) continue
    queuedPathKeys.add(k)
    pending.push(u)
  }

  while (
    pending.length > 0 &&
    visitedPathKeys.size < maxContentSurfaceVisits() &&
    !globalSignal.aborted
  ) {
    const batch: string[] = []
    while (batch.length < CONTENT_EXPAND_PARALLEL && pending.length > 0) {
      const next = pending.shift()!
      const k = urlPathKey(next)
      if (!k || visitedPathKeys.has(k)) continue
      visitedPathKeys.add(k)
      batch.push(next)
    }
    if (batch.length === 0) break

    const pages = await Promise.all(
      batch.map(async (url) => {
        try {
          const html = await fetchText(url, surfaceFetchSignal(globalSignal))
          return { url, html }
        } catch {
          return { url, html: null as string | null }
        }
      }),
    )

    for (const { url, html } of pages) {
      if (!html) continue
      for (const b of extractLiderBrowseListingUrlsFromHtml(html, url, originBase)) {
        browseFound.add(b)
        if (browseFound.size > 50_000) return [...browseFound]
      }
      for (const c of extractLiderLinkedContentSurfaceUrlsFromHtml(html, url, originBase)) {
        const ck = urlPathKey(c)
        if (!ck || visitedPathKeys.has(ck) || queuedPathKeys.has(ck)) continue
        queuedPathKeys.add(ck)
        pending.push(c)
      }
    }
  }

  return [...browseFound]
}

export type LiderCapturePlanDiscoveryMeta = {
  fromSitemap: number
  fromHomepage: number
  fromEnv: number
  fromFallback: number
  /** URLs `/browse/…` extraídas al leer HTML de landings `/content/{slug}/{id}`. */
  fromContentHubBrowse: number
  finalCount: number
}

/**
 * Descubre URLs de captura por capas (sin exigir `/browse` ni configuración del usuario).
 * @param storeOriginOverride Origen del storefront (p. ej. fila `retail.base_url`). Si falta, usa env o Lider por defecto.
 */
export async function discoverLiderCapturePlanUrls(storeOriginOverride?: string | null): Promise<{
  urls: string[]
  meta: LiderCapturePlanDiscoveryMeta
}> {
  const originRaw = (storeOriginOverride?.trim() || resolveLiderStoreBaseUrl()).trim()
  const origin = trimBase(originRaw)
  const ctl = new AbortController()
  const tm = setTimeout(() => ctl.abort(), discoveryAbortTimeoutMs())
  const meta: LiderCapturePlanDiscoveryMeta = {
    fromSitemap: 0,
    fromHomepage: 0,
    fromEnv: 0,
    fromFallback: 0,
    fromContentHubBrowse: 0,
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

    const surfacesForExpand = dedupeByPath(merged).filter(isLiderContentCommercialSurfaceUrl)
    const fromContentBrowse =
      surfacesForExpand.length > 0 && !ctl.signal.aborted ?
        await expandLiderContentSurfacesToBrowseListings(trimBase(origin), surfacesForExpand, ctl.signal)
      : []
    meta.fromContentHubBrowse = fromContentBrowse.length
    merged = dedupeByPath([...merged, ...fromContentBrowse])

    merged = sortSeedsByPriority(merged)
    // Sin esto, casi solo quedan `/browse/…` al aplicar el tope: muchos `/content/…` del sitemap caen fuera del plan.
    const contentSurfacesSticky = dedupeByPath(merged.filter(isLiderContentCommercialSurfaceUrl)).slice(
      0,
      maxContentSurfacesSticky(),
    )
    const sticky = dedupeByPath([
      ...liderContentHubSeedUrls(origin),
      ...fromEnv,
      ...contentSurfacesSticky,
    ])
    const mergedCountBeforeSeedCap = merged.length
    merged = applyMaxFinalSeedsKeepingSticky(merged, sticky, maxFinalSeeds())

    meta.finalCount = merged.length

    retailSweepLogInfo('plan captura Lider: descubrimiento', {
      ...(meta as unknown as Record<string, unknown>),
      limitsEffective: {
        maxSeedUrls: maxFinalSeeds(),
        maxContentSticky: maxContentSurfacesSticky(),
        maxContentSurfaceVisits: maxContentSurfaceVisits(),
        maxHrefsFromHome: maxHrefsFromHome(),
        maxSitemapChildren: maxSitemapIndexChildren(),
        maxLocsPerSitemap: maxLocsPerSitemap(),
        discoveryTimeoutMs: discoveryAbortTimeoutMs(),
        maxBrowseLinksPerHtml: maxBrowseLinksPerHtml(),
        maxLinkedContentUrlsPerHtml: maxLinkedContentUrlsPerHtml(),
      },
      envRaw: {
        RETAIL_LIDER_MAX_SEED_URLS: process.env.RETAIL_LIDER_MAX_SEED_URLS ?? null,
        RETAIL_LIDER_MAX_CONTENT_STICKY_SEEDS: process.env.RETAIL_LIDER_MAX_CONTENT_STICKY_SEEDS ?? null,
        RETAIL_LIDER_MAX_CONTENT_SURFACE_VISITS: process.env.RETAIL_LIDER_MAX_CONTENT_SURFACE_VISITS ?? null,
        RETAIL_LIDER_MAX_HREFS_FROM_HOME: process.env.RETAIL_LIDER_MAX_HREFS_FROM_HOME ?? null,
        RETAIL_LIDER_MAX_SITEMAP_CHILDREN: process.env.RETAIL_LIDER_MAX_SITEMAP_CHILDREN ?? null,
        RETAIL_LIDER_MAX_LOCS_PER_SITEMAP: process.env.RETAIL_LIDER_MAX_LOCS_PER_SITEMAP ?? null,
        RETAIL_LIDER_DISCOVERY_TIMEOUT_MS: process.env.RETAIL_LIDER_DISCOVERY_TIMEOUT_MS ?? null,
        RETAIL_LIDER_MAX_BROWSE_LINKS_PER_HTML: process.env.RETAIL_LIDER_MAX_BROWSE_LINKS_PER_HTML ?? null,
        RETAIL_LIDER_MAX_LINKED_CONTENT_URLS_PER_HTML: process.env.RETAIL_LIDER_MAX_LINKED_CONTENT_URLS_PER_HTML ?? null,
      },
      mergedCountBeforeSeedCap,
      mergedCountAfterSeedCap: merged.length,
      seedCapDidTrim: mergedCountBeforeSeedCap > merged.length,
    } as Record<string, unknown>)

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
  const { urls } = await discoverLiderCapturePlanUrls(null)
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
    // Landings comerciales `/content/{slug}/{id}` suelen traer grilla con `?page=` igual que `/browse/`.
    if (isLiderContentCommercialSurfacePath(p)) return true
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

export async function buildLiderFullCatalogPageSeeds(storeOriginOverride?: string | null): Promise<LiderPageSeed[]> {
  const { urls } = await discoverLiderCapturePlanUrls(storeOriginOverride)
  const originRaw = (storeOriginOverride?.trim() || resolveLiderStoreBaseUrl()).trim()
  const origin = trimBase(originRaw)
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
