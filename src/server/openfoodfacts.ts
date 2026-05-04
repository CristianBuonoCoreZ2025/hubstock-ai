/**
 * Cliente de lectura para Open Food Facts (sin API key).
 * Respetar https://openfoodfacts.org/terms-of-use y límites de uso.
 */

const OFF_BASE = 'https://world.openfoodfacts.net'
const USER_AGENT =
  'StockCasaAI/0.1 (inventory app; https://openfoodfacts.org/terms-of-use)'

type OffApiProduct = {
  product_name?: string
  product_name_es?: string
  brands?: string
  quantity?: string
  categories_tags?: string[]
  code?: string
}

type OffApiResponse = {
  status?: number
  status_verbose?: string
  product?: OffApiProduct
}

export type OpenFoodFactsProduct = {
  code: string
  name: string | null
  brand: string | null
  quantityLabel: string | null
  categoriesTags: string[]
}

type CacheEntry = { value: OpenFoodFactsProduct | null; expiresAt: number }

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CACHE_MAX = 400
const cache = new Map<string, CacheEntry>()

/** Quita caracteres no numéricos; null si no parece un GTIN válido. */
export function normalizeGtin(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 14) return null
  return digits
}

/**
 * Extrae el primer candidato a código de barras en texto (boleta, descripción).
 */
export function extractGtinFromText(text: string | null | undefined): string | null {
  if (!text || typeof text !== 'string') return null
  const matches = text.match(/\d{8,14}/g)
  if (!matches?.length) return null
  for (const m of matches) {
    const n = normalizeGtin(m)
    if (n) return n
  }
  return null
}

function touchCache(key: string, value: OpenFoodFactsProduct | null) {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value as string | undefined
    if (first) cache.delete(first)
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
}

function getCached(code: string): OpenFoodFactsProduct | null | undefined {
  const e = cache.get(code)
  if (!e) return undefined
  if (Date.now() > e.expiresAt) {
    cache.delete(code)
    return undefined
  }
  return e.value
}

function pickName(p: OffApiProduct): string | null {
  const es = p.product_name_es?.trim()
  if (es) return es
  const n = p.product_name?.trim()
  return n || null
}

function mapProduct(code: string, p: OffApiProduct): OpenFoodFactsProduct {
  const brands = p.brands?.split(',')?.map((b) => b.trim()).filter(Boolean) ?? []
  return {
    code,
    name: pickName(p),
    brand: brands[0] ?? null,
    quantityLabel: p.quantity?.trim() || null,
    categoriesTags: Array.isArray(p.categories_tags) ? p.categories_tags : [],
  }
}

/** Consulta Open Food Facts por código (GTIN). Devuelve null si no existe o falla la red. */
export async function fetchOpenFoodFactsProduct(
  gtin: string
): Promise<OpenFoodFactsProduct | null> {
  const code = normalizeGtin(gtin)
  if (!code) return null

  const memo = getCached(code)
  if (memo !== undefined) return memo

  const url = `${OFF_BASE}/api/v2/product/${encodeURIComponent(code)}?fields=code,product_name,product_name_es,brands,quantity,categories_tags`

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    })
    if (!res.ok) {
      touchCache(code, null)
      return null
    }
    const body = (await res.json()) as OffApiResponse
    if (body.status !== 1 || !body.product) {
      touchCache(code, null)
      return null
    }
    const mapped = mapProduct(body.product.code ?? code, body.product)
    touchCache(code, mapped)
    return mapped
  } catch {
    touchCache(code, null)
    return null
  }
}
