'use server'

import { revalidatePath } from 'next/cache'
import { assertProfileMembership } from '@/lib/profile/membership'
import { getProfileContext } from '@/lib/profile/context'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/server/supabase-admin'
import { getUserFriendlyErrorMessage, isPostgrestUnknownColumnError } from '@/lib/user-friendly-errors'
import { CATALOG_GRID_PAGE_SIZE } from '@/lib/catalog-grid'
import {
  deriveSectionCategoryFromListingUrl,
  type RetailListingPathConfig,
} from '@/lib/retail-listing-url-path'
import { captureLiderRetailPage, partitionLiderCaptureForCleanInsert } from '@/server/retail/capture/lider-capture'
import {
  cancelSimilarityBulkJob,
  createSimilarityBulkJob,
  getSimilarityBulkJob,
  type SimilarityBulkJobProgress,
} from '@/server/retail/scrapping/scrapping-similarity-bulk-job-store'
import { runScrappingSimilarityBulkJob } from '@/server/retail/scrapping/scrapping-similarity-bulk-runner'
import {
  computeScrappingSimilarityPrepSummary,
  type ScrappingSimilarityPrepSummary,
} from '@/server/retail/scrapping/scrapping-similarity-bulk-summary'
import {
  countScrappingSimilarityPending,
  processScrappingSimilarityBulkBatch,
  processScrappingSimilarityBulkMultiBatch,
  scrappingBulkSkipAutoOnModalOpen,
  scrappingBulkUseBackgroundJob,
} from '@/server/retail/scrapping/scrapping-similarity-bulk-prep'
import {
  processHomologationGrayIaQueue,
  type HomologGrayIaSummary,
} from '@/server/retail/scrapping/scrapping-homologation-ia-gray'
import {
  recordHomologationUserFeedbackRpc,
  runHomologationStep2ComputeAllPending,
  type HomologationStep2RpcSummary,
} from '@/server/retail/scrapping/scrapping-homologation-db'
import type {
  SimilarityBulkBatchStats,
  SimilarityBulkRunStats,
} from '@/server/retail/scrapping/scrapping-similarity-bulk-prep'
import {
  confirmManualScrappingSimilarityLink,
  fetchScrappingSimilarityManualCandidates,
  markScrappingRowPendingNew,
} from '@/server/retail/scrapping/scrapping-similarity-manual'
import type { ScrappingSimilarityManualCandidate } from '@/server/retail/scrapping/scrapping-similarity-manual'
import {
  appendScrappingPage,
  cancelAllRunningScrappingRuns,
  claimNextScrappingPage,
  countRunningScrappingRuns,
  countScrappingPages,
  countScrappingPageRowsGlobal,
  countScrappingProductRowsGlobal,
  countScrappingProductRowsPendingHomologation,
  failPendingPagesAndCancelRunIfRunning,
  fetchLatestScrappingRunForRetail,
  fetchRunningScrappingRunForRetail,
  fetchScrappingRunById,
  filterScrappingUpsertRowsWithoutExistingRetailLinks,
  finalizeScrappingPage,
  forceClosePendingScrappingPagesAsDone,
  getMaxScrappingPageIndexForRun,
  insertScrappingPageRows,
  insertScrappingRun,
  listScrappingPageUrlsForRun,
  purgeScrappingProductsAndPages,
  listRecentScrappingRuns,
  listRetailTargets,
  purgeScrappingRowsThatAlreadyHaveRetailLink,
  reopenScrappingRunForQueueProcessing,
  requeueFailedScrappingPagesForRun,
  resetStaleScrappingPagesProcessing,
  type ScrappingProductRow,
} from '@/server/retail/scrapping/lider-scrapping-service'
import type { RetailTargetRow, ScrappingRunRow } from '@/types/retail-scrapping-ui'
import {
  buildLiderFullCatalogPageSeeds,
  discoverLiderScrapingUrlsPhase1Only,
  isLiderCatalogSystemSearchUrl,
  isLiderHtmlBrowseListingUrl,
  LIDER_SCRAPPING_QUEUE_TOTAL_PAGES_OPEN,
  normalizeLiderStorefrontUrl,
  nextLiderCatalogSystemSliceUrl,
  nextLiderHtmlBrowseListingPageUrl,
  type LiderPageSeed,
} from '@/server/retail/capture/lider-catalog-plan'

type ScrappingUpsertRow = {
  run_id: string
  retailer: string
  external_ref: string
  product_url: string
  product_name: string
  brand: string | null
  price: number
  currency: string
  source_chain: string
  listing_url: string
  sections: string | null
  categories: string | null
  extracted_at: string
}

/** La cola dejó de crecer: `total_pages` fijado (≥ 0). Mientras es -1, no se cierra la corrida aunque no haya pendientes. */
function isScrappingQueueSealed(totalPages: number | null | undefined): boolean {
  return typeof totalPages === 'number' && totalPages >= 0
}

/** Persiste `total_pages` en corrida: mantiene -1 hasta que la fase 2 selle; si no, refleja el tamaño actual de la cola. */
function resolveScrappingRunTotalPagesForDb(
  waveDone: boolean,
  talliedQueueTotal: number,
  persistedTotalPages: number | null | undefined,
): number | null {
  if (waveDone) return talliedQueueTotal
  if (persistedTotalPages === LIDER_SCRAPPING_QUEUE_TOTAL_PAGES_OPEN) {
    return LIDER_SCRAPPING_QUEUE_TOTAL_PAGES_OPEN
  }
  return talliedQueueTotal
}

/** Intenta upsert con segmentos de ruta; si la base aún no tiene esas columnas, reintenta sin ellas. */
async function upsertScrappingChunkForRun(
  admin: ReturnType<typeof createServiceRoleClient>,
  slice: ScrappingUpsertRow[],
): Promise<{ error: unknown | null }> {
  if (slice.length === 0) return { error: null }
  const { error: fullErr } = await admin
    .from('scrapping')
    .upsert(slice as never, { onConflict: 'run_id,retailer,external_ref' })
  if (!fullErr) return { error: null }
  if (!isPostgrestUnknownColumnError(fullErr)) return { error: fullErr }
  const lite = slice.map(({ sections: _sec, categories: _cat, ...row }) => row)
  const { error: liteErr } = await admin
    .from('scrapping')
    .upsert(lite as never, { onConflict: 'run_id,retailer,external_ref' })
  if (!liteErr) {
    console.warn(
      '[scrapping] upsert aplicado sin sections/categories; conviene aplicar la migración scrapping_listing_section_category.',
    )
  }
  return { error: liteErr ?? null }
}

/** Mensaje persistido / devuelto a UI: texto amigable + código Postgres/PostgREST si existe + URL del listado. */
function scrappingPagePersistErrorText(friendly: string, listUrl: string, rawErr?: unknown): string {
  const code =
    rawErr && typeof rawErr === 'object' && 'code' in rawErr ?
      String((rawErr as { code?: string }).code ?? '').trim()
    : ''
  const codeSuffix =
    code && code.length <= 32 && /^[0-9A-Za-z]+$/.test(code) ? ` (código ${code})` : ''
  return `${friendly}${codeSuffix} · ${listUrl}`.slice(0, 4000)
}

async function selectScrappingRowCountForRun(
  admin: ReturnType<typeof createServiceRoleClient>,
  runId: string,
): Promise<number | undefined> {
  const { count, error } = await admin
    .from('scrapping')
    .select('*', { count: 'exact', head: true })
    .eq('run_id', runId)
  if (error) return undefined
  return count ?? 0
}

async function loadRetailBenchmarks(
  admin: ReturnType<typeof createServiceRoleClient>,
  retailId: string | null | undefined,
): Promise<{ max_pages: number; max_products: number }> {
  if (!retailId) return { max_pages: 0, max_products: 0 }
  const { data } = await admin.from('retail').select('max_pages,max_products').eq('id', retailId).maybeSingle()
  const row = data as { max_pages?: unknown; max_products?: unknown } | null
  return {
    max_pages: Math.max(0, Number(row?.max_pages ?? 0)),
    max_products: Math.max(0, Number(row?.max_products ?? 0)),
  }
}

async function loadRetailListingPathConfig(
  admin: ReturnType<typeof createServiceRoleClient>,
  retailId: string | null | undefined,
): Promise<RetailListingPathConfig | null> {
  if (!retailId) return null
  const { data, error } = await admin
    .from('retail')
    .select('listing_url_path_config')
    .eq('id', retailId)
    .maybeSingle()
  if (error || !data) return null
  return (data as { listing_url_path_config?: RetailListingPathConfig | null }).listing_url_path_config ?? null
}

/** Tras cerrar la cola: sube `retail.max_*` solo si esta corrida supera el máximo histórico. */
async function refreshRetailBenchmarksAfterWaveClose(
  admin: ReturnType<typeof createServiceRoleClient>,
  retailId: string | null | undefined,
  runId: string,
  totalPagesInWave: number,
): Promise<{ max_pages: number; max_products: number }> {
  const base = await loadRetailBenchmarks(admin, retailId)
  if (!retailId) return base
  const pCount = (await selectScrappingRowCountForRun(admin, runId)) ?? 0
  const nextPages = Math.max(base.max_pages, totalPagesInWave)
  const nextProd = Math.max(base.max_products, pCount)
  await admin
    .from('retail')
    .update({ max_pages: nextPages, max_products: nextProd } as never)
    .eq('id', retailId)
  return { max_pages: nextPages, max_products: nextProd }
}

/** Mensaje en la corrida solo al cerrar la cola; mientras hay pendientes no fijamos el último 404 en la corrida. */
function scrappingRunSummaryAfterWave(
  waveDone: boolean,
  tallies: { total: number; failed: number },
  lastPageHint?: string | null,
): string | null {
  if (!waveDone) return null
  if (tallies.failed === 0) return null
  const base = `Cola terminada: ${tallies.failed} de ${tallies.total} listado(s) fallaron al descargar.`
  const hint = lastPageHint?.trim()
  return hint ? `${base} Último aviso: ${hint}` : base
}

async function requireCatalogEditorRetail(): Promise<
  | { ok: true; admin: ReturnType<typeof createServiceRoleClient> }
  | { ok: false; error: string }
> {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return { ok: false, error: 'Sin perfil activo' }
  }

  const supabase = await createClient()
  const gate = await assertProfileMembership(supabase, activeProfileId, {
    minRole: 'editor',
  })
  if (!gate.ok) {
    return {
      ok: false,
      error: 'Se requiere rol editor o administrador para esta operación.',
    }
  }

  try {
    const admin = createServiceRoleClient()
    return { ok: true, admin }
  } catch {
    return {
      ok: false,
      error: 'No se pudo inicializar el cliente de administración.',
    }
  }
}

/**
 * Fase 1 del barrido: cancela corridas previas, limpia `scrapping` / `scrapping_pages` y registra `scrapping_runs`
 * con `total_pages` aún nulo. El usuario ve la corrida de inmediato sin esperar el descubrimiento en Lider.
 */
export async function prepareLiderScrappingRunAction(input: {
  retailId: string
}): Promise<
  | {
      ok: true
      runId: string
      retailName: string
      retailMaxPages: number
      retailMaxProducts: number
    }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const retailId = input.retailId?.trim()
  if (!retailId) return { ok: false, error: 'Seleccioná un retail para el barrido.' }

  try {
    const { data: retail, error: rErr } = await editor.admin
      .from('retail')
      .select('id,name,base_url,max_pages,max_products')
      .eq('id', retailId)
      .maybeSingle()

    if (rErr || !retail) {
      return { ok: false, error: 'No se encontró el retail seleccionado.' }
    }

    const row = retail as RetailTargetRow
    const baseUrl = (row.base_url ?? '').trim()
    if (!baseUrl) {
      return { ok: false, error: 'El retail no tiene URL base configurada.' }
    }

    const retailerKey = row.name.trim().toLowerCase().replace(/\s+/g, '_')

    const { error: cancelErr } = await cancelAllRunningScrappingRuns(editor.admin)
    if (cancelErr) {
      return { ok: false, error: getUserFriendlyErrorMessage(cancelErr, 'generic') }
    }

    const { error: purgeErr } = await purgeScrappingProductsAndPages(editor.admin)
    if (purgeErr) {
      return { ok: false, error: getUserFriendlyErrorMessage(purgeErr, 'generic') }
    }

    const ins = await insertScrappingRun(editor.admin, {
      retailer: retailerKey,
      sourceChain: 'lider',
      totalPages: null,
      retailId: row.id,
    })
    if ('error' in ins) {
      return { ok: false, error: getUserFriendlyErrorMessage(ins.error, 'generic') }
    }

    revalidatePath('/captura-cadenas-2')
    return {
      ok: true,
      runId: ins.id,
      retailName: row.name,
      retailMaxPages: Math.max(0, Number(row.max_pages ?? 0)),
      retailMaxProducts: Math.max(0, Number(row.max_products ?? 0)),
    }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

/**
 * Fase 1 del barrido Lider: descubrimiento rápido (sin BFS `/content` → `/browse`), inserta `scrapping_pages`
 * y marca `scrapping_runs.total_pages = -1` hasta que la fase 2 selle el total definitivo.
 */
export async function discoverPhase1EnqueueLiderScrappingPagesAction(input: {
  runId: string
  retailId: string
}): Promise<
  | {
      ok: true
      phase1Pages: number
      alreadyPhase1: boolean
      retailName: string
      retailMaxPages: number
      retailMaxProducts: number
    }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const runId = input.runId?.trim()
  const retailId = input.retailId?.trim()
  if (!runId || !retailId) {
    return { ok: false, error: 'Faltan el identificador de la ejecución o del retail.' }
  }

  try {
    const { data: retail, error: rErr } = await editor.admin
      .from('retail')
      .select('id,name,base_url,max_pages,max_products')
      .eq('id', retailId)
      .maybeSingle()

    if (rErr || !retail) {
      return { ok: false, error: 'No se encontró el retail seleccionado.' }
    }

    const row = retail as RetailTargetRow
    const baseUrl = (row.base_url ?? '').trim()
    if (!baseUrl) {
      return { ok: false, error: 'El retail no tiene URL base configurada.' }
    }

    const run = await fetchScrappingRunById(editor.admin, runId)
    if (!run) {
      return { ok: false, error: 'No se encontró la ejecución de scrapping.' }
    }
    if (String(run.retail_id ?? '') !== retailId) {
      return { ok: false, error: 'El retail no coincide con la ejecución registrada.' }
    }

    const tallies0 = await countScrappingPages(editor.admin, runId)
    if (tallies0.total > 0) {
      const tp = run.total_pages
      if (tp == null) {
        await editor.admin
          .from('scrapping_runs')
          .update({ total_pages: tallies0.total } as never)
          .eq('id', runId)
      }
      revalidatePath('/captura-cadenas-2')
      return {
        ok: true,
        phase1Pages: tallies0.total,
        alreadyPhase1: true,
        retailName: row.name,
        retailMaxPages: Math.max(0, Number(row.max_pages ?? 0)),
        retailMaxProducts: Math.max(0, Number(row.max_products ?? 0)),
      }
    }

    if (run.status !== 'running') {
      return { ok: false, error: 'La ejecución ya no está en curso; no se puede armar la cola.' }
    }

    const { urls } = await discoverLiderScrapingUrlsPhase1Only(baseUrl)
    const fallback =
      normalizeLiderStorefrontUrl(baseUrl, '/') ?? `${baseUrl.replace(/\/+$/, '')}/`
    const list = urls.length > 0 ? urls : [fallback]
    const seeds: LiderPageSeed[] = list.map((href, page_index) => ({ page_url: href, page_index }))
    if (seeds.length === 0) {
      await editor.admin
        .from('scrapping_runs')
        .update({
          status: 'cancelled',
          finished_at: new Date().toISOString(),
          total_pages: 0,
          error_message: 'No se pudo armar la cola inicial de URLs. Reintenta más tarde.',
        } as never)
        .eq('id', runId)
        .eq('status', 'running' as never)
      revalidatePath('/captura-cadenas-2')
      return {
        ok: false,
        error: 'No se pudo armar la cola inicial de URLs. Reintenta más tarde.',
      }
    }

    const retailerKey = row.name.trim().toLowerCase().replace(/\s+/g, '_')

    const runBeforeInsert = await fetchScrappingRunById(editor.admin, runId)
    if (!runBeforeInsert || runBeforeInsert.status !== 'running') {
      return { ok: false, error: 'La ejecución se detuvo antes de guardar la cola inicial.' }
    }

    const { error: pqErr } = await insertScrappingPageRows(editor.admin, runId, retailerKey, seeds)
    if (pqErr) {
      await editor.admin.from('scrapping_runs').delete().eq('id', runId)
      revalidatePath('/captura-cadenas-2')
      return { ok: false, error: getUserFriendlyErrorMessage(pqErr, 'generic') }
    }

    const { error: updErr } = await editor.admin
      .from('scrapping_runs')
      .update({ total_pages: LIDER_SCRAPPING_QUEUE_TOTAL_PAGES_OPEN } as never)
      .eq('id', runId)
      .eq('status', 'running' as never)

    if (updErr) {
      console.error('[discoverPhase1EnqueueLiderScrappingPagesAction] update total_pages', updErr)
    }

    revalidatePath('/captura-cadenas-2')
    return {
      ok: true,
      phase1Pages: seeds.length,
      alreadyPhase1: false,
      retailName: row.name,
      retailMaxPages: Math.max(0, Number(row.max_pages ?? 0)),
      retailMaxProducts: Math.max(0, Number(row.max_products ?? 0)),
    }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

/**
 * Fase 2: descubrimiento completo del catálogo, inserta solo URLs nuevas respecto a la cola actual y fija `total_pages`.
 */
export async function discoverPhase2AppendAndSealLiderScrappingPagesAction(input: {
  runId: string
  retailId: string
}): Promise<
  | {
      ok: true
      finalTotalPages: number
      appendedUrls: number
      sealedAlready: boolean
      retailName: string
      retailMaxPages: number
      retailMaxProducts: number
    }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const runId = input.runId?.trim()
  const retailId = input.retailId?.trim()
  if (!runId || !retailId) {
    return { ok: false, error: 'Faltan el identificador de la ejecución o del retail.' }
  }

  try {
    const { data: retail, error: rErr } = await editor.admin
      .from('retail')
      .select('id,name,base_url,max_pages,max_products')
      .eq('id', retailId)
      .maybeSingle()

    if (rErr || !retail) {
      return { ok: false, error: 'No se encontró el retail seleccionado.' }
    }

    const row = retail as RetailTargetRow
    const baseUrl = (row.base_url ?? '').trim()
    if (!baseUrl) {
      return { ok: false, error: 'El retail no tiene URL base configurada.' }
    }

    let run = await fetchScrappingRunById(editor.admin, runId)
    if (!run) {
      return { ok: false, error: 'No se encontró la ejecución de scrapping.' }
    }
    if (String(run.retail_id ?? '') !== retailId) {
      return { ok: false, error: 'El retail no coincide con la ejecución registrada.' }
    }

    if (isScrappingQueueSealed(run.total_pages)) {
      const t = await countScrappingPages(editor.admin, runId)
      revalidatePath('/captura-cadenas-2')
      return {
        ok: true,
        finalTotalPages: Math.max(run.total_pages ?? 0, t.total),
        appendedUrls: 0,
        sealedAlready: true,
        retailName: row.name,
        retailMaxPages: Math.max(0, Number(row.max_pages ?? 0)),
        retailMaxProducts: Math.max(0, Number(row.max_products ?? 0)),
      }
    }

    if (run.status !== 'running') {
      return { ok: false, error: 'La ejecución ya no está en curso; no se puede completar el descubrimiento.' }
    }

    const fullSeeds = await buildLiderFullCatalogPageSeeds(baseUrl)

    run = await fetchScrappingRunById(editor.admin, runId)
    if (!run || run.status !== 'running') {
      return { ok: false, error: 'La ejecución se detuvo antes de terminar de ampliar la cola.' }
    }

    if (fullSeeds.length === 0) {
      await editor.admin
        .from('scrapping_runs')
        .update({
          status: 'cancelled',
          finished_at: new Date().toISOString(),
          total_pages: 0,
          error_message: 'No se pudo armar la cola de URLs para este retail. Reintenta más tarde.',
        } as never)
        .eq('id', runId)
        .eq('status', 'running' as never)

      revalidatePath('/captura-cadenas-2')
      return {
        ok: false,
        error: 'No se pudo armar la cola de URLs para este retail. Reintenta más tarde.',
      }
    }

    const retailerKey = row.name.trim().toLowerCase().replace(/\s+/g, '_')
    const { urls: existing, error: listErr } = await listScrappingPageUrlsForRun(editor.admin, runId)
    if (listErr) {
      return { ok: false, error: getUserFriendlyErrorMessage(listErr, 'generic') }
    }

    const maxIx = await getMaxScrappingPageIndexForRun(editor.admin, runId)

    const appendOrdered: LiderPageSeed[] = []
    for (const s of fullSeeds) {
      const u = s.page_url.trim()
      if (u && !existing.has(u)) appendOrdered.push(s)
    }

    const toInsert: LiderPageSeed[] =
      existing.size === 0 && maxIx < 0 ?
        fullSeeds
      : appendOrdered.map((s, i) => ({ page_url: s.page_url, page_index: maxIx + 1 + i }))

    const runBeforeInsert = await fetchScrappingRunById(editor.admin, runId)
    if (!runBeforeInsert || runBeforeInsert.status !== 'running') {
      return { ok: false, error: 'La ejecución se detuvo antes de guardar la ampliación de la cola.' }
    }

    if (toInsert.length > 0) {
      const { error: pqErr } = await insertScrappingPageRows(editor.admin, runId, retailerKey, toInsert)
      if (pqErr) {
        return { ok: false, error: getUserFriendlyErrorMessage(pqErr, 'generic') }
      }
    }

    const tallies = await countScrappingPages(editor.admin, runId)
    const { error: updErr } = await editor.admin
      .from('scrapping_runs')
      .update({ total_pages: tallies.total } as never)
      .eq('id', runId)
      .eq('status', 'running' as never)

    if (updErr) {
      console.error('[discoverPhase2AppendAndSealLiderScrappingPagesAction] update total_pages', updErr)
    }

    revalidatePath('/captura-cadenas-2')
    return {
      ok: true,
      finalTotalPages: tallies.total,
      appendedUrls: toInsert.length,
      sealedAlready: false,
      retailName: row.name,
      retailMaxPages: Math.max(0, Number(row.max_pages ?? 0)),
      retailMaxProducts: Math.max(0, Number(row.max_products ?? 0)),
    }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

/** Cancela corridas en curso y marca la cola pendiente o en proceso como fallida (detención explícita). */
export async function stopLiderScrappingAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }
  try {
    const { error } = await cancelAllRunningScrappingRuns(editor.admin)
    if (error) return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
    revalidatePath('/captura-cadenas-2')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

export type LiderBarridoContextOk = {
  ok: true
  /** Hay alguna corrida `running` en el sistema (cualquier retail). */
  anyRunningGlobally: boolean
  globalScrappingProducts: number
  globalScrappingPages: number
  /** Corrida activa para el retail elegido (si coincide). */
  runningForRetail: null | {
    runId: string
    startedAt: string
    pending: number
    processing: number
    failed: number
    done: number
    total: number
    totalPages: number | null
  }
  /** Última corrida del retail (para ofrecer reintento de fallidas). */
  latestRun: null | { runId: string; status: string; startedAt: string; failedPages: number }
}

export type LiderBarridoContextResponse = LiderBarridoContextOk | { ok: false; error: string }

/** Contexto para decidir reanudar, limpiar o reintentar fallidas antes de un barrido. */
export async function getLiderScrappingBarridoContextAction(input: {
  retailId: string
}): Promise<LiderBarridoContextResponse> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const retailId = input.retailId?.trim()
  if (!retailId) return { ok: false, error: 'Falta el retail.' }

  try {
    const runningN = await countRunningScrappingRuns(editor.admin)
    const prodN = await countScrappingProductRowsGlobal(editor.admin)
    const pageN = await countScrappingPageRowsGlobal(editor.admin)
    const anyRunningGlobally = runningN > 0

    const runningRun = await fetchRunningScrappingRunForRetail(editor.admin, retailId)
    let runningForRetail: LiderBarridoContextOk['runningForRetail'] = null
    if (runningRun) {
      const t = await countScrappingPages(editor.admin, runningRun.id)
      runningForRetail = {
        runId: runningRun.id,
        startedAt: runningRun.started_at,
        pending: t.pending,
        processing: t.processing,
        failed: t.failed,
        done: t.done,
        total: t.total,
        totalPages: runningRun.total_pages ?? null,
      }
    }

    const latest = await fetchLatestScrappingRunForRetail(editor.admin, retailId)
    let latestRun: LiderBarridoContextOk['latestRun'] = null
    if (latest) {
      const t2 = await countScrappingPages(editor.admin, latest.id)
      latestRun = {
        runId: latest.id,
        status: latest.status,
        startedAt: latest.started_at,
        failedPages: t2.failed,
      }
    }

    return {
      ok: true,
      anyRunningGlobally,
      globalScrappingProducts: Math.max(0, prodN),
      globalScrappingPages: Math.max(0, pageN),
      runningForRetail,
      latestRun,
    }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

/** Reanuda una corrida `running` del retail (sin purgar ni crear run nueva). */
export async function resumeLiderScrappingBarridoAction(input: {
  runId: string
  retailId: string
}): Promise<
  | {
      ok: true
      runId: string
      retailName: string
      retailMaxPages: number
      retailMaxProducts: number
    }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const runId = input.runId?.trim()
  const retailId = input.retailId?.trim()
  if (!runId || !retailId) {
    return { ok: false, error: 'Faltan el identificador de la ejecución o del retail.' }
  }

  try {
    const { data: retail, error: rErr } = await editor.admin
      .from('retail')
      .select('id,name,max_pages,max_products')
      .eq('id', retailId)
      .maybeSingle()
    if (rErr || !retail) return { ok: false, error: 'No se encontró el retail seleccionado.' }
    const row = retail as RetailTargetRow

    const run = await fetchScrappingRunById(editor.admin, runId)
    if (!run) return { ok: false, error: 'No se encontró la ejecución de scrapping.' }
    if (String(run.retail_id ?? '') !== retailId) {
      return { ok: false, error: 'El retail no coincide con la ejecución registrada.' }
    }
    if (run.status !== 'running') {
      return { ok: false, error: 'Esa ejecución ya no está en curso; no se puede reanudar desde aquí.' }
    }

    await resetStaleScrappingPagesProcessing(editor.admin, runId)
    revalidatePath('/captura-cadenas-2')
    return {
      ok: true,
      runId,
      retailName: row.name,
      retailMaxPages: Math.max(0, Number(row.max_pages ?? 0)),
      retailMaxProducts: Math.max(0, Number(row.max_products ?? 0)),
    }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

/** Vacía `scrapping` y `scrapping_pages` solo si no hay corridas `running`. */
export async function purgeScrappingTablesIfIdleAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }
  try {
    const n = await countRunningScrappingRuns(editor.admin)
    if (n !== 0) {
      return {
        ok: false,
        error: 'Hay una corrida en curso. Detené el scrapping antes de limpiar las tablas.',
      }
    }
    const { error } = await purgeScrappingProductsAndPages(editor.admin)
    if (error) return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
    revalidatePath('/captura-cadenas-2')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

/** Reencola fallidas de la última corrida del retail y la deja lista para seguir leyendo. */
export async function requeueFailedPagesOnLatestRunForRetailAction(input: {
  retailId: string
}): Promise<
  | {
      ok: true
      runId: string
      requeued: number
      retailName: string
      retailMaxPages: number
      retailMaxProducts: number
    }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const retailId = input.retailId?.trim()
  if (!retailId) return { ok: false, error: 'Falta el retail.' }

  try {
    const { data: retail, error: rErr } = await editor.admin
      .from('retail')
      .select('id,name,max_pages,max_products')
      .eq('id', retailId)
      .maybeSingle()
    if (rErr || !retail) return { ok: false, error: 'No se encontró el retail seleccionado.' }
    const row = retail as RetailTargetRow

    const latest = await fetchLatestScrappingRunForRetail(editor.admin, retailId)
    if (!latest) {
      return { ok: false, error: 'No hay corridas registradas para este retail.' }
    }

    const { requeued, error: rqErr } = await requeueFailedScrappingPagesForRun(editor.admin, latest.id)
    if (rqErr) return { ok: false, error: getUserFriendlyErrorMessage(rqErr, 'generic') }
    if (requeued === 0) {
      return { ok: false, error: 'No hay páginas fallidas para reintentar en la última corrida.' }
    }

    const { error: reopenErr } = await reopenScrappingRunForQueueProcessing(editor.admin, latest.id)
    if (reopenErr) return { ok: false, error: getUserFriendlyErrorMessage(reopenErr, 'generic') }

    await resetStaleScrappingPagesProcessing(editor.admin, latest.id)
    revalidatePath('/captura-cadenas-2')
    return {
      ok: true,
      runId: latest.id,
      requeued,
      retailName: row.name,
      retailMaxPages: Math.max(0, Number(row.max_pages ?? 0)),
      retailMaxProducts: Math.max(0, Number(row.max_products ?? 0)),
    }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

/**
 * Cierra operativamente la corrida `running` del retail: páginas pendientes/en proceso pasan a `done` (sin lectura),
 * la corrida queda `completed`, se sella `total_pages` y se actualizan picos en `retail.max_*`.
 */
export async function forceFinalizeScrappingRunForRetailAction(input: {
  retailId: string
}): Promise<
  | {
      ok: true
      runId: string
      forcedPages: number
      retailMaxPages: number
      retailMaxProducts: number
    }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const retailId = input.retailId?.trim()
  if (!retailId) return { ok: false, error: 'Falta el retail.' }

  try {
    const run = await fetchRunningScrappingRunForRetail(editor.admin, retailId)
    if (!run) {
      return { ok: false, error: 'No hay una corrida en curso para este retail.' }
    }
    if (run.status !== 'running') {
      return { ok: false, error: 'La corrida ya no está en curso.' }
    }

    const closed = await forceClosePendingScrappingPagesAsDone(editor.admin, run.id)
    if (closed.error) {
      return { ok: false, error: getUserFriendlyErrorMessage(closed.error, 'generic') }
    }

    const t2 = await countScrappingPages(editor.admin, run.id)
    const runGate = await fetchScrappingRunById(editor.admin, run.id)
    const totalPagesDb = resolveScrappingRunTotalPagesForDb(true, t2.total, runGate?.total_pages)
    const completed = t2.done + t2.failed
    const rowsCountForRun =
      (await selectScrappingRowCountForRun(editor.admin, run.id)) ?? Number(run.rows_inserted ?? 0)

    const runSummary =
      closed.forcedPages > 0 ?
        `Cola cerrada por el usuario: ${closed.forcedPages} listado(s) pendientes o en proceso se marcaron como listos sin descargar.`
      : null

    const { data: updated, error: upErr } = await editor.admin
      .from('scrapping_runs')
      .update({
        pages_done: completed,
        total_pages: totalPagesDb,
        pages_ok: t2.done,
        pages_failed: t2.failed,
        status: 'completed',
        finished_at: new Date().toISOString(),
        rows_inserted: rowsCountForRun,
        error_message: runSummary,
      } as never)
      .eq('id', run.id)
      .eq('status', 'running')
      .select('id')
      .maybeSingle()

    if (upErr) return { ok: false, error: getUserFriendlyErrorMessage(upErr, 'generic') }
    if (!updated) {
      return {
        ok: false,
        error: 'La corrida dejó de estar en curso antes de guardar el cierre. Revisá el listado de corridas.',
      }
    }

    const benchOut = await refreshRetailBenchmarksAfterWaveClose(editor.admin, retailId, run.id, t2.total)

    revalidatePath('/captura-cadenas-2')
    return {
      ok: true,
      runId: run.id,
      forcedPages: closed.forcedPages,
      retailMaxPages: benchOut.max_pages,
      retailMaxProducts: benchOut.max_products,
    }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

/** Procesa la siguiente página pendiente de la cola scrapping (una petición HTTP de listado). */
export async function processLiderScrappingRunPageAction(input: {
  runId: string
}): Promise<
  | {
      ok: true
      done: boolean
      /** `true` si la corrida quedó en `cancelled` (detención o ya estaba cancelada). */
      cancelled: boolean
      pageIndex: number
      productsThisPage: number
      rowsWritten: number
      nextPageIndex: number
      totalPages: number
      error?: string
      /** Total filas en `scrapping` para esta corrida; solo cuando la cola acaba de terminar (`done`). */
      scrappingRowsTotal?: number
      /** Filas acumuladas reportadas en la corrida (coincide con conteo al cerrar). */
      scrappingRowsTally: number
      /** Total de filas en cola `scrapping_pages` (incluye pendientes). */
      queuePagesTotal: number
      /** Páginas de cola ya terminadas (done + failed). */
      queuePagesProcessed: number
      /** Páginas de cola con estado `done`. */
      queuePagesOk: number
      /** Páginas de cola con estado `failed` (p. ej. error de lectura tipo 404). */
      queuePagesFailed: number
      /** Páginas de cola aún `pending`. */
      queuePagesPending: number
      /** Páginas de cola en `processing`. */
      queuePagesProcessing: number
      /** Estado de `scrapping_runs` tras esta respuesta (útil para diagnosticar cortes). */
      runPersistedStatus: string
      /** Pico histórico `retail.max_pages` al momento de la respuesta; no condiciona el tamaño de la cola. */
      retailMaxPages: number
      /** Pico histórico `retail.max_products`; referencia solamente. */
      retailMaxProducts: number
    }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const runId = input.runId?.trim()
  if (!runId) return { ok: false, error: 'Falta el identificador de la ejecución.' }

  const run = await fetchScrappingRunById(editor.admin, runId)
  if (!run) return { ok: false, error: 'No se encontró la ejecución de scrapping.' }

  const benchStart = await loadRetailBenchmarks(editor.admin, run.retail_id)

  if (run.status === 'completed' || run.status === 'cancelled') {
    const t0 = await countScrappingPages(editor.admin, runId)
    const scrappingRowsTotal = await selectScrappingRowCountForRun(editor.admin, runId)
    const processed = t0.done + t0.failed
    return {
      ok: true,
      done: true,
      cancelled: run.status === 'cancelled',
      pageIndex: run.pages_done,
      productsThisPage: 0,
      rowsWritten: 0,
      nextPageIndex: processed,
      totalPages: t0.total,
      scrappingRowsTotal,
      scrappingRowsTally: scrappingRowsTotal ?? Number(run.rows_inserted ?? 0),
      queuePagesTotal: t0.total,
      queuePagesProcessed: processed,
      queuePagesOk: t0.done,
      queuePagesFailed: t0.failed,
      queuePagesPending: t0.pending,
      queuePagesProcessing: t0.processing,
      runPersistedStatus: run.status,
      retailMaxPages: benchStart.max_pages,
      retailMaxProducts: benchStart.max_products,
    }
  }

  const listingPathConfig = await loadRetailListingPathConfig(editor.admin, run.retail_id)

  await resetStaleScrappingPagesProcessing(editor.admin, runId)

  const tallies0 = await countScrappingPages(editor.admin, runId)
  if (tallies0.total === 0) {
    const discovering = run.status === 'running' && run.total_pages == null
    if (discovering) {
      return {
        ok: false,
        error:
          'La cola de listados se está armando todavía. Esperá a que termine el descubrimiento de URLs en el servidor.',
      }
    }
    return { ok: false, error: 'Esta ejecución no tiene páginas en cola.' }
  }

  let page = await claimNextScrappingPage(editor.admin, runId)
  if (!page && tallies0.pending > 0) {
    page = await claimNextScrappingPage(editor.admin, runId)
  }

  if (!page) {
    const t = await countScrappingPages(editor.admin, runId)
    const runGate = await fetchScrappingRunById(editor.admin, runId)
    const waveDone =
      t.total > 0 && t.pending === 0 && t.processing === 0 && isScrappingQueueSealed(runGate?.total_pages)
    if (runGate?.status === 'cancelled') {
      const processed = t.done + t.failed
      const scrappingRowsTotal = await selectScrappingRowCountForRun(editor.admin, runId)
      const rowsTally = scrappingRowsTotal ?? Number(runGate.rows_inserted ?? 0)
      revalidatePath('/captura-cadenas-2')
      return {
        ok: true,
        done: true,
        cancelled: true,
        pageIndex: runGate.pages_done,
        productsThisPage: 0,
        rowsWritten: 0,
        nextPageIndex: processed,
        totalPages: t.total,
        scrappingRowsTotal,
        scrappingRowsTally: rowsTally,
        queuePagesTotal: t.total,
        queuePagesProcessed: processed,
        queuePagesOk: t.done,
        queuePagesFailed: t.failed,
        queuePagesPending: t.pending,
        queuePagesProcessing: t.processing,
        runPersistedStatus: runGate.status,
        retailMaxPages: benchStart.max_pages,
        retailMaxProducts: benchStart.max_products,
      }
    }
    let benchOut = benchStart
    if (waveDone) {
      const summary = scrappingRunSummaryAfterWave(true, t, null)
      benchOut = await refreshRetailBenchmarksAfterWaveClose(
        editor.admin,
        run.retail_id,
        runId,
        t.total,
      )
      await editor.admin
        .from('scrapping_runs')
        .update({
          status: 'completed',
          finished_at: new Date().toISOString(),
          pages_done: t.done + t.failed,
          total_pages: t.total,
          pages_ok: t.done,
          pages_failed: t.failed,
          error_message: summary,
        } as never)
        .eq('id', runId)
        .neq('status', 'cancelled' as never)
    }
    revalidatePath('/captura-cadenas-2')
    let scrappingRowsTotal: number | undefined
    if (waveDone) {
      scrappingRowsTotal = await selectScrappingRowCountForRun(editor.admin, runId)
    }
    const processed = t.done + t.failed
    const rowsTally =
      waveDone && typeof scrappingRowsTotal === 'number' ?
        scrappingRowsTotal
      : (await selectScrappingRowCountForRun(editor.admin, runId)) ?? 0
    return {
      ok: true,
      done: waveDone,
      cancelled: false,
      pageIndex: run.pages_done,
      productsThisPage: 0,
      rowsWritten: 0,
      nextPageIndex: processed,
      totalPages: t.total,
      scrappingRowsTotal,
      scrappingRowsTally: rowsTally,
      queuePagesTotal: t.total,
      queuePagesProcessed: processed,
      queuePagesOk: t.done,
      queuePagesFailed: t.failed,
      queuePagesPending: t.pending,
      queuePagesProcessing: t.processing,
      runPersistedStatus: waveDone ? 'completed' : 'running',
      retailMaxPages: benchOut.max_pages,
      retailMaxProducts: benchOut.max_products,
    }
  }

  let pageError: string | undefined
  let expandError: string | undefined
  let lastPersistErr: unknown
  let productsFound = 0
  let rowsWritten = 0

  const extractedAt = new Date().toISOString()

  try {
    const cap = await captureLiderRetailPage(page.page_url)
    if (!cap.ok) {
      pageError = cap.error
    } else {
      const part = partitionLiderCaptureForCleanInsert({
        snapshots: cap.data.snapshots,
        stagingRows: cap.data.stagingRows,
        rawProductCount: cap.data.rawProductCount,
      })
      productsFound = part.productsFound

      const pathDerived = deriveSectionCategoryFromListingUrl(page.page_url, listingPathConfig ?? undefined)
      const rows = part.cleanStaging.map((r) => ({
        run_id: runId,
        retailer: page.retailer,
        external_ref: r.external_ref,
        product_url: (r.source_url ?? '').trim() || page.page_url,
        product_name: r.title,
        brand: r.brand ?? null,
        price: r.price,
        currency: 'CLP',
        source_chain: 'lider',
        listing_url: page.page_url,
        sections: pathDerived.sections,
        categories: pathDerived.categories,
        extracted_at: extractedAt,
      }))

      if (rows.length > 0) {
        const { kept: rowsFiltered, skipped: skippedLinked } = await filterScrappingUpsertRowsWithoutExistingRetailLinks(
          editor.admin,
          page.retailer,
          rows,
        )
        if (skippedLinked > 0) {
          console.info(
            `[scrapping] página ${page.page_index}: omitidos ${skippedLinked} producto(s) ya homologados (vínculo en catalog_retail_links).`,
          )
        }
        const chunk = 300
        for (let i = 0; i < rowsFiltered.length; i += chunk) {
          const slice = rowsFiltered.slice(i, i + chunk) as ScrappingUpsertRow[]
          const { error: upErr } = await upsertScrappingChunkForRun(editor.admin, slice)
          if (upErr) {
            lastPersistErr = upErr
            pageError = getUserFriendlyErrorMessage(upErr, 'generic')
            break
          }
        }
        if (!pageError) {
          rowsWritten = rowsFiltered.length
        }
      }

      if (!pageError) {
        const nextUrl =
          isLiderCatalogSystemSearchUrl(page.page_url) ?
            nextLiderCatalogSystemSliceUrl(page.page_url, cap.data.rawProductCount)
          : isLiderHtmlBrowseListingUrl(page.page_url) ?
            nextLiderHtmlBrowseListingPageUrl(page.page_url, cap.data.rawProductCount)
          : null
        if (nextUrl) {
          const app = await appendScrappingPage(editor.admin, runId, page.retailer, nextUrl)
          if (app.error) {
            expandError = getUserFriendlyErrorMessage(app.error, 'generic')
          }
        }
      }
    }

    const persistedPageMessage =
      pageError != null ?
        scrappingPagePersistErrorText(pageError, page.page_url, lastPersistErr)
      : expandError != null ?
        scrappingPagePersistErrorText(expandError, page.page_url)
      : null

    await finalizeScrappingPage(editor.admin, page.id, {
      status: pageError ? 'failed' : 'done',
      products_found: productsFound,
      rows_written: pageError ? 0 : rowsWritten,
      error_message: persistedPageMessage,
    })
  } catch (e) {
    pageError = getUserFriendlyErrorMessage(e, 'generic')
    await finalizeScrappingPage(editor.admin, page.id, {
      status: 'failed',
      products_found: 0,
      rows_written: 0,
      error_message: scrappingPagePersistErrorText(pageError, page.page_url, e),
    })
  }

  const t2 = await countScrappingPages(editor.admin, runId)
  const completed = t2.done + t2.failed
  const runForSeal = await fetchScrappingRunById(editor.admin, runId)
  const waveDone =
    t2.total > 0 &&
    t2.pending === 0 &&
    t2.processing === 0 &&
    isScrappingQueueSealed(runForSeal?.total_pages)
  const runSummary = scrappingRunSummaryAfterWave(waveDone, t2, pageError ?? expandError)

  let scrappingRowsTotal: number | undefined
  if (waveDone) {
    scrappingRowsTotal = await selectScrappingRowCountForRun(editor.admin, runId)
  }

  /** Conteo en BD (válido con varios workers en paralelo; no sumar sobre `rows_inserted` leído al inicio). */
  const rowsCountForRun =
    (await selectScrappingRowCountForRun(editor.admin, runId)) ?? Number(run.rows_inserted ?? 0)

  let benchOut = benchStart
  const runBeforeBench = await fetchScrappingRunById(editor.admin, runId)
  if (waveDone && runBeforeBench?.status !== 'cancelled') {
    benchOut = await refreshRetailBenchmarksAfterWaveClose(editor.admin, run.retail_id, runId, t2.total)
  }

  const totalPagesDb = resolveScrappingRunTotalPagesForDb(waveDone, t2.total, runForSeal?.total_pages)

  await editor.admin
    .from('scrapping_runs')
    .update({
      pages_done: completed,
      total_pages: totalPagesDb,
      pages_ok: t2.done,
      pages_failed: t2.failed,
      status: waveDone ? 'completed' : 'running',
      finished_at: waveDone ? new Date().toISOString() : null,
      rows_inserted: rowsCountForRun,
      error_message: waveDone ? runSummary : null,
    } as never)
    .eq('id', runId)
    .neq('status', 'cancelled' as never)

  const runAfter = await fetchScrappingRunById(editor.admin, runId)
  const cancelledFlag = runAfter?.status === 'cancelled'

  const scrappingRowsTally = waveDone ? (scrappingRowsTotal ?? rowsCountForRun) : rowsCountForRun

  revalidatePath('/captura-cadenas-2')
  return {
    ok: true,
    done: waveDone || cancelledFlag,
    cancelled: cancelledFlag,
    pageIndex: page.page_index,
    productsThisPage: pageError ? 0 : productsFound,
    rowsWritten: pageError ? 0 : rowsWritten,
    nextPageIndex: completed,
    totalPages: t2.total,
    error:
      pageError != null ?
        scrappingPagePersistErrorText(pageError, page.page_url, lastPersistErr)
      : expandError != null ?
        scrappingPagePersistErrorText(expandError, page.page_url)
      : undefined,
    scrappingRowsTotal,
    scrappingRowsTally,
    queuePagesTotal: t2.total,
    queuePagesProcessed: completed,
    queuePagesOk: t2.done,
    queuePagesFailed: t2.failed,
    queuePagesPending: t2.pending,
    queuePagesProcessing: t2.processing,
    runPersistedStatus: runAfter?.status ?? 'running',
    retailMaxPages: benchOut.max_pages,
    retailMaxProducts: benchOut.max_products,
  }
}

export async function listRetailTargetsAction(): Promise<
  | { ok: true; retails: RetailTargetRow[] }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }
  try {
    const retails = await listRetailTargets(editor.admin)
    return { ok: true, retails }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

export async function listScrappingRunsAction(): Promise<
  | { ok: true; runs: ScrappingRunRow[] }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }
  try {
    const runs = await listRecentScrappingRuns(editor.admin, 32)
    return { ok: true, runs }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

/** Si la corrida sigue `running`, la cancela y guarda `error_message` (cierre anómalo desde el cliente). */
export async function persistScrappingRunBarridoOutcomeIfRunningAction(input: {
  runId: string
  summary: string
}): Promise<{ ok: true; updated: boolean } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const runId = input.runId?.trim()
  if (!runId) return { ok: false, error: 'Falta el identificador de la corrida.' }

  const run = await fetchScrappingRunById(editor.admin, runId)
  if (!run) return { ok: true, updated: false }
  if (run.status !== 'running') return { ok: true, updated: false }

  const summary = input.summary.trim().slice(0, 2000)
  if (!summary) return { ok: true, updated: false }

  try {
    const { error } = await failPendingPagesAndCancelRunIfRunning(editor.admin, runId, summary)
    if (error) return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
    revalidatePath('/captura-cadenas-2')
    return { ok: true, updated: true }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

export async function fetchScrappingRowsPageAction(input: {
  runId: string
  page: number
}): Promise<
  | {
      ok: true
      rows: ScrappingProductRow[]
      total: number
      pageSize: number
    }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const runId = input.runId?.trim()
  if (!runId) return { ok: false, error: 'Falta la ejecución.' }

  const pageSize = CATALOG_GRID_PAGE_SIZE
  const page = Math.max(0, Math.floor(input.page))
  const from = page * pageSize
  const to = from + pageSize - 1

  try {
    const { data, error, count } = await editor.admin
      .from('scrapping')
      .select('*', { count: 'exact' })
      .eq('run_id', runId)
      .order('extracted_at', { ascending: false })
      .range(from, to)

    if (error) return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }

    return {
      ok: true,
      rows: (data ?? []) as ScrappingProductRow[],
      total: count ?? 0,
      pageSize,
    }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

/** Totales devueltos por `scrapping_apply_exact_catalog_matches` en base. */
export type ScrappingExactCatalogMatchStats = {
  /** Filas scrapping quitadas porque ya existía vínculo en `catalog_retail_links` (cadena + ref). */
  scrappingDuplicatesPurged: number
  /** Filas eliminadas de scrapping (homologadas por nombre+marca en paso 1). */
  scrappingRowsRemoved: number
  catalogProductsUpdated: number
  distinctCatalogProducts: number
  /** Filas que siguen en `pending` para pasos siguientes (similitud, altas). */
  pendingScrappingRemaining: number
}

/** Conteo global de filas scrapping aún `pending` para la tubería de homologación. */
export async function getScrappingHomologacionPendingCountAction(): Promise<
  { ok: true; pendingCount: number } | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }
  try {
    const n = await countScrappingProductRowsPendingHomologation(editor.admin)
    if (n < 0) {
      return { ok: false, error: 'No se pudo leer el estado de scrapping. Intenta nuevamente.' }
    }
    return { ok: true, pendingCount: n }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

/** Paso 1 de homologación: solo con ninguna corrida `running` (scrapping finalizado automática o manualmente). */
export async function applyScrappingExactCatalogMatchesAction(): Promise<
  { ok: true; result: ScrappingExactCatalogMatchStats } | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  try {
    const runningN = await countRunningScrappingRuns(editor.admin)
    if (runningN === -1) {
      return {
        ok: false,
        error: 'No se pudo verificar si hay scrapping en curso. Intenta nuevamente.',
      }
    }
    if (runningN !== 0) {
      return {
        ok: false,
        error:
          'Hay una corrida de scrapping en curso. Finalizá el barrido (hasta que la corrida quede completada) o usá «Dar por finalizado el scrapping pendiente» en el plan del barrido antes de homologar.',
      }
    }

    const purgeRes = await purgeScrappingRowsThatAlreadyHaveRetailLink(editor.admin)
    if (purgeRes.error) {
      return { ok: false, error: getUserFriendlyErrorMessage(purgeRes.error, 'generic') }
    }

    const { data, error } = await editor.admin.rpc('scrapping_apply_exact_catalog_matches')
    if (error) {
      return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
    }
    const raw = data as unknown
    if (raw == null || typeof raw !== 'object') {
      return { ok: false, error: 'No se pudo completar la acción. Intenta nuevamente.' }
    }
    const o = raw as Record<string, unknown>
    const pendingN = await countScrappingProductRowsPendingHomologation(editor.admin)
    const result: ScrappingExactCatalogMatchStats = {
      scrappingDuplicatesPurged: purgeRes.deleted,
      scrappingRowsRemoved: Number(o.scrappingRowsRemoved ?? o.scrappingRowsMatched ?? 0),
      catalogProductsUpdated: Number(o.catalogProductsUpdated ?? 0),
      distinctCatalogProducts: Number(o.distinctCatalogProducts ?? 0),
      pendingScrappingRemaining: pendingN >= 0 ? pendingN : 0,
    }
    revalidatePath('/captura-cadenas-2')
    revalidatePath('/catalogo')
    return { ok: true, result }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

async function assertNoRunningScrappingForHomologation(): Promise<
  { ok: true; admin: ReturnType<typeof createServiceRoleClient> } | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }
  const runningN = await countRunningScrappingRuns(editor.admin)
  if (runningN === -1) {
    return {
      ok: false,
      error: 'No se pudo verificar si hay scrapping en curso. Intenta nuevamente.',
    }
  }
  if (runningN !== 0) {
    return {
      ok: false,
      error:
        'Hay una corrida de scrapping en curso. Finalizá el barrido (hasta que la corrida quede completada) o usá «Dar por finalizado el scrapping pendiente» en el plan del barrido antes de homologar.',
    }
  }
  return { ok: true, admin: editor.admin }
}

export type { ScrappingSimilarityPrepSummary }

/** Desglose estimado (motor base + alcance IA) antes de la pasada masiva paso 2. */
export async function getScrappingSimilarityPrepSummaryAction(): Promise<
  { ok: true; summary: ScrappingSimilarityPrepSummary } | { ok: false; error: string }
> {
  const gate = await assertNoRunningScrappingForHomologation()
  if (!gate.ok) return { ok: false, error: gate.error }
  return computeScrappingSimilarityPrepSummary(gate.admin)
}

/** Total de filas `pending` antes de la pasada masiva paso 2. */
export async function countScrappingSimilarityPendingAction(): Promise<
  { ok: true; total: number } | { ok: false; error: string }
> {
  const gate = await assertNoRunningScrappingForHomologation()
  if (!gate.ok) return { ok: false, error: gate.error }
  try {
    const total = await countScrappingSimilarityPending(gate.admin)
    return { ok: true, total }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

/** Paso 2 · motor determinístico en Postgres (scores + bandas). Un solo RPC para todas las filas pending. */
export async function runScrappingHomologationStep2DbMotorAction(): Promise<
  { ok: true; summary: HomologationStep2RpcSummary } | { ok: false; error: string }
> {
  const gate = await assertNoRunningScrappingForHomologation()
  if (!gate.ok) return { ok: false, error: gate.error }
  const r = await runHomologationStep2ComputeAllPending(gate.admin)
  if (!r.ok) return r
  revalidatePath('/captura-cadenas-2')
  revalidatePath('/catalogo')
  return r
}

/** Paso 2 · cola IA solo para filas con `homolog_final_status = GRAY_IA_QUEUED` y `ai_required`. */
export async function runScrappingHomologationGrayIaAction(): Promise<
  { ok: true; summary: HomologGrayIaSummary } | { ok: false; error: string }
> {
  const gate = await assertNoRunningScrappingForHomologation()
  if (!gate.ok) return { ok: false, error: gate.error }
  const r = await processHomologationGrayIaQueue(gate.admin)
  if (!r.ok) return r
  revalidatePath('/captura-cadenas-2')
  revalidatePath('/catalogo')
  return r
}

/** Feedback usuario (penalty_delta negativo penaliza casos similares en corridas futuras del motor DB). */
export async function recordHomologationUserFeedbackAction(input: {
  scrappingId: string
  reasonCode: string
  penaltyDelta: number
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }
  return recordHomologationUserFeedbackRpc(editor.admin, input)
}

/** Totales para UI: pending global, cola IA gris, revisión humana USER_REVIEW. */
export async function getScrappingHomologationDashboardAction(): Promise<
  | { ok: true; pendingAny: number; grayIaQueued: number; userReview: number }
  | { ok: false; error: string }
> {
  const gate = await assertNoRunningScrappingForHomologation()
  if (!gate.ok) return { ok: false, error: gate.error }
  const a = gate.admin
  const [p1, p2, p3] = await Promise.all([
    a.from('scrapping').select('id', { count: 'exact', head: true }).eq('catalog_match_status', 'pending'),
    a
      .from('scrapping')
      .select('id', { count: 'exact', head: true })
      .eq('homolog_final_status', 'GRAY_IA_QUEUED')
      .eq('ai_required', true),
    a.from('scrapping').select('id', { count: 'exact', head: true }).eq('homolog_final_status', 'USER_REVIEW'),
  ])
  if (p1.error || p2.error || p3.error) {
    return { ok: false, error: 'No se pudo leer el estado de homologación.' }
  }
  return {
    ok: true,
    pendingAny: p1.count ?? 0,
    grayIaQueued: p2.count ?? 0,
    userReview: p3.count ?? 0,
  }
}

function revalidateAfterSimilarityBulk(stats: {
  autoLinked: number
  autoPendingNew: number
}): void {
  if (stats.autoLinked > 0 || stats.autoPendingNew > 0) {
    revalidatePath('/captura-cadenas-2')
    revalidatePath('/catalogo')
  }
}

/** Lote de homologación automática paso 2 (servidor). */
export async function processScrappingSimilarityBulkBatchAction(input: {
  afterId?: string | null
}): Promise<
  | { ok: true; stats: SimilarityBulkBatchStats }
  | { ok: false; error: string }
> {
  const gate = await assertNoRunningScrappingForHomologation()
  if (!gate.ok) return { ok: false, error: gate.error }
  try {
    const r = await processScrappingSimilarityBulkBatch(gate.admin, {
      afterId: input.afterId ?? null,
    })
    if (!r.ok) return r
    revalidateAfterSimilarityBulk(r.stats)
    return r
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

/** Varios lotes por request (Etapa A: menos viajes HTTP, misma lógica de decisión). */
export async function processScrappingSimilarityBulkMultiBatchAction(input: {
  afterId?: string | null
  maxBatches?: number
}): Promise<
  | { ok: true; stats: SimilarityBulkRunStats; lastId: string | null; hasMore: boolean }
  | { ok: false; error: string }
> {
  const gate = await assertNoRunningScrappingForHomologation()
  if (!gate.ok) return { ok: false, error: gate.error }
  try {
    const r = await processScrappingSimilarityBulkMultiBatch(gate.admin, {
      afterId: input.afterId ?? null,
      maxBatches: input.maxBatches,
    })
    if (!r.ok) return r
    revalidateAfterSimilarityBulk(r.stats)
    return r
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

/** Configuración paso 2 (Etapa E). */
export async function getScrappingSimilarityBulkConfigAction(): Promise<{
  ok: true
  useBackgroundJob: boolean
  skipAutoOnOpen: boolean
}> {
  return {
    ok: true,
    useBackgroundJob: scrappingBulkUseBackgroundJob(),
    skipAutoOnOpen: scrappingBulkSkipAutoOnModalOpen(),
  }
}

/** Inicia job en segundo plano (progreso vía polling). */
export async function startScrappingSimilarityBulkJobAction(): Promise<
  | { ok: true; jobId: string; total: number }
  | { ok: false; error: string }
> {
  const gate = await assertNoRunningScrappingForHomologation()
  if (!gate.ok) return { ok: false, error: gate.error }
  try {
    const total = await countScrappingSimilarityPending(gate.admin)
    if (total === 0) {
      return { ok: false, error: 'No hay filas pending para homologar.' }
    }
    const job = createSimilarityBulkJob(total)
    void runScrappingSimilarityBulkJob(gate.admin, job.jobId, total)
    return { ok: true, jobId: job.jobId, total }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

export async function getScrappingSimilarityBulkJobProgressAction(input: {
  jobId: string
}): Promise<
  | { ok: true; job: SimilarityBulkJobProgress }
  | { ok: false; error: string }
> {
  const jobId = input.jobId?.trim()
  if (!jobId) return { ok: false, error: 'Falta el identificador del proceso.' }
  const job = getSimilarityBulkJob(jobId)
  if (!job) {
    return { ok: false, error: 'No se encontró el proceso de homologación. Vuelve a abrir el paso 2.' }
  }
  return { ok: true, job }
}

export async function cancelScrappingSimilarityBulkJobAction(input: {
  jobId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const jobId = input.jobId?.trim()
  if (!jobId) return { ok: false, error: 'Falta el identificador del proceso.' }
  cancelSimilarityBulkJob(jobId)
  return { ok: true }
}

/** Grilla paso 2: solo filas `homolog_final_status = USER_REVIEW` (filtro humano final). */
export async function listScrappingSimilarityReviewPageAction(input: {
  page: number
}): Promise<
  | { ok: true; rows: ScrappingProductRow[]; total: number; pageSize: number }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const pageSize = CATALOG_GRID_PAGE_SIZE
  const page = Math.max(0, Math.floor(input.page))
  const from = page * pageSize
  const to = from + pageSize - 1

  try {
    const { data, error, count } = await editor.admin
      .from('scrapping')
      .select('*', { count: 'exact' })
      .eq('homolog_final_status', 'USER_REVIEW')
      .order('id', { ascending: true })
      .range(from, to)

    if (error) return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }

    return {
      ok: true,
      rows: (data ?? []) as ScrappingProductRow[],
      total: count ?? 0,
      pageSize,
    }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

export async function getScrappingSimilarityCandidatesAction(input: {
  scrappingId: string
}): Promise<
  | { ok: true; candidates: ScrappingSimilarityManualCandidate[]; autoResolvedAsPendingNew?: boolean }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }
  const id = input.scrappingId?.trim()
  if (!id) return { ok: false, error: 'Falta el identificador de la fila.' }

  try {
    const { data: row, error } = await editor.admin
      .from('scrapping')
      .select('id, retailer, external_ref, product_name, brand, price, sections, categories, catalog_match_status')
      .eq('id', id)
      .maybeSingle()

    if (error || !row) {
      return { ok: false, error: 'No se encontró la fila de scrapping.' }
    }
    if ((row as { catalog_match_status?: string }).catalog_match_status !== 'pending') {
      return { ok: false, error: 'Esa fila ya no está pendiente de similitud.' }
    }

    const cand = await fetchScrappingSimilarityManualCandidates(editor.admin, row as never)
    if (!cand.ok) return cand

    if (cand.candidates.length === 0) {
      const resolved = await markScrappingRowPendingNew(editor.admin, id)
      if (!resolved.ok) return { ok: false, error: resolved.error }
      revalidatePath('/captura-cadenas-2')
      revalidatePath('/catalogo')
      return { ok: true, candidates: [], autoResolvedAsPendingNew: true }
    }

    return cand
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

export async function confirmScrappingSimilarityLinkAction(input: {
  scrappingId: string
  catalogProductId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await assertNoRunningScrappingForHomologation()
  if (!gate.ok) return { ok: false, error: gate.error }
  const sid = input.scrappingId?.trim()
  const cid = input.catalogProductId?.trim()
  if (!sid || !cid) return { ok: false, error: 'Completá la selección antes de vincular.' }

  try {
    const r = await confirmManualScrappingSimilarityLink(gate.admin, sid, cid)
    if (!r.ok) return { ok: false, error: r.error }
    revalidatePath('/captura-cadenas-2')
    revalidatePath('/catalogo')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

const SCRAPPING_SIMILARITY_BATCH_LINK_MAX = 120

/** Varios vínculos paso 2 en una sola operación (misma página de revisión). */
export async function confirmScrappingSimilarityLinksBatchAction(input: {
  links: { scrappingId: string; catalogProductId: string }[]
}): Promise<
  | { ok: true; applied: number; failed: { scrappingId: string; error: string }[] }
  | { ok: false; error: string }
> {
  const gate = await assertNoRunningScrappingForHomologation()
  if (!gate.ok) return { ok: false, error: gate.error }

  const dedup = new Map<string, string>()
  for (const raw of input.links ?? []) {
    const sid = raw.scrappingId?.trim()
    const cid = raw.catalogProductId?.trim()
    if (sid && cid) dedup.set(sid, cid)
  }
  const links = [...dedup.entries()].map(([scrappingId, catalogProductId]) => ({ scrappingId, catalogProductId }))
  if (links.length === 0) {
    return { ok: false, error: 'No hay vínculos pendientes para procesar.' }
  }
  if (links.length > SCRAPPING_SIMILARITY_BATCH_LINK_MAX) {
    return {
      ok: false,
      error: `Como máximo ${SCRAPPING_SIMILARITY_BATCH_LINK_MAX.toLocaleString('es-CL')} vínculos por lote. El cliente debe enviar varios lotes.`,
    }
  }

  const failed: { scrappingId: string; error: string }[] = []
  let applied = 0
  try {
    for (const L of links) {
      const r = await confirmManualScrappingSimilarityLink(gate.admin, L.scrappingId, L.catalogProductId)
      if (!r.ok) failed.push({ scrappingId: L.scrappingId, error: r.error })
      else applied++
    }
    if (applied > 0) {
      revalidatePath('/captura-cadenas-2')
      revalidatePath('/catalogo')
    }
    return { ok: true, applied, failed }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

/** Varias filas paso 2 a `pending_new` en un lote. */
export async function rejectScrappingSimilarityToPendingNewBatchAction(input: {
  scrappingIds: string[]
}): Promise<
  | { ok: true; applied: number; failed: { scrappingId: string; error: string }[] }
  | { ok: false; error: string }
> {
  const gate = await assertNoRunningScrappingForHomologation()
  if (!gate.ok) return { ok: false, error: gate.error }

  const ids = [...new Set((input.scrappingIds ?? []).map((id) => id?.trim()).filter(Boolean))]
  if (ids.length === 0) {
    return { ok: false, error: 'No hay filas marcadas como producto nuevo para procesar.' }
  }
  if (ids.length > SCRAPPING_SIMILARITY_BATCH_LINK_MAX) {
    return {
      ok: false,
      error: `Como máximo ${SCRAPPING_SIMILARITY_BATCH_LINK_MAX.toLocaleString('es-CL')} filas por lote. El cliente debe enviar varios lotes.`,
    }
  }

  const failed: { scrappingId: string; error: string }[] = []
  let applied = 0
  try {
    for (const sid of ids) {
      const r = await markScrappingRowPendingNew(gate.admin, sid)
      if (!r.ok) failed.push({ scrappingId: sid, error: r.error })
      else applied++
    }
    if (applied > 0) {
      revalidatePath('/captura-cadenas-2')
      revalidatePath('/catalogo')
    }
    return { ok: true, applied, failed }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

/** Usuario descarta homologación por similitud: la fila pasa a `pending_new` (paso 3 / producto nuevo). */
export async function rejectScrappingSimilarityToPendingNewAction(input: {
  scrappingId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await assertNoRunningScrappingForHomologation()
  if (!gate.ok) return { ok: false, error: gate.error }
  const sid = input.scrappingId?.trim()
  if (!sid) return { ok: false, error: 'Falta el identificador de la fila.' }

  try {
    const r = await markScrappingRowPendingNew(gate.admin, sid)
    if (!r.ok) return { ok: false, error: r.error }
    revalidatePath('/captura-cadenas-2')
    revalidatePath('/catalogo')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}