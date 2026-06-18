/**
 * Captura de productos Jumbo vía API BFF (Backend For Frontend).
 * Endpoint: https://bff.jumbo.cl/catalog/plp
 * Este es el mismo endpoint que usa el sitio web de Jumbo para cargar productos.
 * Soporta paginación real vía from/to (bloques de 40 productos).
 */

import { isJumboHtmlCategoryUrl as _isJumboHtmlCategoryUrl } from './jumbo-html-parser'

// Re-exportar para uso externo
export { _isJumboHtmlCategoryUrl as isJumboHtmlCategoryUrl }

export type JumboPageSeed = {
  page_url: string
  page_index: number
  section_slug: string
  page_number: number
}

export type JumboCaptureResult =
  | {
      ok: true
      data: {
        snapshots: JumboProductSnapshot[]
        stagingRows: StagingRow[]
        rawProductCount: number
      }
    }
  | { ok: false; error: string }

type StagingRow = {
  external_ref: string
  source_url: string | null
  title: string
  brand: string | null
  price: number | null
  unit_price: number | null
  category_hint: string | null
  description_hint: string | null
  image_url: string | null
}

export type JumboProductSnapshot = {
  external_ref: string
  source_url: string | null
  title: string
  brand_hint: string | null
  price: number | null
  unit_price: number | null
  category_hint: string | null
  description_hint: string | null
  image_url: string | null
  listing_url: string
  sections: string | null
  categories: string | null
}

// ===== Constantes del API BFF de Jumbo =====
const JUMBO_BFF_URL = 'https://bff.jumbo.cl/catalog/plp'
const JUMBO_BFF_APIKEY = process.env.JUMBO_BFF_APIKEY ?? ''
const JUMBO_BFF_STORE = 'jumboclj512'
const JUMBO_BFF_CLIENT_VERSION = '3.3.84'
/** Productos por bloque (la web usa 40). */
const JUMBO_PAGE_SIZE = 40
/** Tope de seguridad de bloques por categoría (40 * 250 = 10.000 productos máx). */
const JUMBO_MAX_BLOCKS = 250

type JumboBffItem = {
  skuId?: string
  price?: number
  listPrice?: number
  images?: string[]
  name?: string
}

type JumboBffProduct = {
  productId?: string
  reference?: string
  slug?: string
  brand?: string
  categoryNames?: string[]
  items?: JumboBffItem[]
}

type JumboBffResponse = {
  products?: JumboBffProduct[]
}

/**
 * Genera un UUID v4 simple (sin dependencias) para el header x-trace-id.
 */
function genTraceId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Convierte una URL de categoría Jumbo al formato de facet del API.
 * Ej: https://www.jumbo.cl/despensa/fideos-pastas-y-salsas?page=2
 *   → /despensa/fideos-pastas-y-salsas
 */
function categoryPathFromUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname.replace(/\/+$/, '') || '/'
  } catch {
    return '/'
  }
}

/**
 * Hace una llamada al API BFF de Jumbo para un bloque de productos.
 */
async function fetchJumboBffBlock(
  categoryPath: string,
  from: number,
  to: number,
): Promise<JumboBffResponse | { error: string }> {
  try {
    const resp = await fetch(JUMBO_BFF_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'es-CL,es;q=0.9',
        'content-type': 'application/json',
        apikey: JUMBO_BFF_APIKEY,
        'x-client-platform': 'web',
        'x-client-version': JUMBO_BFF_CLIENT_VERSION,
        'x-trace-id': genTraceId(),
        origin: 'https://www.jumbo.cl',
        referer: 'https://www.jumbo.cl/',
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        store: JUMBO_BFF_STORE,
        collections: [],
        fullText: '',
        brands: [],
        hideUnavailableItems: false,
        from,
        to,
        orderBy: '',
        selectedFacets: [{ key: 'category2', value: categoryPath }],
        promotionalCards: false,
        sponsoredProducts: false,
      }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!resp.ok) {
      return { error: `HTTP ${resp.status}` }
    }
    return (await resp.json()) as JumboBffResponse
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Mapea un producto del API BFF al formato interno.
 */
function mapBffProduct(p: JumboBffProduct, sectionSlug: string): JumboProductSnapshot | null {
  const reference = String(p.reference || p.productId || '').trim()
  if (!reference) return null

  const item = Array.isArray(p.items) ? p.items[0] : undefined
  const name = (item?.name || '').trim()
  if (!name) return null

  const price = typeof item?.price === 'number' && item.price > 0 ? item.price : null
  const slug = typeof p.slug === 'string' ? p.slug : ''
  const productUrl = slug ? `https://www.jumbo.cl/${slug}/p` : null
  const imageUrl = Array.isArray(item?.images) && typeof item.images[0] === 'string' ? item.images[0] : null
  const brand = typeof p.brand === 'string' ? p.brand.trim() || null : null

  return {
    external_ref: reference,
    source_url: productUrl,
    title: name,
    brand_hint: brand,
    price,
    unit_price: price,
    category_hint: sectionSlug,
    description_hint: null,
    image_url: imageUrl,
    listing_url: '',
    sections: sectionSlug,
    categories: null,
  }
}

/**
 * Captura TODOS los productos de una categoría Jumbo vía API BFF, paginando
 * automáticamente con from/to hasta agotar la categoría.
 *
 * @param pageUrl URL de la categoría (ej: https://www.jumbo.cl/despensa/fideos-pastas-y-salsas)
 * @param sectionSlug Slug de la sección principal (para category_hint)
 */
export async function captureJumboHtmlPage(
  pageUrl: string,
  sectionSlug: string,
): Promise<JumboCaptureResult> {
  const categoryPath = categoryPathFromUrl(pageUrl)

  const snapshots: JumboProductSnapshot[] = []
  const seen = new Set<string>()
  let lastError = ''

  for (let block = 0; block < JUMBO_MAX_BLOCKS; block++) {
    const from = block * JUMBO_PAGE_SIZE
    const to = from + JUMBO_PAGE_SIZE

    const result = await fetchJumboBffBlock(categoryPath, from, to)

    if ('error' in result) {
      lastError = result.error
      // Si el primer bloque falla, abortar; si falla uno posterior, devolver lo acumulado.
      if (block === 0) {
        return { ok: false, error: `Error API Jumbo BFF: ${lastError}` }
      }
      break
    }

    const products = Array.isArray(result.products) ? result.products : []
    if (products.length === 0) break

    let newInThisBlock = 0
    for (const p of products) {
      const mapped = mapBffProduct(p, sectionSlug)
      if (!mapped) continue
      if (seen.has(mapped.external_ref)) continue
      seen.add(mapped.external_ref)
      mapped.listing_url = pageUrl
      snapshots.push(mapped)
      newInThisBlock++
    }

    // Si el bloque trajo menos del tamaño completo, es la última página.
    if (products.length < JUMBO_PAGE_SIZE) break
    // Si no aportó productos nuevos, evitar loop infinito.
    if (newInThisBlock === 0) break
  }

  if (snapshots.length === 0) {
    return { ok: false, error: lastError || 'No se encontraron productos en la categoría' }
  }

  console.log(`[jumbo-bff] ${categoryPath}: ${snapshots.length} productos capturados`)

  const stagingRows: StagingRow[] = snapshots.map((s) => ({
    external_ref: s.external_ref,
    source_url: s.source_url,
    title: s.title,
    brand: s.brand_hint,
    price: s.price,
    unit_price: s.unit_price,
    category_hint: s.category_hint,
    description_hint: s.description_hint,
    image_url: s.image_url,
  }))

  return {
    ok: true,
    data: {
      snapshots,
      stagingRows,
      rawProductCount: snapshots.length,
    },
  }
}

/**
 * Particiona el resultado de captura Jumbo para insert limpio.
 */
export function partitionJumboCaptureForCleanInsert(input: {
  snapshots: JumboProductSnapshot[]
  stagingRows: StagingRow[]
  rawProductCount: number
}): {
  cleanStaging: StagingRow[]
  productsFound: number
} {
  const cleanStaging = input.stagingRows.filter(
    (r) => r.title?.trim() && r.external_ref?.trim(),
  )

  return {
    cleanStaging,
    productsFound: input.rawProductCount,
  }
}
