/**
 * Cada cadena usa un mecanismo distinto; el barrido elige fetch y los mensajes de error deben
 * reflejar eso (no asumir VTEX para todas).
 */

import type { VtexFetchResult } from '@/server/retail-capture/fetch-vtex-search'
import { fetchLiderRetailSearchPage } from '@/server/retail-capture/fetch-lider-retail'
import { fetchVtexSearchProductsPage } from '@/server/retail-capture/fetch-vtex-search'

export type RetailSearchChain = 'lider' | 'jumbo' | 'central_mayorista'

/** Origen técnico solo para logs / copy de soporte. */
export function retailSearchMechanismLabel(chain: RetailSearchChain): string {
  switch (chain) {
    case 'lider':
      return 'super.lider.cl — HTML Next.js embebido (scraping vivo); masivo vía SQLite lider/ + script Python'
    case 'jumbo':
      return 'VTEX — API pública de búsqueda + fallbacks (HTML /busca cuando aplica)'
    case 'central_mayorista':
      return 'VTEX — API pública (requiere RETAIL_CENTRAL_MAYORISTA_VTEX_BASE_URL) + fallbacks'
    default:
      return chain
  }
}

/**
 * Una página del barrido: Lider siempre por HTML embebido; Jumbo y Central Mayorista por cliente VTEX.
 */
export async function fetchRetailSweepPage(
  chain: RetailSearchChain,
  baseUrl: string,
  query: string,
  offset: number,
  pageSize: number,
): Promise<VtexFetchResult> {
  if (chain === 'lider') {
    return fetchLiderRetailSearchPage(baseUrl, query, offset, pageSize)
  }
  return fetchVtexSearchProductsPage(baseUrl, query, offset, pageSize)
}
