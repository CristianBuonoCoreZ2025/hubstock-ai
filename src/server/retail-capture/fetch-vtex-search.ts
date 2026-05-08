/**
 * Búsqueda catálogo público estilo VTEX (path /api/catalog_system/pub/products/search/{term}).
 */

export type VtexFetchResult =
  | { ok: true; products: unknown[] }
  | { ok: false; reason: 'not_json' | 'http_error' | 'network'; status?: number }

function trimBase(url: string): string {
  return url.replace(/\/+$/, '')
}

export async function fetchVtexSearchProducts(
  baseUrl: string,
  query: string,
  maxItems: number,
): Promise<VtexFetchResult> {
  const base = trimBase(baseUrl)
  const q = query.trim()
  const to = Math.max(0, Math.min(maxItems, 100) - 1)
  const url = `${base}/api/catalog_system/pub/products/search/${encodeURIComponent(q)}?_from=0&_to=${to}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25_000)

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })

    if (!res.ok) {
      return { ok: false, reason: 'http_error', status: res.status }
    }

    const text = await res.text()
    const trimmed = text.trim()
    if (trimmed.startsWith('<')) {
      return { ok: false, reason: 'not_json' }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return { ok: false, reason: 'not_json' }
    }

    if (!Array.isArray(parsed)) {
      return { ok: false, reason: 'not_json' }
    }

    return { ok: true, products: parsed }
  } catch (e) {
    const name = e instanceof Error ? e.name : ''
    if (name === 'AbortError') {
      return { ok: false, reason: 'network' }
    }
    return { ok: false, reason: 'network' }
  } finally {
    clearTimeout(timeout)
  }
}

export function resolveVtexBaseUrlForRetailer(
  retailer: 'jumbo' | 'lider' | 'central_mayorista',
): string | null {
  if (retailer === 'jumbo') {
    const fromEnv = process.env.RETAIL_JUMBO_VTEX_BASE_URL?.trim()
    return fromEnv || 'https://www.jumbo.cl'
  }
  if (retailer === 'lider') {
    return process.env.RETAIL_LIDER_VTEX_BASE_URL?.trim() || null
  }
  return process.env.RETAIL_CENTRAL_MAYORISTA_VTEX_BASE_URL?.trim() || null
}
