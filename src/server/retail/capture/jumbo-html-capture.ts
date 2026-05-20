/**
 * Captura de páginas Jumbo vía HTML scraping.
 * Jumbo usa VTEX pero las páginas de categoría (/despensa) devuelven HTML,
 * no JSON como los endpoints de intelligent-search.
 */

import { extractProductsFromJumboShelfHtml, isJumboHtmlCategoryUrl as _isJumboHtmlCategoryUrl } from './jumbo-html-parser'

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

/**
 * Captura una página de categoría Jumbo (HTML shelf).
 * Ej: https://www.jumbo.cl/despensa, https://www.jumbo.cl/despensa?page=2
 */
export async function captureJumboHtmlPage(
  pageUrl: string,
  sectionSlug: string,
): Promise<JumboCaptureResult> {
  try {
    const resp = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0',
      },
      signal: AbortSignal.timeout(30_000),
    })

    if (!resp.ok) {
      return { ok: false, error: `Error HTTP (${resp.status})` }
    }

    const html = await resp.text()

    // Debug: log HTML size and check for common patterns
    console.log(`[jumbo-capture] HTML size: ${html.length} bytes for ${pageUrl}`)
    console.log(`[jumbo-capture] Has data-product-id: ${html.includes('data-product-id')}`)
    console.log(`[jumbo-capture] Has JSON-LD: ${html.includes('application/ld+json')}`)
    console.log(`[jumbo-capture] Has shelf-item: ${html.includes('shelf-item')}`)
    console.log(`[jumbo-capture] Has Product class: ${html.includes('class="Product"') || html.includes("class='Product'")}`)

    // Extraer productos del HTML
    const products = extractProductsFromJumboShelfHtml(html, pageUrl)

    if (products.length === 0) {
      // Debug: save HTML snippet for analysis
      const snippet = html.slice(0, 2000)
      console.log(`[jumbo-capture] HTML snippet (first 2000 chars):`, snippet)
      return { ok: false, error: 'No se encontraron productos en la página' }
    }

    const snapshots: JumboProductSnapshot[] = products.map((p: { productId: string; name: string; brand: string | null; price: number | null; productUrl: string | null; imageUrl: string | null }) => ({
      external_ref: p.productId,
      source_url: p.productUrl,
      title: p.name,
      brand_hint: p.brand,
      price: p.price,
      unit_price: p.price,
      category_hint: sectionSlug,
      description_hint: null,
      image_url: p.imageUrl,
      listing_url: pageUrl,
      sections: sectionSlug,
      categories: null,
    }))

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
        rawProductCount: products.length,
      },
    }
  } catch (e) {
    return { ok: false, error: `Error de red: ${e instanceof Error ? e.message : String(e)}` }
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
