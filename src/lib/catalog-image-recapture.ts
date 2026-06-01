/**
 * Recaptura la imagen de un producto haciendo fetch a su product_url.
 * Útil cuando la URL guardada en scrapping.image_url expiró.
 */

/**
 * Hace fetch a la página del producto, extrae el JSON embebido (VTEX / Next.js),
 * y busca una URL de imagen fresca.
 */
export async function recaptureProductImageUrl(productUrl: string): Promise<string | null> {
  try {
    const resp = await fetch(productUrl, {
      signal: AbortSignal.timeout(12_000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })
    if (!resp.ok) return null

    const html = await resp.text()

    // 1) Intentar __NEXT_DATA__ (Next.js / Lider)
    const nextMatch = /<script[^>]*\bid=["']?__NEXT_DATA__["']?[^>]*>([\s\S]*?)<\/script>/i.exec(html)
    if (nextMatch?.[1]) {
      try {
        const parsed = JSON.parse(nextMatch[1].trim()) as unknown
        const url = extractImageUrlFromJson(parsed)
        if (url) return url
      } catch {
        /* siguiente */
      }
    }

    // 2) Intentar scripts tipo {"props":...} (VTEX / Lider legacy)
    for (const [, body] of Array.from(html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi))) {
      const t = body?.trimStart()
      if (!t?.startsWith('{"props"')) continue
      try {
        const parsed = JSON.parse(t) as unknown
        const url = extractImageUrlFromJson(parsed)
        if (url) return url
      } catch {
        /* siguiente */
      }
    }

    // 3) Fallback: buscar URL de imagen VTEX en el HTML crudo
    const vtexImg = /https:\/\/[^"'\s]+\/arquivos\/ids\/\d+[^"'\s]*/.exec(html)
    if (vtexImg?.[0]) return vtexImg[0]

    return null
  } catch {
    return null
  }
}

/** Busca imageUrl recursivamente en un JSON parseado. */
function extractImageUrlFromJson(obj: unknown): string | null {
  if (obj == null) return null
  if (typeof obj === 'string') {
    // URLs típicas de imagen
    if (/\.(jpe?g|png|webp)(\?|$)/i.test(obj) && obj.startsWith('http')) {
      return obj
    }
    return null
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = extractImageUrlFromJson(item)
      if (found) return found
    }
    return null
  }
  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>
    // Priorizar campos conocidos de VTEX
    for (const key of ['imageUrl', 'image_url', 'ImageUrl', 'Image']) {
      const v = record[key]
      if (typeof v === 'string' && v.startsWith('http')) {
        if (/\.(jpe?g|png|webp)(\?|$)/i.test(v)) return v
      }
    }
    for (const v of Object.values(record)) {
      const found = extractImageUrlFromJson(v)
      if (found) return found
    }
  }
  return null
}
