import type { SupabaseClient } from '@supabase/supabase-js'
import type { LiderPageSeed } from '@/server/retail/capture/lider-catalog-plan'
import type { RetailTargetRow, ScrappingRunRow } from '@/types/retail-scrapping-ui'

export type { RetailTargetRow, ScrappingRunRow }

export type ScrappingPageJob = {
  id: string
  run_id: string
  retailer: string
  page_url: string
  page_index: number
  status: string
}

export type ScrappingProductRow = {
  id: string
  run_id: string
  retailer: string
  external_ref: string
  product_url: string
  product_name: string
  brand: string | null
  price: number | string
  currency: string
  source_chain: string
  listing_url: string
  /** Segmento de ruta de listado (regla en `retail.listing_url_path_config`). */
  sections: string | null
  /** Segmento de ruta de listado (regla en `retail.listing_url_path_config`). */
  categories: string | null
  extracted_at: string
  created_at: string
  catalog_match_status?: string | null
  matched_catalog_product_id?: string | null
  catalog_matched_at?: string | null
  /** Hint IA desde pasada masiva (JSON); no autoriza vínculo. */
  similarity_ia_hint?: {
    ai_hint: string
    candidate_suggested?: string | null
    ai_score?: number | null
    reason?: string
    stored_at?: string
    base_best_catalog_product_id?: string | null
    base_best_score?: number | null
    base_second_score?: number | null
    base_gap?: number | null
    same_product?: boolean | null
    ia_rejected_pair?: boolean
    ia_context?: string | null
  } | null
  /** Motor DB paso 2 (columnas en `scrapping`). */
  base_score?: number | string | null
  base_gap?: number | string | null
  base_decision?: string | null
  ai_score?: number | string | null
  ai_decision?: string | null
  homolog_final_status?: string | null
  base_result?: Record<string, unknown> | null
  ai_result?: Record<string, unknown> | null
}

/** UUID ficticio para `delete` masivo vía PostgREST (requiere filtro). */
const SCRAPPING_PURGE_SENTINEL_UUID = '00000000-0000-0000-0000-000000000000'

/** Purga completa: runs + páginas + filas (cascade). Solo mantenimiento o reset total. */
export async function purgeAllScrappingChainData(admin: SupabaseClient): Promise<{ error: unknown | null }> {
  const { error } = await admin
    .from('scrapping_runs')
    .delete()
    .neq('id', SCRAPPING_PURGE_SENTINEL_UUID as never)
  return { error: error ?? null }
}

/**
 * Marca como fallidas las páginas en cola activa y cancela corridas `running`.
 * Debe llamarse antes de un barrido nuevo o desde «Detener scrapping».
 */
export async function cancelAllRunningScrappingRuns(admin: SupabaseClient): Promise<{ error: unknown | null }> {
  const now = new Date().toISOString()
  const stopMsg = 'Detenido por el usuario.'

  const { error: e1 } = await admin
    .from('scrapping_pages')
    .update({
      status: 'failed',
      finished_at: now,
      error_message: stopMsg,
      products_found: 0,
      rows_written: 0,
    } as never)
    .in('status', ['pending', 'processing'])

  if (e1) return { error: e1 }

  const { error: e2 } = await admin
    .from('scrapping_runs')
    .update({
      status: 'cancelled',
      finished_at: now,
      error_message: stopMsg,
    } as never)
    .eq('status', 'running')

  return { error: e2 ?? null }
}

const SCRAPPING_PAGE_FORCE_DONE_MSG =
  'Listado cerrado manualmente: marcado como listo sin descargar (cierre forzado de la corrida).'

/**
 * Marca páginas `pending` / `processing` de una corrida como `done` sin leer el listado (cierre limpio operativo).
 * No altera el estado de la corrida: quien llama debe actualizar `scrapping_runs` después.
 */
export async function forceClosePendingScrappingPagesAsDone(
  admin: SupabaseClient,
  runId: string,
): Promise<{ error: unknown | null; forcedPages: number }> {
  const { count: c1, error: errCount } = await admin
    .from('scrapping_pages')
    .select('id', { count: 'exact', head: true })
    .eq('run_id', runId)
    .in('status', ['pending', 'processing'])

  if (errCount) return { error: errCount, forcedPages: 0 }
  const pending = c1 ?? 0
  if (pending === 0) return { error: null, forcedPages: 0 }

  const now = new Date().toISOString()
  const { error } = await admin
    .from('scrapping_pages')
    .update({
      status: 'done',
      finished_at: now,
      error_message: SCRAPPING_PAGE_FORCE_DONE_MSG,
      products_found: 0,
      rows_written: 0,
    } as never)
    .eq('run_id', runId)
    .in('status', ['pending', 'processing'])

  return { error: error ?? null, forcedPages: pending }
}

/**
 * Marca pendientes/en proceso de una corrida como fallidas y cancela la corrida si sigue `running`.
 * Usar cuando el barrido en el cliente termina sin cierre normal (corte de red, error de acción, etc.).
 */
export async function failPendingPagesAndCancelRunIfRunning(
  admin: SupabaseClient,
  runId: string,
  runErrorMessage: string,
  pageFailMessage = 'Barrido interrumpido antes de terminar esta página.',
): Promise<{ error: unknown | null }> {
  const now = new Date().toISOString()
  const msg = runErrorMessage.trim().slice(0, 2000)

  const { error: e1 } = await admin
    .from('scrapping_pages')
    .update({
      status: 'failed',
      finished_at: now,
      error_message: pageFailMessage,
      products_found: 0,
      rows_written: 0,
    } as never)
    .eq('run_id', runId)
    .in('status', ['pending', 'processing'])

  if (e1) return { error: e1 }

  const { error: e2 } = await admin
    .from('scrapping_runs')
    .update({
      status: 'cancelled',
      finished_at: now,
      error_message: msg || 'Barrido interrumpido antes de completar la cola.',
    } as never)
    .eq('id', runId)
    .eq('status', 'running')

  return { error: e2 ?? null }
}

/**
 * Vacía por completo `scrapping` y `scrapping_pages` sin borrar `scrapping_runs`.
 * Llamar solo cuando no quede ninguna corrida `running` (p. ej. tras `cancelAllRunningScrappingRuns`).
 */
export async function purgeScrappingProductsAndPages(admin: SupabaseClient): Promise<{ error: unknown | null }> {
  const { error: e1 } = await admin.from('scrapping').delete().neq('id', SCRAPPING_PURGE_SENTINEL_UUID as never)
  if (e1) return { error: e1 }
  const { error: e2 } = await admin.from('scrapping_pages').delete().neq('id', SCRAPPING_PURGE_SENTINEL_UUID as never)
  return { error: e2 ?? null }
}

export async function insertScrappingRun(
  admin: SupabaseClient,
  input: {
    retailer: string
    sourceChain: string
    /** `null` mientras solo está registrada la corrida; se actualiza al cerrar el descubrimiento de URLs. */
    totalPages: number | null
    retailId?: string | null
  },
): Promise<{ id: string } | { error: unknown }> {
  const { data, error } = await admin
    .from('scrapping_runs')
    .insert({
      retailer: input.retailer,
      source_chain: input.sourceChain,
      retail_id: input.retailId ?? null,
      status: 'running',
      total_pages: input.totalPages,
      pages_done: 0,
      pages_ok: 0,
      pages_failed: 0,
      rows_inserted: 0,
    } as never)
    .select('id')
    .single()

  if (error || !data) return { error: error ?? new Error('insert_scrapping_run') }
  return { id: (data as { id: string }).id }
}

export async function insertScrappingPageRows(
  admin: SupabaseClient,
  runId: string,
  retailer: string,
  seeds: LiderPageSeed[],
): Promise<{ error: unknown | null }> {
  if (seeds.length === 0) return { error: new Error('empty_seeds') }
  const batchSize = 250
  for (let offset = 0; offset < seeds.length; offset += batchSize) {
    const slice = seeds.slice(offset, offset + batchSize).map((s) => ({
      run_id: runId,
      retailer,
      page_url: s.page_url,
      page_index: s.page_index,
      status: 'pending',
    }))
    const { error } = await admin.from('scrapping_pages').insert(slice as never)
    if (error) return { error }
  }
  return { error: null }
}

/** Mayor `page_index` en la cola de una corrida (-1 si no hay filas). */
export async function getMaxScrappingPageIndexForRun(
  admin: SupabaseClient,
  runId: string,
): Promise<number> {
  const { data, error } = await admin
    .from('scrapping_pages')
    .select('page_index')
    .eq('run_id', runId)
    .order('page_index', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return -1
  const n = (data as { page_index?: number }).page_index
  return typeof n === 'number' ? n : -1
}

/** Conjunto de `page_url` ya encolados (paginado por rango). */
export async function listScrappingPageUrlsForRun(
  admin: SupabaseClient,
  runId: string,
): Promise<{ urls: Set<string>; error: unknown | null }> {
  const urls = new Set<string>()
  const step = 1000
  for (let from = 0; ; from += step) {
    const { data, error } = await admin
      .from('scrapping_pages')
      .select('page_url')
      .eq('run_id', runId)
      .order('page_index', { ascending: true })
      .range(from, from + step - 1)
    if (error) return { urls, error }
    const rows = (data ?? []) as { page_url?: string }[]
    for (const r of rows) {
      const u = (r.page_url ?? '').trim()
      if (u) urls.add(u)
    }
    if (rows.length < step) break
  }
  return { urls, error: null }
}

export async function appendScrappingPage(
  admin: SupabaseClient,
  runId: string,
  retailer: string,
  pageUrl: string,
): Promise<{ error: unknown | null }> {
  const { data: maxRow, error: qErr } = await admin
    .from('scrapping_pages')
    .select('page_index')
    .eq('run_id', runId)
    .order('page_index', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (qErr) return { error: qErr }
  const nextIndex =
    typeof (maxRow as { page_index?: number } | null)?.page_index === 'number' ?
      (maxRow as { page_index: number }).page_index + 1
    : 0

  const { error } = await admin
    .from('scrapping_pages')
    .insert({
      run_id: runId,
      retailer,
      page_url: pageUrl,
      page_index: nextIndex,
      status: 'pending',
    } as never)

  return { error }
}

export async function countScrappingPages(
  admin: SupabaseClient,
  runId: string,
): Promise<{ total: number; pending: number; processing: number; done: number; failed: number }> {
  /** Conteo exacto por estado (sin traer filas: evita el tope ~1000 del API en tablas grandes). */
  async function countStatus(status: string): Promise<number> {
    const { count, error } = await admin
      .from('scrapping_pages')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', runId)
      .eq('status', status)
    if (error) {
      console.error('[countScrappingPages]', runId, status, error.message)
      return 0
    }
    return count ?? 0
  }

  const [pending, processing, done, failed] = await Promise.all([
    countStatus('pending'),
    countStatus('processing'),
    countStatus('done'),
    countStatus('failed'),
  ])
  const total = pending + processing + done + failed
  return { total, pending, processing, done, failed }
}

export async function claimNextScrappingPage(
  admin: SupabaseClient,
  runId: string,
): Promise<ScrappingPageJob | null> {
  /** Varios intentos: el flujo select + update no es atómico; otra petición puede ganar la fila entre medias. */
  const maxAttempts = 12
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data: next, error: selErr } = await admin
      .from('scrapping_pages')
      .select('id,run_id,retailer,page_url,page_index,status')
      .eq('run_id', runId)
      .eq('status', 'pending')
      .order('page_index', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (selErr) {
      console.error('[claimNextScrappingPage] select', runId, selErr.message)
      return null
    }
    if (!next) return null

    const started = new Date().toISOString()
    const { data: claimed, error: upErr } = await admin
      .from('scrapping_pages')
      .update({ status: 'processing', started_at: started } as never)
      .eq('id', (next as { id: string }).id)
      .eq('status', 'pending')
      .select('id,run_id,retailer,page_url,page_index,status')
      .maybeSingle()

    if (upErr) {
      console.error('[claimNextScrappingPage] update', runId, upErr.message)
      return null
    }
    if (claimed) return claimed as ScrappingPageJob
  }
  return null
}

export async function finalizeScrappingPage(
  admin: SupabaseClient,
  pageId: string,
  patch: {
    status: 'done' | 'failed'
    products_found: number
    rows_written: number
    error_message?: string | null
  },
): Promise<void> {
  await admin
    .from('scrapping_pages')
    .update({
      status: patch.status,
      products_found: patch.products_found,
      rows_written: patch.rows_written,
      error_message: patch.error_message ?? null,
      finished_at: new Date().toISOString(),
    } as never)
    .eq('id', pageId)
}

export async function resetStaleScrappingPagesProcessing(
  admin: SupabaseClient,
  runId: string,
  maxAgeMs = 600_000,
): Promise<void> {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString()
  await admin
    .from('scrapping_pages')
    .update({ status: 'pending', started_at: null, error_message: null } as never)
    .eq('run_id', runId)
    .eq('status', 'processing')
    .lt('started_at', cutoff)
}

export async function fetchScrappingRunById(
  admin: SupabaseClient,
  runId: string,
): Promise<ScrappingRunRow | null> {
  const { data, error } = await admin.from('scrapping_runs').select('*').eq('id', runId).maybeSingle()
  if (error || !data) return null
  return data as ScrappingRunRow
}

export async function listRecentScrappingRuns(
  admin: SupabaseClient,
  limit = 24,
): Promise<ScrappingRunRow[]> {
  const { data, error } = await admin
    .from('scrapping_runs')
    .select(
      `
      *,
      retail (
        id,
        name,
        base_url,
        max_pages,
        max_products,
        listing_url_path_config
      )
    `,
    )
    .order('started_at', { ascending: false })
    .limit(limit)

  if (error || !data) return []
  return data as ScrappingRunRow[]
}

/** Cantidad de corridas con estado `running` (cualquier retail). */
export async function countRunningScrappingRuns(admin: SupabaseClient): Promise<number> {
  const { count, error } = await admin
    .from('scrapping_runs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'running')
  if (error) return -1
  return count ?? 0
}

export async function countScrappingProductRowsGlobal(admin: SupabaseClient): Promise<number> {
  const { count, error } = await admin.from('scrapping').select('id', { count: 'exact', head: true })
  if (error) return -1
  return count ?? 0
}

/** Filas de producto aún pendientes de homologación (paso 1 en adelante). */
export async function countScrappingProductRowsPendingHomologation(admin: SupabaseClient): Promise<number> {
  const { count, error } = await admin
    .from('scrapping')
    .select('id', { count: 'exact', head: true })
    .eq('catalog_match_status', 'pending')
  if (error) return -1
  return count ?? 0
}

export async function countScrappingPageRowsGlobal(admin: SupabaseClient): Promise<number> {
  const { count, error } = await admin.from('scrapping_pages').select('id', { count: 'exact', head: true })
  if (error) return -1
  return count ?? 0
}

/** Última corrida `running` para el retail (si existe). */
export async function fetchRunningScrappingRunForRetail(
  admin: SupabaseClient,
  retailId: string,
): Promise<ScrappingRunRow | null> {
  const { data, error } = await admin
    .from('scrapping_runs')
    .select('*')
    .eq('retail_id', retailId)
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return data as ScrappingRunRow
}

/** Última corrida del retail (cualquier estado), por `started_at`. */
export async function fetchLatestScrappingRunForRetail(
  admin: SupabaseClient,
  retailId: string,
): Promise<ScrappingRunRow | null> {
  const { data, error } = await admin
    .from('scrapping_runs')
    .select('*')
    .eq('retail_id', retailId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return data as ScrappingRunRow
}

/** Pasa páginas `failed` a `pending` para volver a leerlas (misma corrida). */
export async function requeueFailedScrappingPagesForRun(
  admin: SupabaseClient,
  runId: string,
): Promise<{ error: unknown | null; requeued: number }> {
  const { count, error: cErr } = await admin
    .from('scrapping_pages')
    .select('id', { count: 'exact', head: true })
    .eq('run_id', runId)
    .eq('status', 'failed')
  if (cErr) return { error: cErr, requeued: 0 }
  const n = count ?? 0
  if (n === 0) return { error: null, requeued: 0 }
  const { error } = await admin
    .from('scrapping_pages')
    .update({
      status: 'pending',
      error_message: null,
      finished_at: null,
      started_at: null,
      products_found: 0,
      rows_written: 0,
    } as never)
    .eq('run_id', runId)
    .eq('status', 'failed')
  return { error: error ?? null, requeued: n }
}

/** Permite seguir procesando la cola tras `completed` o `cancelled` (p. ej. reencolar fallidas). */
export async function reopenScrappingRunForQueueProcessing(
  admin: SupabaseClient,
  runId: string,
): Promise<{ error: unknown | null }> {
  const { error } = await admin
    .from('scrapping_runs')
    .update({
      status: 'running',
      finished_at: null,
      error_message: null,
    } as never)
    .eq('id', runId)
    .in('status', ['completed', 'cancelled'] as never)
  return { error: error ?? null }
}

/** Catálogo de retails configurados para scraping (origen `base_url`). */
export async function listRetailTargets(admin: SupabaseClient): Promise<RetailTargetRow[]> {
  const { data, error } = await admin
    .from('retail')
    .select('id,name,base_url,max_pages,max_products,listing_url_path_config')
    .order('name', { ascending: true })

  if (error || !data) return []
  return data as RetailTargetRow[]
}

type ScrappingRowRef = { id: string; retailer: string; external_ref: string }

/**
 * Omite filas que ya tienen vínculo en `catalog_retail_links` (mismo retailer + external_ref)
 * para no volver a cargar en `scrapping` productos ya homologados.
 */
export async function filterScrappingUpsertRowsWithoutExistingRetailLinks<T extends { external_ref: string }>(
  admin: SupabaseClient,
  retailer: string,
  rows: T[],
): Promise<{ kept: T[]; skipped: number }> {
  if (rows.length === 0) return { kept: [], skipped: 0 }
  const refs = [...new Set(rows.map((r) => String(r.external_ref ?? '').trim()).filter(Boolean))]
  const linked = new Set<string>()
  const chunkSize = 200
  for (let i = 0; i < refs.length; i += chunkSize) {
    const slice = refs.slice(i, i + chunkSize)
    const { data, error } = await admin
      .from('catalog_retail_links')
      .select('external_ref')
      .eq('retailer', retailer)
      .in('external_ref', slice)
    if (error) {
      console.warn('[scrapping] no se pudo filtrar vínculos existentes; se insertan todas las filas.', error)
      return { kept: rows, skipped: 0 }
    }
    for (const row of data ?? []) {
      linked.add(String((row as { external_ref: string }).external_ref))
    }
  }
  const kept = rows.filter((r) => !linked.has(String(r.external_ref ?? '').trim()))
  return { kept, skipped: rows.length - kept.length }
}

async function collectScrappingIdsWithExistingRetailLink(
  admin: SupabaseClient,
  batch: ScrappingRowRef[],
): Promise<string[]> {
  const byRetailer = new Map<string, Map<string, string>>()
  for (const r of batch) {
    const ref = String(r.external_ref ?? '').trim()
    if (!ref) continue
    if (!byRetailer.has(r.retailer)) byRetailer.set(r.retailer, new Map())
    byRetailer.get(r.retailer)!.set(ref, r.id)
  }
  const toDelete: string[] = []
  for (const [retailer, refMap] of byRetailer) {
    const refs = [...refMap.keys()]
    const chunk = 200
    for (let i = 0; i < refs.length; i += chunk) {
      const slice = refs.slice(i, i + chunk)
      const { data: links, error } = await admin
        .from('catalog_retail_links')
        .select('external_ref')
        .eq('retailer', retailer)
        .in('external_ref', slice)
      if (error) {
        console.warn('[scrapping] purge vínculos: error consultando links', error)
        continue
      }
      for (const row of links ?? []) {
        const er = String((row as { external_ref: string }).external_ref)
        const sid = refMap.get(er)
        if (sid) toDelete.push(sid)
      }
    }
  }
  return toDelete
}

/**
 * Elimina filas de `scrapping` que ya tienen entrada en `catalog_retail_links` (mismo retailer + external_ref).
 * Mantención: corrida sin `running`; no borra vínculos ni maestros.
 */
export async function purgeScrappingRowsThatAlreadyHaveRetailLink(
  admin: SupabaseClient,
): Promise<{ deleted: number; error: unknown | null }> {
  const { data: rpcData, error: rpcErr } = await admin.rpc('scrapping_purge_rows_with_retail_link')
  if (!rpcErr && rpcData != null && typeof rpcData === 'object') {
    const deleted = Number((rpcData as { deleted?: unknown }).deleted ?? 0)
    if (Number.isFinite(deleted) && deleted >= 0) {
      return { deleted: Math.floor(deleted), error: null }
    }
  }
  if (rpcErr) {
    console.warn(
      '[scrapping] purge RPC scrapping_purge_rows_with_retail_link no disponible; respaldo por lotes.',
      rpcErr,
    )
  }

  let deletedTotal = 0
  let lastId: string | null = null
  const batchN = 350
  for (;;) {
    let q = admin
      .from('scrapping')
      .select('id, retailer, external_ref')
      .order('id', { ascending: true })
      .limit(batchN)
    if (lastId) {
      q = q.gt('id', lastId)
    }
    const { data: batch, error } = await q
    if (error) return { deleted: deletedTotal, error }
    if (!batch?.length) break

    const typed = batch as ScrappingRowRef[]
    const ids = await collectScrappingIdsWithExistingRetailLink(admin, typed)
    if (ids.length > 0) {
      for (let i = 0; i < ids.length; i += 150) {
        const slice = ids.slice(i, i + 150)
        const { error: dErr } = await admin.from('scrapping').delete().in('id', slice)
        if (dErr) return { deleted: deletedTotal, error: dErr }
      }
      deletedTotal += ids.length
    }
    lastId = typed[typed.length - 1]!.id
    if (typed.length < batchN) break
  }
  return { deleted: deletedTotal, error: null }
}
