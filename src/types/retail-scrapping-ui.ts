/**
 * Tipos de UI / API para scrapping retail (sin dependencias de servidor).
 * Mantener alineados con `scrapping_runs`, `retail` y el join en listados.
 */

import type { RetailListingPathConfig } from '@/lib/retail-listing-url-path'

export type RetailTargetRow = {
  id: string
  name: string
  base_url: string
  max_pages: number
  max_products: number
  /** Reglas para derivar `scrapping.sections` / `scrapping.categories` desde `listing_url`. */
  listing_url_path_config?: RetailListingPathConfig | null
}

export type ScrappingRunRow = {
  id: string
  retailer: string
  source_chain: string
  status: string
  total_pages: number | null
  pages_done: number
  pages_ok?: number
  pages_failed?: number
  retail_id?: string | null
  rows_inserted: number | string
  error_message: string | null
  started_at: string
  finished_at: string | null
  /** Join opcional desde `retail` (listRecentScrappingRuns). */
  retail?:
    | Pick<
        RetailTargetRow,
        'id' | 'name' | 'base_url' | 'max_pages' | 'max_products' | 'listing_url_path_config'
      >
    | null
}
