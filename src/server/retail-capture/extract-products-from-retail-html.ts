/**
 * Fallback cuando solo hay página HTML de listados:
 * - JSON-LD (schema.org) en VTEX;
 * - `__NEXT_DATA__` / scripts `{"props"…}` como `lider/scraper.py` (super.lider.cl — Next.js Walmart Chile).
 */

export type HtmlListedProductExtract = {
  name: string
  price: number
  absoluteUrl?: string
  sku?: string
  brand?: string
}

function parseOfferPrice(offers: unknown): number | null {
  if (offers === null || offers === undefined) return null
  const arr = Array.isArray(offers) ? offers : [offers]
  for (const o of arr) {
    if (typeof o !== 'object' || o === null) continue
    const r = o as Record<string, unknown>
    const t = r['@type']
    const types = Array.isArray(t) ? t : t !== undefined ? [t] : []
    if (
      types.includes('AggregateOffer') &&
      typeof r.lowPrice === 'string' &&
      r.lowPrice.trim()
    ) {
      const n = Number.parseFloat(r.lowPrice.trim().replace(',', '.'))
      if (Number.isFinite(n) && n > 0) return n
    }
    const p = r.price
    if (typeof p === 'number' && Number.isFinite(p) && p > 0) return p
    if (typeof p === 'string' && p.trim()) {
      const n = Number.parseFloat(p.trim().replace(/[^\d.-]/g, '') || '')
      if (Number.isFinite(n) && n > 0) return n
    }
    const hp = r.highPrice
    if (typeof hp === 'string' && hp.trim()) {
      const n = Number.parseFloat(hp.trim().replace(',', '.'))
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return null
}

function slugFromVtPath(pathname: string): string | undefined {
  const parts = pathname.split('/').filter(Boolean)
  const lower = parts.map((s) => s.toLowerCase())
  const ipIdx = lower.indexOf('ip')
  if (ipIdx >= 0 && ipIdx + 1 < parts.length) {
    return parts[ipIdx + 1]!.replace(/\.html$/i, '')
  }
  const pIdx = parts.indexOf('p')
  if (pIdx >= 1) return parts[pIdx - 1]!.replace(/\.html$/i, '')
  const last = parts[parts.length - 1]
  return last?.replace(/\.html$/i, '') || undefined
}

function resolveHref(href: string | undefined, pageOrigin: string, pageUrl: string): string | undefined {
  if (!href || !href.trim()) return undefined
  try {
    return new URL(href.trim(), pageUrl).href
  } catch {
    try {
      return new URL(href.trim(), `${pageOrigin}/`).href
    } catch {
      return undefined
    }
  }
}

function ingestProductLike(
  o: Record<string, unknown>,
  pageOrigin: string,
  pageUrl: string,
  out: HtmlListedProductExtract[],
): void {
  const typesRaw = o['@type']
  const types = Array.isArray(typesRaw) ? typesRaw : typesRaw !== undefined ? [typesRaw] : []
  if (!types.includes('Product')) return

  const name =
    typeof o.name === 'string' && o.name.trim() ? o.name.trim()
    : typeof o.description === 'string' && o.description.trim().length < 200 ?
      o.description.trim()
    : null
  if (!name) return

  const price = parseOfferPrice(o.offers)
  if (price === null || price <= 0) return

  const urlRaw =
    typeof o.url === 'string' ? o.url
    : typeof o['@id'] === 'string' ? o['@id']
    : undefined
  const absoluteUrl = resolveHref(urlRaw, pageOrigin, pageUrl)

  const sku =
    typeof o.sku === 'string' && o.sku.trim() ? o.sku.trim()
    : typeof o.productID === 'string' && o.productID.trim() ? o.productID.trim()
    : undefined

  const brand =
    typeof o.brand === 'string' && o.brand.trim() ? o.brand.trim()
    : typeof o.brand === 'object' &&
        o.brand !== null &&
        typeof (o.brand as Record<string, unknown>).name === 'string' ?
      String((o.brand as Record<string, unknown>).name).trim()
    : undefined

  out.push({ name, price, absoluteUrl, sku, brand })
}

function walkJsonLdNode(
  node: unknown,
  pageOrigin: string,
  pageUrl: string,
  out: HtmlListedProductExtract[],
): void {
  if (node === null || node === undefined) return
  if (Array.isArray(node)) {
    for (const n of node) walkJsonLdNode(n, pageOrigin, pageUrl, out)
    return
  }
  if (typeof node !== 'object') return
  const o = node as Record<string, unknown>

  ingestProductLike(o, pageOrigin, pageUrl, out)

  const typesRaw = o['@type']
  const types = Array.isArray(typesRaw) ? typesRaw : typesRaw !== undefined ? [typesRaw] : []
  if (types.includes('ItemList') && Array.isArray(o.itemListElement)) {
    for (const el of o.itemListElement) {
      if (el !== null && typeof el === 'object') {
        const r = el as Record<string, unknown>
        walkJsonLdNode(r.item, pageOrigin, pageUrl, out)
        walkJsonLdNode(r, pageOrigin, pageUrl, out)
      }
    }
  }

  for (const k of ['@graph', 'mainEntity', 'item', 'hasPart']) {
    if (k in o) walkJsonLdNode(o[k], pageOrigin, pageUrl, out)
  }
}

function parseJsonLdBlocks(html: string, pageUrl: string, out: HtmlListedProductExtract[]): void {
  let origin = ''
  try {
    origin = new URL(pageUrl).origin
  } catch {
    origin = ''
  }

  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]?.trim()
    if (!raw) continue
    try {
      const parsed: unknown = JSON.parse(raw)
      walkJsonLdNode(parsed, origin, pageUrl, out)
    } catch {
      // bloque truncado o no JSON
    }
  }
}

/** Equivalente práctico a `parse_clp` en scripts/import_lider_sqlite.py: solo dígitos → valor CLP entero. */
function parseDigitsClpPrice(raw: unknown): number | null {
  if (typeof raw !== 'string') return null
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null
  const n = Number.parseInt(digits, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Busca itemStacks en TODAS las keys de initialData y acumula, no solo la primera. */
function collectItemStacksFromInitialData(initial: Record<string, unknown> | undefined): unknown[] | null {
  if (!initial) return null
  const keys = [
    'searchResult', 'browseResult', 'categoryResult', 'shelfResult', 'departmentResult',
    'listingResult', 'plpResult', 'productResult',
    'search', 'browse', 'category', 'shelf', 'department', 'listing', 'plp', 'products',
  ]
  const allStacks: unknown[] = []
  for (const key of keys) {
    const raw = initial[key]
    const block = Array.isArray(raw) ? raw[0] : raw
    if (block !== null && typeof block === 'object') {
      const b = block as Record<string, unknown>
      const stacks = b.itemStacks
      if (Array.isArray(stacks)) {
        for (const s of stacks) allStacks.push(s)
      }
      const items = b.items ?? b.products
      if (Array.isArray(items) && items.length > 0) {
        allStacks.push({ items } as never)
      }
    }
  }
  return allStacks.length > 0 ? allStacks : null
}

function ingestItem(rawItem: unknown, pageOrigin: string, pageUrl: string): HtmlListedProductExtract | null {
  if (!rawItem || typeof rawItem !== 'object') return null
  const item = rawItem as Record<string, unknown>
  const tn = typeof item.__typename === 'string' ? item.__typename : ''
  if (tn === 'TileTakeOverProductPlaceholder' || tn === 'AdPlaceholder') return null
  // No descartar por `__typename` vacío: en algunos SSR de Lider los tiles traen precio/nombre sin tipo.

  const name =
    (typeof item.name === 'string' && item.name.trim() ? item.name.trim() : '') ||
    (typeof item.title === 'string' && item.title.trim() ? item.title.trim() : '') ||
    (typeof item.productTitle === 'string' && item.productTitle.trim() ? item.productTitle.trim() : '')
  if (!name) return null

  let priceNum: number | null = null
  const pi = item.priceInfo
  if (pi !== null && typeof pi === 'object') {
    const pir = pi as Record<string, unknown>
    const keys = ['linePrice', 'currentPrice', 'displayPrice', 'listPrice', 'unitPrice'] as const
    for (const key of keys) {
      const v = pir[key]
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        priceNum = v
        break
      }
      if (typeof v === 'string') {
        priceNum = parseDigitsClpPrice(v)
        if (priceNum !== null) break
      }
    }
  }
  if (priceNum === null && typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0) {
    priceNum = item.price
  }
  if (priceNum === null && typeof item.currentPrice === 'number' && Number.isFinite(item.currentPrice)) {
    priceNum = item.currentPrice > 0 ? item.currentPrice : null
  }
  if (priceNum === null) return null
  const price = priceNum

  const cu = typeof item.canonicalUrl === 'string' ? item.canonicalUrl.trim() : ''
  let absoluteUrl: string | undefined
  if (cu) {
    absoluteUrl = cu.startsWith('http') ?
      cu
    : pageOrigin ?
      `${pageOrigin.replace(/\/+$/, '')}${cu.startsWith('/') ? cu : `/${cu}`}`
    : resolveHref(cu, pageOrigin, pageUrl)
  }

  const id =
    item.id !== undefined && item.id !== null ? String(item.id)
    : item.usItemId !== undefined && item.usItemId !== null ? String(item.usItemId)
    : undefined

  const brand =
    typeof item.brand === 'string' && item.brand.trim() ? item.brand.trim()
    : typeof item.manufacturerName === 'string' && item.manufacturerName.trim() ?
      item.manufacturerName.trim()
    : undefined

  return { name, price, absoluteUrl, sku: id, brand }
}

function ingestNextSearchStacks(
  parsed: Record<string, unknown>,
  pageOrigin: string,
  pageUrl: string,
  out: HtmlListedProductExtract[],
): void {
  const props = parsed.props as Record<string, unknown> | undefined
  const pageProps = props?.pageProps as Record<string, unknown> | undefined
  const initial = pageProps?.initialData as Record<string, unknown> | undefined
  const stacks = collectItemStacksFromInitialData(initial)
  if (stacks) {
    for (const stack of stacks) {
      if (!stack || typeof stack !== 'object') continue
      const items = (stack as Record<string, unknown>).items
      if (!Array.isArray(items)) continue
      for (const rawItem of items) {
        const p = ingestItem(rawItem, pageOrigin, pageUrl)
        if (p) out.push(p)
      }
    }
  }

  if (pageProps && !stacks) {
    const page = pageProps.page as Record<string, unknown> | undefined
    if (page) {
      const modules = page.pageModules ?? page.modules
      if (Array.isArray(modules)) {
        for (const mod of modules) {
          if (!mod || typeof mod !== 'object') continue
          const items = (mod as Record<string, unknown>).items ?? (mod as Record<string, unknown>).products
          if (!Array.isArray(items)) continue
          for (const rawItem of items) {
            const p = ingestItem(rawItem, pageOrigin, pageUrl)
            if (p) out.push(p)
          }
        }
      }
    }
  }
}

/**
 * Jumbo.cl / Cencosud: listados SSR en `<script id="__REACT_QUERY_STATE__">` (React Query dehydrate),
 * no en APIs VTEX públicas ni en `/busca` (muchas veces devuelve el shell sin shelf).
 */
function ingestReactQueryShelfProducts(
  parsed: Record<string, unknown>,
  pageOrigin: string,
  _pageUrl: string,
  out: HtmlListedProductExtract[],
): void {
  const ds = parsed.dehydratedState as Record<string, unknown> | undefined
  const queries = ds?.queries
  if (!Array.isArray(queries)) return

  for (const q of queries) {
    if (!q || typeof q !== 'object') continue
    const state = (q as Record<string, unknown>).state as Record<string, unknown> | undefined
    const data = state?.data as Record<string, unknown> | undefined
    const products = data?.products
    if (!Array.isArray(products)) continue

    for (const raw of products) {
      if (!raw || typeof raw !== 'object') continue
      const prod = raw as Record<string, unknown>
      const items = prod.items
      if (!Array.isArray(items) || items.length === 0) continue
      const first = items[0] as Record<string, unknown>
      const price =
        typeof first.price === 'number' && Number.isFinite(first.price) && first.price > 0 ?
          first.price
        : null
      if (price === null) continue

      const itemName = typeof first.name === 'string' && first.name.trim() ? first.name.trim() : ''
      const slug = typeof prod.slug === 'string' && prod.slug.trim() ? prod.slug.trim() : ''
      const name = itemName || slug.replace(/-/g, ' ')
      if (!name) continue

      const brand =
        typeof prod.brand === 'string' && prod.brand.trim() ? prod.brand.trim() : undefined

      const sku =
        prod.reference !== undefined && prod.reference !== null ? String(prod.reference)
        : prod.productId !== undefined && prod.productId !== null ? String(prod.productId)
        : undefined

      let absoluteUrl: string | undefined
      if (slug && pageOrigin) {
        absoluteUrl = `${pageOrigin.replace(/\/+$/, '')}/${slug}/p`
      }

      out.push({ name, price, absoluteUrl, sku, brand })
    }
  }
}

function parseReactQueryStateScript(html: string, pageUrl: string, out: HtmlListedProductExtract[]): void {
  let origin = ''
  try {
    origin = new URL(pageUrl).origin
  } catch {
    origin = ''
  }

  const tagged =
    /<script[^>]*\bid=["']__REACT_QUERY_STATE__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html)
  if (!tagged?.[1]) return
  try {
    const parsed = JSON.parse(tagged[1].trim()) as Record<string, unknown>
    ingestReactQueryShelfProducts(parsed, origin, pageUrl, out)
  } catch {
    /* JSON truncado o distinto layout */
  }
}

/**
 * Scripts Next.js tipo `lider/fast_scraper.py` y `<script id="__NEXT_DATA__">`.
 */
function parseEmbeddedNextShopData(html: string, pageUrl: string, out: HtmlListedProductExtract[]): void {
  let origin = ''
  try {
    origin = new URL(pageUrl).origin
  } catch {
    origin = ''
  }

  const tagged = /<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html)
  if (tagged?.[1]) {
    try {
      const parsed = JSON.parse(tagged[1].trim()) as Record<string, unknown>
      ingestNextSearchStacks(parsed, origin, pageUrl, out)
    } catch {
      /* siguiente */
    }
  }

  for (const [, body] of Array.from(html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi))) {
    const t = body?.trimStart()
    if (!t?.startsWith('{"props"')) continue
    try {
      const parsed = JSON.parse(t) as Record<string, unknown>
      ingestNextSearchStacks(parsed, origin, pageUrl, out)
    } catch {
      /* siguiente script */
    }
  }
}

/**
 * Intenta extraer productos directamente del HTML renderizado (DOM).
 * Útil cuando __NEXT_DATA__ no tiene todos los productos o la página tiene una estructura distinta.
 */
function extractProductsFromRenderedHtml(
  html: string,
  pageUrl: string,
  out: HtmlListedProductExtract[],
): void {
  const origin = (() => { try { return new URL(pageUrl).origin } catch { return '' } })()
  if (!origin) return

  const before = out.length

  const priceRe = /\$\s*[\d.]+(?:\.?\d{3})*/g
  const clpParse = (raw: string): number | null => {
    const d = raw.replace(/[^\d]/g, '')
    const n = Number.parseInt(d, 10)
    return Number.isFinite(n) && n > 100 ? n : null
  }

  const visitedHrefs = new Set<string>()

  const anchorRe = /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1]?.trim()
    if (!href) continue
    if (!/\/([^\/]+)\/p(?:\?|$)/.test(href) && !/\/product\//.test(href)) continue

    try {
      const abs = href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`
      const absLower = abs.toLowerCase()
      if (visitedHrefs.has(absLower)) continue
      visitedHrefs.add(absLower)

      const inner = m[2]
      const nameMatch = inner ? /<[^>]*>([^<]+)<\/[^>]*>/.exec(inner) : null
      let name = nameMatch ? nameMatch[1]?.trim() : ''
      if (!name || name.length > 120) {
        const textBits = inner.replace(/<[^>]*>/g, '').trim()
        if (textBits && textBits.length < 120) name = textBits
      }
      if (!name) {
        const slug = /\/([^\/]+)\/p(?:\?|$)/.exec(href)
        if (slug) name = slug[1]!.replace(/-/g, ' ')
      }
      if (!name || name.length < 2 || name.length > 150) continue

      const windowStart = Math.max(0, m.index - 500)
      const windowEnd = Math.min(html.length, m.index + m[0].length + 500)
      const context = html.slice(windowStart, windowEnd)

      let price: number | null = null
      const priceMatches = Array.from(context.matchAll(priceRe))
      for (const pm of priceMatches) {
        const p = clpParse(pm[0])
        if (p !== null) {
          price = p
          break
        }
      }
      if (price === null) continue

      const slug = /\/([^\/]+)\/p(?:\?|$)/.exec(abs)
      const sku = slug ? slug[1]!.replace(/[^a-zA-Z0-9_-]/g, '') : undefined

      out.push({ name, price, absoluteUrl: abs, sku, brand: undefined })
    } catch {
      continue
    }
  }

  const added = out.length - before
  if (added > 0 && process.env.NODE_ENV === 'development') {
    console.log(`[HTML-DOM] ${pageUrl.slice(0, 80)} → ${added} prod from DOM`)
  }
}

function dedupeByUrlOrName(out: HtmlListedProductExtract[]): HtmlListedProductExtract[] {
  const seen = new Set<string>()
  const res: HtmlListedProductExtract[] = []
  for (const p of out) {
    const key = (p.absoluteUrl ?? p.name).toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(key)) continue
    seen.add(key)
    res.push(p)
  }
  return res
}

/**
 * Convierte extracción HTML→objeto cercano al shape VTEX catalog para reutilizar mapVtexProductToSnapshot.
 */
export function htmlListedProductToSyntheticVtex(p: HtmlListedProductExtract): Record<string, unknown> {
  let linkText: string | undefined
  if (p.absoluteUrl) {
    try {
      const u = new URL(p.absoluteUrl)
      linkText =
        slugFromVtPath(u.pathname) ??
        (u.pathname.split('/').filter(Boolean).slice(-2, -1)[0] || undefined)
    } catch {
      linkText = undefined
    }
  }

  return {
    productName: p.name,
    productId: p.sku,
    brand: p.brand,
    linkText,
    items: [
      {
        sellers: [
          {
            commertialOffer: { Price: p.price },
          },
        ],
      },
    ],
  }
}

/** Intenta obtener productos con precio desde HTML de página de tienda listada. */
export function extractListedProductsFromRetailHtml(html: string, pageUrl: string): HtmlListedProductExtract[] {
  if (!html || html.length < 50) return []
  const out: HtmlListedProductExtract[] = []
  parseJsonLdBlocks(html, pageUrl, out)
  parseEmbeddedNextShopData(html, pageUrl, out)
  parseReactQueryStateScript(html, pageUrl, out)
  extractProductsFromRenderedHtml(html, pageUrl, out)
  const result = dedupeByUrlOrName(out)
  if (process.env.NODE_ENV === 'development')
    console.log(`[HTML] ${pageUrl.slice(0, 80)} → ${result.length} prod`)
  return result
}
