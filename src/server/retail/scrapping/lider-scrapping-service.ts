import type { SupabaseClient } from '@supabase/supabase-js'
import type { LiderPageSeed } from '@/server/retail/capture/lider-catalog-plan'

export type ScrappingRunRow = {
  id: string
  retailer: string
  source_chain: string
  status: string
  total_pages: number | null
  pages_done: number
  rows_inserted: number | string
  error_message: string | null
  started_at: string
  finished_at: string | null
}

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
  extracted_at: string
  created_at: string
}

export async function insertScrappingRun(
  admin: SupabaseClient,
  input: { retailer: string; sourceChain: string; totalPages: number },
): Promise<{ id: string } | { error: unknown }> {
  const { data, error } = await admin
    .from('scrapping_runs')
    .insert({
      retailer: input.retailer,
      source_chain: input.sourceChain,
      status: 'running',
      total_pages: input.totalPages,
      pages_done: 0,
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
  const rows = seeds.map((s) => ({
    run_id: runId,
    retailer,
    page_url: s.page_url,
    page_index: s.page_index,
    status: 'pending',
  }))
  const { error } = await admin.from('scrapping_pages').insert(rows as never)
  return { error }
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
  const { data, error } = await admin.from('scrapping_pages').select('status').eq('run_id', runId)
  if (error || !data) {
    return { total: 0, pending: 0, processing: 0, done: 0, failed: 0 }
  }
  const tallies = { total: 0, pending: 0, processing: 0, done: 0, failed: 0 }
  for (const r of data as { status: string }[]) {
    tallies.total++
    const s = (r.status ?? '').toLowerCase()
    if (s === 'pending') tallies.pending++
    else if (s === 'processing') tallies.processing++
    else if (s === 'done') tallies.done++
    else if (s === 'failed') tallies.failed++
  }
  return tallies
}

export async function claimNextScrappingPage(
  admin: SupabaseClient,
  runId: string,
): Promise<ScrappingPageJob | null> {
  const { data: next, error: selErr } = await admin
    .from('scrapping_pages')
    .select('id,run_id,retailer,page_url,page_index,status')
    .eq('run_id', runId)
    .eq('status', 'pending')
    .order('page_index', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (selErr || !next) return null

  const started = new Date().toISOString()
  const { data: claimed, error: upErr } = await admin
    .from('scrapping_pages')
    .update({ status: 'processing', started_at: started } as never)
    .eq('id', (next as { id: string }).id)
    .eq('status', 'pending')
    .select('id,run_id,retailer,page_url,page_index,status')
    .maybeSingle()

  if (upErr || !claimed) return null
  return claimed as ScrappingPageJob
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
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit)

  if (error || !data) return []
  return data as ScrappingRunRow[]
}
