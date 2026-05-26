/**
 * Adaptador de captura unificado: decide qué estrategia usar según el retailer.
 * - Lider: usa lider-capture.ts (HTML Next.js embebido)
 * - Jumbo: usa jumbo-html-capture.ts (HTML scraping de categorías)
 * - Central Mayorista: usa vtex-capture.ts (API VTEX)
 */

import type { RetailerCode } from '@/server/retail-capture/retailer-registry'
import { retailerDefinition } from '@/server/retail-capture/retailer-registry'
import { resolveVtexBaseUrlForRetailer } from '@/server/retail-capture/fetch-vtex-search'
import {
  captureLiderRetailPage,
  partitionLiderCaptureForCleanInsert,
} from '@/server/retail/capture/lider-capture'
import {
  captureVtexRetailPage,
} from '@/server/retail/capture/vtex-capture'
import type { VtexPageSeed } from '@/server/retail/capture/vtex-catalog-plan'
import {
  isLiderCatalogSystemSearchUrl,
  isLiderHtmlBrowseListingUrl,
  nextLiderCatalogSystemSliceUrl,
  nextLiderHtmlBrowseListingPageUrl,
} from '@/server/retail/capture/lider-catalog-plan'
import {
  isVtexIntelligentSearchUrl,
  nextVtexIntelligentSearchPageUrl,
} from '@/server/retail/capture/vtex-catalog-plan'
import {
  captureJumboHtmlPage,
  isJumboHtmlCategoryUrl,
  type JumboPageSeed,
} from '@/server/retail/capture/jumbo-html-capture'

export type CaptureResult =
  | {
      ok: true
      data: {
        snapshots: Array<{
          external_ref: string
          source_url: string | null
          title: string
          brand: string | null
          price: number
          unit_price: number
          category_hint: string | null
          description_hint: string | null
          image_url: string | null
        }>
        rawProductCount: number
      }
    }
  | { ok: false; error: string }

export type RetailerType = 'lider' | 'vtex'

/**
 * Determina el tipo de captura para un retailer.
 */
export function getRetailerCaptureType(retailer: string): RetailerType {
  const code = retailer.toLowerCase().trim()
  if (code === 'lider') return 'lider'
  // Jumbo y Central Mayorista usan VTEX
  if (code === 'jumbo' || code === 'central_mayorista') return 'vtex'
  // Fallback: si está en el registry con defaultVtexBaseUrl, asumimos VTEX
  const def = retailerDefinition(code as RetailerCode)
  if (def?.defaultVtexBaseUrl || def?.vtexBaseUrlEnvVar) return 'vtex'
  return 'lider' // default conservador
}

/**
 * Determina si un retailer es VTEX (Jumbo, Central Mayorista).
 */
export function isVtexRetailer(retailer: string): boolean {
  return getRetailerCaptureType(retailer) === 'vtex'
}

/**
 * Captura una página según el tipo de retail.
 * Para Lider: seed es string (URL directa)
 * Para Jumbo: seed es JumboPageSeed (HTML scraping)
 * Para Central Mayorista: seed es VtexPageSeed (API VTEX)
 */
export async function captureRetailPage(
  retailer: string,
  seed: string | VtexPageSeed | JumboPageSeed,
): Promise<CaptureResult> {
  const retailerKey = retailer.toLowerCase().trim()
  
  // Jumbo: detectar si es URL de categoría HTML o API VTEX
  if (retailerKey === 'jumbo') {
    const url = typeof seed === 'string' ? seed : seed.page_url
    
    // Si es URL de categoría HTML (/despensa), usar scraping HTML
    if (isJumboHtmlCategoryUrl(url)) {
      const sectionSlug = new URL(url).pathname.replace(/^\//, '').replace(/\?.*/, '')
      const result = await captureJumboHtmlPage(url, sectionSlug)
      if (!result.ok) return result
      
      return {
        ok: true,
        data: {
          snapshots: result.data.stagingRows.map((r) => ({
            external_ref: r.external_ref,
            source_url: r.source_url,
            title: r.title,
            brand: r.brand,
            price: r.price ?? 0,
            unit_price: Number(r.unit_price ?? r.price ?? 0),
            category_hint: r.category_hint,
            description_hint: r.description_hint,
            image_url: r.image_url,
          })),
          rawProductCount: result.data.rawProductCount,
        },
      }
    }
    
    // Si es API VTEX, usar captura VTEX
    const vtexSeed: VtexPageSeed =
      typeof seed === 'string' ? { page_url: seed, page_index: 0, endpoint_type: 'intelligent_search' } : (seed as VtexPageSeed)
    const result = await captureVtexRetailPage(vtexSeed, 'jumbo')
    if (!result.ok) return result

    return {
      ok: true,
      data: {
        snapshots: result.data.stagingRows.map((r) => ({
          external_ref: r.external_ref,
          source_url: r.source_url,
          title: r.title,
          brand: r.brand,
          price: r.price ?? 0,
          unit_price: Number(r.unit_price ?? r.price ?? 0),
          category_hint: r.category_hint,
          description_hint: r.description_hint,
          image_url: r.image_url,
        })),
        rawProductCount: result.data.rawProductCount,
      },
    }
  }

  const type = getRetailerCaptureType(retailer)

  if (type === 'vtex') {
    const vtexSeed: VtexPageSeed =
      typeof seed === 'string' ? { page_url: seed, page_index: 0, endpoint_type: 'intelligent_search' } : (seed as VtexPageSeed)
    const result = await captureVtexRetailPage(vtexSeed, retailer as 'jumbo' | 'central_mayorista')
    if (!result.ok) return result

    return {
      ok: true,
      data: {
        snapshots: result.data.stagingRows.map((r) => ({
          external_ref: r.external_ref,
          source_url: r.source_url,
          title: r.title,
          brand: r.brand,
          price: r.price ?? 0,
          unit_price: Number(r.unit_price ?? r.price ?? 0),
          category_hint: r.category_hint,
          description_hint: r.description_hint,
          image_url: r.image_url,
        })),
        rawProductCount: result.data.rawProductCount,
      },
    }
  }

  // Lider
  const url = typeof seed === 'string' ? seed : seed.page_url
  const result = await captureLiderRetailPage(url)
  if (!result.ok) return result

  const part = partitionLiderCaptureForCleanInsert({
    snapshots: result.data.snapshots,
    stagingRows: result.data.stagingRows,
    rawProductCount: result.data.rawProductCount,
  })

  return {
    ok: true,
    data: {
      snapshots: part.cleanStaging.map((r) => ({
        external_ref: r.external_ref,
        source_url: r.source_url,
        title: r.title,
        brand: r.brand,
        price: r.price ?? 0,
        unit_price: Number(r.unit_price ?? r.price ?? 0),
        category_hint: r.category_hint,
        description_hint: r.description_hint ?? null,
        image_url: r.image_url ?? null,
      })),
      rawProductCount: part.productsFound,
    },
  }
}

/**
 * Calcula la siguiente página para paginación dinámica.
 * Devuelve null si no hay siguiente página.
 */
export function computeNextRetailPageUrl(
  currentUrl: string,
  retailer: string,
  currentProductsCount: number,
): string | null {
  const type = getRetailerCaptureType(retailer)

  if (type === 'vtex') {
    // Solo intelligent-search soporta paginación dinámica fácil
    if (isVtexIntelligentSearchUrl(currentUrl)) {
      return nextVtexIntelligentSearchPageUrl(currentUrl, currentProductsCount)
    }
    // catalog_system y shelf_html no expanden fácilmente
    return null
  }

  // Lider
  if (isLiderCatalogSystemSearchUrl(currentUrl)) {
    return nextLiderCatalogSystemSliceUrl(currentUrl, currentProductsCount)
  }
  if (isLiderHtmlBrowseListingUrl(currentUrl)) {
    return nextLiderHtmlBrowseListingPageUrl(currentUrl, currentProductsCount)
  }
  return null
}

/**
 * Resuelve la URL base para el retail según su tipo.
 */
export function resolveRetailBaseUrl(retailer: string): string | null {
  const type = getRetailerCaptureType(retailer)
  if (type === 'vtex') {
    return resolveVtexBaseUrlForRetailer(retailer as 'jumbo' | 'lider' | 'central_mayorista')
  }
  // Lider default
  const fromEnv = process.env.RETAIL_LIDER_VTEX_BASE_URL?.trim() || process.env.RETAIL_LIDER_STORE_ORIGIN?.trim()
  return fromEnv || 'https://super.lider.cl'
}
