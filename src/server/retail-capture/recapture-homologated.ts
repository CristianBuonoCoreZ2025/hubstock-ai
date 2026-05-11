import { normalizeSearchText } from '@/lib/search'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchLiderRetailProducts } from '@/server/retail-capture/fetch-lider-retail'
import { fetchVtexSearchProducts, resolveVtexBaseUrlForRetailer } from '@/server/retail-capture/fetch-vtex-search'
import { mapVtexProductList } from '@/server/retail-capture/map-vtex-product'
import type { RetailSnapshotRow } from '@/server/retail-capture/map-vtex-product'

export type RecaptureHomologatedResult =
  | {
      ok: true
      inserted: number
      skippedNoTitle: number
      skippedNoMatch: number
      skippedFetch: number
      processedLinks: number
    }
  | { ok: false; error: string }

type AdminClient = SupabaseClient

/**
 * Para cada vínculo homologado (catalog_retail_links), busca de nuevo en la tienda usando el título
 * de la última captura e inserta una fila nueva en catalog_retail_snapshots si encuentra el mismo external_ref.
 * Sirve para historial de precios sin duplicar maestros.
 */
export async function runRetailRecaptureHomologatedBatch(
  admin: AdminClient,
  retailer: 'lider' | 'jumbo' | 'central_mayorista',
  limit: number,
): Promise<RecaptureHomologatedResult> {
  const base = resolveVtexBaseUrlForRetailer(retailer)
  if (!base) {
    return {
      ok: false,
      error:
        'No hay URL base configurada para esta cadena. Definí la variable de entorno correspondiente (o Lider usa super.lider.cl por defecto).',
    }
  }

  const cap = Math.max(1, Math.min(60, Math.floor(limit)))

  const { data: links, error: linksError } = await admin
    .from('catalog_retail_links')
    .select('external_ref')
    .eq('retailer', retailer)
    .limit(cap)

  if (linksError) {
    return { ok: false, error: linksError.message ?? 'No se pudo leer vínculos retail.' }
  }

  const refs = (links ?? []) as { external_ref: string }[]
  let inserted = 0
  let skippedNoTitle = 0
  let skippedNoMatch = 0
  let skippedFetch = 0

  for (const row of refs) {
    const external_ref = row.external_ref
    const { data: lastSnap } = await admin
      .from('catalog_retail_snapshots')
      .select('title')
      .eq('retailer', retailer)
      .eq('external_ref', external_ref)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const titleRaw = lastSnap && typeof (lastSnap as { title?: string }).title === 'string'
      ? (lastSnap as { title: string }).title
      : ''
    const qFull = normalizeSearchText(titleRaw).slice(0, 120)
    if (qFull.length < 2) {
      skippedNoTitle++
      continue
    }

    const words = qFull.split(/\s+/).filter(Boolean)
    const tryQueries = [qFull]
    if (words.length > 4) tryQueries.push(words.slice(0, 5).join(' '))
    if (words.length > 8) tryQueries.push(words.slice(0, 8).join(' '))

    let matched: RetailSnapshotRow | null = null
    let anyFetchOk = false

    for (const q of tryQueries) {
      const fetched =
        retailer === 'lider' ?
          await fetchLiderRetailProducts(base, q, 50)
        : await fetchVtexSearchProducts(base, q, 50)
      if (!fetched.ok) continue
      anyFetchOk = true
      const mapped = mapVtexProductList(fetched.products, {
        retailer,
        vtexBaseUrl: base,
        matchMethod: retailer === 'lider' ? 'app_lider_next_recapture' : 'app_vtex_recapture',
      })
      const hit = mapped.find((m) => m.external_ref === external_ref)
      if (hit) {
        matched = hit
        break
      }
    }

    if (!matched) {
      if (!anyFetchOk) skippedFetch++
      else skippedNoMatch++
      continue
    }

    const { error: insErr } = await admin.from('catalog_retail_snapshots').insert(matched as never)
    if (!insErr) inserted++
    else skippedNoMatch++
  }

  return {
    ok: true,
    inserted,
    skippedNoTitle,
    skippedNoMatch,
    skippedFetch,
    processedLinks: refs.length,
  }
}
