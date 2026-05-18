/**
 * Captura de páginas VTEX (Jumbo, Central Mayorista).
 * Usa el fetcher existente en retail-capture/fetch-vtex-search.ts
 */

import {
  fetchVtexSearchProductsPage,
  type VtexFetchResult,
} from '@/server/retail-capture/fetch-vtex-search'
import { mapVtexProductList, type RetailSnapshotRow } from '@/server/retail-capture/map-vtex-product'
import type { VtexPageSeed } from './vtex-catalog-plan'
import { isVtexIntelligentSearchUrl, isVtexHtmlShelfUrl } from './vtex-catalog-plan'

export type VtexCaptureResult =
  | {
      ok: true
      data: {
        snapshots: RetailSnapshotRow[]
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

/**
 * Captura una página VTEX (cualquier endpoint: intelligent-search, catalog_system, o HTML shelf).
 */
export async function captureVtexRetailPage(
  seed: VtexPageSeed,
  retailer: 'jumbo' | 'central_mayorista',
): Promise<VtexCaptureResult> {
  const baseUrl = seed.page_url.match(/^https?:\/\/[^\/]+/)?.[0] ?? ''

  let result: VtexFetchResult
  try {
    result = await fetchVtexSearchProductsPage(
      baseUrl,
      seed.query ?? '',
      seed.page_index * 20, // offset aproximado
      20,
    )
  } catch (e) {
    return { ok: false, error: `Error de red al cargar VTEX: ${e instanceof Error ? e.message : String(e)}` }
  }

  if (!result.ok) {
    const reason = result.reason === 'not_json' ? 'Respuesta no válida (esperaba JSON)' : 'Error HTTP'
    return { ok: false, error: `${reason}${result.status ? ` (${result.status})` : ''}` }
  }

  // Detectar método de match para el mapeo
  const matchMethod = isVtexIntelligentSearchUrl(seed.page_url)
    ? 'vtex_intelligent_search'
    : isVtexHtmlShelfUrl(seed.page_url)
      ? 'vtex_shelf_html'
      : 'vtex_catalog_system'

  const snapshots = mapVtexProductList(result.products, {
    retailer,
    vtexBaseUrl: baseUrl,
    matchMethod,
  })

  const stagingRows: StagingRow[] = snapshots.map((s) => ({
    external_ref: s.external_ref,
    source_url: s.source_url,
    title: s.title,
    brand: s.brand_hint,
    price: s.price,
    unit_price: s.price,
    category_hint: s.category_hint,
    description_hint: s.description_hint,
    image_url: null,
  }))

  return {
    ok: true,
    data: {
      snapshots,
      stagingRows,
      rawProductCount: result.products.length,
    },
  }
}

/**
 * Particiona el resultado de captura VTEX para insert limpio.
 * Similar a partitionLiderCaptureForCleanInsert pero adaptado a VTEX.
 */
export function partitionVtexCaptureForCleanInsert(input: {
  snapshots: RetailSnapshotRow[]
  stagingRows: StagingRow[]
  rawProductCount: number
}): {
  cleanStaging: StagingRow[]
  productsFound: number
} {
  // VTEX ya viene limpio del mapVtexProductList, solo necesitamos
  // filtrar los que no tienen título o external_ref
  const cleanStaging = input.stagingRows.filter(
    (r) => r.title?.trim() && r.external_ref?.trim(),
  )

  return {
    cleanStaging,
    productsFound: input.rawProductCount,
  }
}
