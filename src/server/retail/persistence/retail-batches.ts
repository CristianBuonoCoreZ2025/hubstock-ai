import type { SupabaseClient } from '@supabase/supabase-js'
import type { RetailHomologationCounters } from '@/server/retail/capture/retail-types'

export type RetailCaptureBatchRow = {
  id: string
  retailer: string
  status: string
  current_page: number
  total_pages: number | null
  total_found: number
  total_inserted: number
  url_linked: number
  exact_linked: number
  rule_linked: number
  ai_linked: number
  new_master_created: number
  review_required: number
  duplicate_risk: number
  error_message: string | null
  started_at: string
  finished_at: string | null
  /** capture | processing | review | closed — flujo UI Lider masivo. */
  pipeline_phase?: string
  /** Filas nuevas insertadas en catalog_retail_snapshots en este lote (precio distinto al último). */
  snapshot_inserted_total?: number
  /** Omisiones por precio idéntico al último snapshot (no se inserta duplicado). */
  snapshot_skipped_same_price_total?: number
  /** Ítems descartados en captura (calidad / basura). */
  capture_discarded_total?: number
}

export async function insertRetailCaptureBatch(
  admin: SupabaseClient,
  input: { retailer: string; total_pages: number },
): Promise<{ id: string } | { error: unknown }> {
  const { data, error } = await admin
    .from('retail_capture_batches')
    .insert({
      retailer: input.retailer,
      status: 'running',
      current_page: 0,
      total_pages: input.total_pages,
      pipeline_phase: 'capture',
    } as never)
    .select('id')
    .single()

  if (error || !data) {
    return { error: error ?? new Error('insert_batch_no_row') }
  }
  return { id: (data as { id: string }).id }
}

export async function fetchLatestRetailBatch(
  admin: SupabaseClient,
  retailer: string,
): Promise<RetailCaptureBatchRow | null> {
  const { data, error } = await admin
    .from('retail_capture_batches')
    .select('*')
    .eq('retailer', retailer)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return data as RetailCaptureBatchRow
}

export async function fetchRetailBatchById(
  admin: SupabaseClient,
  id: string,
): Promise<RetailCaptureBatchRow | null> {
  const { data, error } = await admin.from('retail_capture_batches').select('*').eq('id', id).maybeSingle()
  if (error || !data) return null
  return data as RetailCaptureBatchRow
}

export async function updateRetailBatchProgress(
  admin: SupabaseClient,
  batchId: string,
  patch: Partial<
    Pick<
      RetailCaptureBatchRow,
      | 'current_page'
      | 'total_pages'
      | 'total_found'
      | 'total_inserted'
      | 'status'
      | 'error_message'
      | 'finished_at'
      | 'pipeline_phase'
      | 'snapshot_inserted_total'
      | 'snapshot_skipped_same_price_total'
      | 'capture_discarded_total'
    >
  >,
): Promise<void> {
  await admin.from('retail_capture_batches').update(patch as never).eq('id', batchId)
}

/** Recalcula contadores de homologación desde filas de staging del lote. */
export async function refreshRetailBatchHomologationStats(
  admin: SupabaseClient,
  batchId: string,
): Promise<void> {
  const { data: rows, error } = await admin
    .from('retail_captured_products')
    .select('decision_source,status')
    .eq('batch_id', batchId)

  if (error || !rows) return

  const tallies: RetailHomologationCounters = {
    url_linked: 0,
    exact_linked: 0,
    rule_linked: 0,
    ai_linked: 0,
    new_master_created: 0,
    review_required: 0,
    duplicate_risk: 0,
  }

  for (const r of rows as { decision_source: string | null; status: string }[]) {
    const src = (r.decision_source ?? '').toLowerCase()
    if (r.status === 'duplicate_risk') {
      tallies.duplicate_risk++
      continue
    }
    if (r.status === 'review') {
      tallies.review_required++
      continue
    }
    if (r.status !== 'linked') continue
    if (src === 'new_master') tallies.new_master_created++
    else if (src === 'url') tallies.url_linked++
    else if (src === 'exact') tallies.exact_linked++
    else if (src === 'rule' || src === 'score') tallies.rule_linked++
    else if (src === 'ai') tallies.ai_linked++
  }

  await admin
    .from('retail_capture_batches')
    .update({
      url_linked: tallies.url_linked,
      exact_linked: tallies.exact_linked,
      rule_linked: tallies.rule_linked,
      ai_linked: tallies.ai_linked,
      new_master_created: tallies.new_master_created,
      review_required: tallies.review_required,
      duplicate_risk: tallies.duplicate_risk,
    } as never)
    .eq('id', batchId)
}
