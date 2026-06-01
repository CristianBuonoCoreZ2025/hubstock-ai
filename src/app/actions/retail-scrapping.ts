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
// Captura y paginación unificada en retail-capture-adapter.ts
// (lider-capture.ts se usa indirectamente vía adapter)
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
  processHomologationGrayIaBatch,
  type HomologGrayIaSummary,
  type HomologGrayIaBatchResult,
} from '@/server/retail/scrapping/scrapping-homologation-ia-gray'
import {
  recordHomologationUserFeedbackRpc,
  runHomologationStep2ComputeAllPending,
  type HomologationStep2RpcSummary,
} from '@/server/retail/scrapping/scrapping-homologation-db'
import {
  processHomologationCreateNewBatch,
  processHomologationCreateNewAll,
  type CreateNewProductsBatchResult,
  type CreateNewProductsAllResult,
} from '@/server/retail/scrapping/scrapping-homologation-create-new'
import { logError, logWarn } from '@/lib/db-logger'
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
  cancelAllActiveScrappingRunsForFreshStart,
  cancelAllRunningScrappingRuns,
  countBlockingScrappingRuns,
  pauseAllRunningScrappingRunsForUser,
  claimNextScrappingPage,
  countRunningScrappingRuns,
  countScrappingPages,
  countScrappingProductRowsPendingHomologation,
  failPendingPagesAndCancelRunIfRunning,
  fetchLatestScrappingRunForRetail,
  fetchRunningScrappingRunForRetail,
  fetchScrappingRunById,
  finalizeScrappingPage,
  forceClosePendingScrappingPagesAsDone,
  getMaxScrappingPageIndexForRun,
  insertScrappingPageRows,
  insertScrappingRun,
  listScrappingPageUrlsForRun,
  purgeScrappingProductsAndPages,
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
  LIDER_SCRAPPING_QUEUE_TOTAL_PAGES_OPEN,
  normalizeLiderStorefrontUrl,
} from '@/server/retail/capture/lider-catalog-plan'
import { discoverVtexScrappingUrlsPhase1 } from '@/server/retail/capture/vtex-catalog-plan'
import { discoverJumboScrappingUrlsPhase1 } from '@/server/retail/capture/jumbo-catalog-plan'
import {
  captureRetailPage,
  computeNextRetailPageUrl,
  isVtexRetailer,
  isJumboHtmlRetailer,
} from '@/server/retail/scrapping/retail-capture-adapter'

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
  image_url: string | null
  extracted_at: string
}

/** La cola dejó de crecer: `total_pages` fijado (≥ 0). Mientras es -1, no se cierra la corrida aunque no haya pendientes. */
function isScrappingQueueSealed(totalPages: number | null | undefined): boolean {
  return typeof totalPages === 'number' && totalPages >= 0
}

/** Valor para UI cuando `scrapping_runs.total_pages` sigue en -1 (cola abierta en curso). */
function resolveDisplayPagesTotal(
  persistedTotalPages: number | null | undefined,
  queueTotal: number,
): number {
  if (typeof persistedTotalPages === 'number' && persistedTotalPages >= 0) {
    return persistedTotalPages
  }
  return Math.max(0, queueTotal)
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
    .upsert(slice as never, { onConflict: 'run_id,retailer,external_ref,listing_url' })
  if (!fullErr) return { error: null }
  if (!isPostgrestUnknownColumnError(fullErr)) return { error: fullErr }
  const lite = slice.map(({ sections, categories, image_url, ...rest }) => { void sections; void categories; void image_url; return rest })
  const { error: liteErr } = await admin
    .from('scrapping')
    .upsert(lite as never, { onConflict: 'run_id,retailer,external_ref,listing_url' })
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
      retailId: string
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

    const { error: cancelErr } = await cancelAllActiveScrappingRunsForFreshStart(editor.admin)
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
      retailId: row.id,
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
      if (tp == null || tp === LIDER_SCRAPPING_QUEUE_TOTAL_PAGES_OPEN) {
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

    const retailerKey = row.name.trim().toLowerCase().replace(/\s+/g, '_')
    let seeds: Array<{ page_url: string; page_index: number }>

    if (isJumboHtmlRetailer(row.name)) {
      // Jumbo: usar plan HTML (paginas de categoria)
      const jumboResult = await discoverJumboScrappingUrlsPhase1(baseUrl)
      if (!jumboResult.ok) {
        await editor.admin
          .from('scrapping_runs')
          .update({
            status: 'cancelled',
            finished_at: new Date().toISOString(),
            total_pages: 0,
            error_message: jumboResult.error,
          } as never)
          .eq('id', runId)
          .eq('status', 'running' as never)
        revalidatePath('/captura-cadenas-2')
        return { ok: false, error: jumboResult.error }
      }
      seeds = jumboResult.seeds.map((s) => ({ page_url: s.page_url, page_index: s.page_index }))
    } else if (isVtexRetailer(row.name) || isJumboHtmlRetailer(row.name)) {
      // Central Mayorista: usar plan VTEX (API search)
      const vtexResult = await discoverVtexScrappingUrlsPhase1(retailerKey as 'central_mayorista', {
        pagesPerQuery: 3,
        pageSize: 20,
      })
      if (!vtexResult.ok) {
        await editor.admin
          .from('scrapping_runs')
          .update({
            status: 'cancelled',
            finished_at: new Date().toISOString(),
            total_pages: 0,
            error_message: vtexResult.error,
          } as never)
          .eq('id', runId)
          .eq('status', 'running' as never)
        revalidatePath('/captura-cadenas-2')
        return { ok: false, error: vtexResult.error }
      }
      seeds = vtexResult.seeds.map((s, i) => ({ page_url: s.page_url, page_index: i }))
    } else {
      // Lider: usar plan tradicional
      const { urls } = await discoverLiderScrapingUrlsPhase1Only(baseUrl)
      const fallback =
        normalizeLiderStorefrontUrl(baseUrl, '/') ?? `${baseUrl.replace(/\/+$/, '')}/`
      const list = urls.length > 0 ? urls : [fallback]
      seeds = list.map((href, page_index) => ({ page_url: href, page_index }))
    }
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
  abortSignal?: AbortSignal
  maxPages?: number
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

  const checkAborted = () => {
    if (input.abortSignal?.aborted) {
      console.info('[phase2-seal] Abort detectado', { runId })
      throw new Error('Proceso cancelado por el cliente.')
    }
  }
  checkAborted()

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

    const retailerKey = row.name.trim().toLowerCase().replace(/\s+/g, '_')

    // Para VTEX (Central Mayorista) y Jumbo HTML, la cola ya está completa desde Phase 1.
    // Solo sellamos total_pages sin descubrimiento adicional.
    let toInsert: Array<{ page_url: string; page_index: number }> = []

    if (isVtexRetailer(row.name) || isJumboHtmlRetailer(row.name)) {
      const t = await countScrappingPages(editor.admin, runId)
      if (t.total === 0) {
        return { ok: false, error: 'No hay páginas en cola para sellar.' }
      }
      // VTEX y Jumbo HTML no expanden; sellar directamente
      toInsert = []
    } else {
      // Lider: descubrimiento completo del catálogo
      checkAborted()
      const fullSeeds = await buildLiderFullCatalogPageSeeds(baseUrl)

      run = await fetchScrappingRunById(editor.admin, runId)
      if (!run || run.status !== 'running') {
        return { ok: false, error: 'La ejecución se detuvo antes de terminar de ampliar la cola.' }
      }

      const { urls: existing, error: listErr } = await listScrappingPageUrlsForRun(editor.admin, runId)
      if (listErr) {
        return { ok: false, error: getUserFriendlyErrorMessage(listErr, 'generic') }
      }

      // Aplicar límite configurable de páginas (settings).
      // El límite actúa sobre el TOTAL de páginas, no solo las descubiertas,
      // por lo que restamos las ya existentes antes de truncar.
      const maxPages = input.maxPages ?? 0
      if (maxPages > 0) {
        const allowedNew = Math.max(0, maxPages - existing.size)
        if (fullSeeds.length > allowedNew) {
          console.info('[phase2-seal] Truncando seeds al límite configurado (considerando existentes)', { original: fullSeeds.length, allowedNew, existing: existing.size, limit: maxPages })
          fullSeeds.length = allowedNew
        }
      }

      if (fullSeeds.length === 0 && existing.size === 0) {
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

      const maxIx = await getMaxScrappingPageIndexForRun(editor.admin, runId)
      const appendOrdered = []
      for (const s of fullSeeds) {
        const u = s.page_url.trim()
        if (u && !existing.has(u)) appendOrdered.push(s)
      }
      toInsert =
        existing.size === 0 && maxIx < 0 ?
          fullSeeds
        : appendOrdered.map((s, i) => ({ page_url: s.page_url, page_index: maxIx + 1 + i }))
    }

    const runBeforeInsert = await fetchScrappingRunById(editor.admin, runId)
    if (!runBeforeInsert || runBeforeInsert.status !== 'running') {
      return { ok: false, error: 'La ejecución se detuvo antes de guardar la ampliación de la cola.' }
    }

    checkAborted()
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

/**
 * Pausa la corrida en curso: páginas `processing` vuelven a `pending` (no `failed`)
 * y la corrida pasa a `paused` (no `cancelled`). El usuario podrá reanudar o terminar después.
 */
export async function stopLiderScrappingAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }
  try {
    const { error } = await pauseAllRunningScrappingRunsForUser(editor.admin)
    if (error) {
      const realError = error instanceof Error ? error.message : JSON.stringify(error)
      console.error('[stopLiderScrappingAction] ERROR:', realError)
      return { ok: false, error: `DB Error: ${realError}` }
    }
    revalidatePath('/captura-cadenas-2')
    return { ok: true }
  } catch (e) {
    const realError = e instanceof Error ? e.message : String(e)
    console.error('[stopLiderScrappingAction] ERROR:', realError)
    return { ok: false, error: `DB Error: ${realError}` }
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
    rowsInserted: number
  }
  /** Última corrida del retail (para ofrecer reintento de fallidas). */
  latestRun: null | {
    runId: string
    status: string
    startedAt: string
    failedPages: number
    pagesDone: number
    /** Total de páginas para mostrar (nunca -1). */
    pagesTotal: number
    /** Páginas pendientes + en proceso (reanudables). */
    pagesPending: number
    rowsInserted: number
  }
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
    // Una sola consulta SQL con CTEs para obtener todo de una vez
    const { data, error } = await editor.admin.rpc('get_barrido_context', {
      p_retail_id: retailId,
    } as never)
    if (error) throw error

    const row = data?.[0] ?? data
    if (!row) {
      return {
        ok: true,
        anyRunningGlobally: false,
        globalScrappingProducts: 0,
        globalScrappingPages: 0,
        runningForRetail: null,
        latestRun: null,
      }
    }

    const r = row as unknown as {
      running_count?: number | null
      running_run_id?: string | null
      running_run_started_at?: string | null
      running_pending?: number | null
      running_processing?: number | null
      running_failed?: number | null
      running_done?: number | null
      running_total?: number | null
      running_total_pages?: number | null
      latest_run_id?: string | null
      latest_run_status?: string | null
      latest_run_started_at?: string | null
      latest_failed?: number | null
      product_count?: number | null
      page_count?: number | null
    }
    const anyRunningGlobally = (r.running_count ?? 0) > 0

    /**
     * Conteos frescos de filas en `scrapping` por run. Permite mostrar productos rescatados
     * en el modal sin esperar a `scrapping_runs.rows_inserted` (que se persiste al cierre de wave).
     */
    const runningRowsInserted = r.running_run_id
      ? (await selectScrappingRowCountForRun(editor.admin, r.running_run_id)) ?? 0
      : 0
    const latestRowsInserted = r.latest_run_id
      ? (await selectScrappingRowCountForRun(editor.admin, r.latest_run_id)) ?? 0
      : 0

    const runningQueueTotal = Math.max(0, r.running_total ?? 0)
    const runningForRetail: LiderBarridoContextOk['runningForRetail'] = r.running_run_id ? {
      runId: r.running_run_id,
      startedAt: r.running_run_started_at ?? '',
      pending: r.running_pending ?? 0,
      processing: r.running_processing ?? 0,
      failed: r.running_failed ?? 0,
      done: r.running_done ?? 0,
      total: runningQueueTotal,
      totalPages: resolveDisplayPagesTotal(r.running_total_pages ?? null, runningQueueTotal),
      rowsInserted: runningRowsInserted,
    } : null

    /**
     * Métricas adicionales del último run para el modal pausado/finalizado.
     * Lectura directa de `scrapping_runs` + conteo vivo de `scrapping_pages` (el -1 en total_pages es solo interno).
     */
    let latestPagesDone = 0
    let latestPersistedTotalPages: number | null = null
    let latestQueue = { total: 0, pending: 0, processing: 0, done: 0, failed: 0 }
    if (r.latest_run_id) {
      const [{ data: latestRunRow }, queue] = await Promise.all([
        editor.admin
          .from('scrapping_runs')
          .select('pages_done, total_pages')
          .eq('id', r.latest_run_id)
          .maybeSingle(),
        countScrappingPages(editor.admin, r.latest_run_id),
      ])
      if (latestRunRow) {
        const lr = latestRunRow as { pages_done: number | null; total_pages: number | null }
        latestPagesDone = Math.max(0, lr.pages_done ?? 0)
        latestPersistedTotalPages = lr.total_pages ?? null
      }
      latestQueue = queue
      if (
        r.latest_run_status === 'paused' &&
        latestPersistedTotalPages === LIDER_SCRAPPING_QUEUE_TOTAL_PAGES_OPEN &&
        latestQueue.total > 0
      ) {
        await editor.admin
          .from('scrapping_runs')
          .update({ total_pages: latestQueue.total } as never)
          .eq('id', r.latest_run_id)
          .eq('status', 'paused')
        latestPersistedTotalPages = latestQueue.total
      }
    }

    const latestRun: LiderBarridoContextOk['latestRun'] = r.latest_run_id ? {
      runId: r.latest_run_id,
      status: r.latest_run_status ?? '',
      startedAt: r.latest_run_started_at ?? '',
      failedPages: Math.max(r.latest_failed ?? 0, latestQueue.failed),
      pagesDone: latestPagesDone,
      pagesTotal: resolveDisplayPagesTotal(latestPersistedTotalPages, latestQueue.total),
      pagesPending: latestQueue.pending + latestQueue.processing,
      rowsInserted: latestRowsInserted,
    } : null

    return {
      ok: true,
      anyRunningGlobally,
      globalScrappingProducts: Math.max(0, r.product_count ?? 0),
      globalScrappingPages: Math.max(0, r.page_count ?? 0),
      runningForRetail,
      latestRun,
    }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

/** Reanuda una corrida pausada/cancelada del retail (sin purgar ni crear run nueva). */
export async function resumeLiderScrappingBarridoAction(input: {
  runId: string
  retailId: string
}): Promise<
  | {
      ok: true
      runId: string
      retailId: string
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

    const queue = await countScrappingPages(editor.admin, runId)
    const resumablePages = queue.pending + queue.processing + queue.failed

    if (run.status === 'completed') {
      return { ok: false, error: 'La corrida ya está finalizada; no se puede reanudar.' }
    }

    if (run.status !== 'running') {
      if (run.status !== 'paused' && run.status !== 'cancelled') {
        return { ok: false, error: 'Esa ejecución ya no está en curso; no se puede reanudar desde aquí.' }
      }
      if (resumablePages === 0) {
        return { ok: false, error: 'No quedan páginas reanudables en esta corrida.' }
      }

      const blockingN = await countBlockingScrappingRuns(editor.admin, runId)
      if (blockingN === -1) {
        return { ok: false, error: 'No se pudo verificar si hay otra corrida activa. Intenta nuevamente.' }
      }
      if (blockingN > 0) {
        return {
          ok: false,
          error: 'Hay otra corrida en curso o pausada. Detenela o iniciá un barrido nuevo antes de reanudar esta.',
        }
      }

      if (run.status === 'cancelled' && queue.failed > 0) {
        const { error: rqErr } = await requeueFailedScrappingPagesForRun(editor.admin, runId)
        if (rqErr) {
          return { ok: false, error: getUserFriendlyErrorMessage(rqErr, 'generic') }
        }
      }

      const { error: reopenErr } = await reopenScrappingRunForQueueProcessing(editor.admin, runId)
      if (reopenErr) {
        return { ok: false, error: getUserFriendlyErrorMessage(reopenErr, 'generic') }
      }

      const runAfterReopen = await fetchScrappingRunById(editor.admin, runId)
      if (runAfterReopen?.status !== 'running') {
        return {
          ok: false,
          error:
            'No se pudo reactivar la corrida en la base. Si falta la migración de estado `paused`, aplícala en Supabase.',
        }
      }
    } else {
      const otherRunning = await countRunningScrappingRuns(editor.admin)
      if (otherRunning > 1) {
        return {
          ok: false,
          error: 'Hay más de una corrida en curso. Detené el scrapping antes de continuar.',
        }
      }
    }

    await resetStaleScrappingPagesProcessing(editor.admin, runId)
    revalidatePath('/captura-cadenas-2')
    return {
      ok: true,
      runId,
      retailId: row.id,
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
      retailId: string
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
      retailId: row.id,
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
    /**
     * «Terminar» se puede apretar tanto en estado activo (run en `running`) como en pausado
     * (run en `cancelled` con páginas reanudables). En ambos casos cerramos toda la cola
     * pendiente como `done` y dejamos la corrida en `completed`.
     */
    let run = await fetchRunningScrappingRunForRetail(editor.admin, retailId)
    if (!run) {
      const latest = await fetchLatestScrappingRunForRetail(editor.admin, retailId)
      if (
        latest &&
        (latest.status === 'paused' ||
          latest.status === 'cancelled' ||
          latest.status === 'running')
      ) {
        run = latest
      }
    }
    if (!run) {
      return { ok: false, error: 'No hay una corrida activa o pausada para terminar.' }
    }
    if (run.status === 'completed') {
      return { ok: false, error: 'La corrida ya está finalizada.' }
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
        `Cola cerrada por el usuario: ${closed.forcedPages} listado(s) pendientes se marcaron como listos sin descargar. Las fallidas se conservan como fallidas.`
      : null

    /**
     * Filtro: cualquier estado distinto de `completed` para permitir cerrar tanto `running` como `cancelled`.
     * Si entre tanto otro proceso ya la dejó en `completed`, no la pisamos.
     */
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
      .neq('status', 'completed' as never)
      .select('id')
      .maybeSingle()

    if (upErr) return { ok: false, error: getUserFriendlyErrorMessage(upErr, 'generic') }
    if (!updated) {
      return {
        ok: false,
        error: 'La corrida ya estaba finalizada por otro proceso. Refrescá y volvé a intentar.',
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
  abortSignal?: AbortSignal
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
      /** Diagnóstico técnico de captura para trazabilidad en el Log de Diagnóstico. */
      __diagnostic?: string
      /** URL de la página procesada (útil para browser fallback anti-bot). */
      pageUrl?: string
      /** ID de la página en scrapping_pages (necesario para submit desde navegador). */
      pageId?: string
    }
  | { ok: false; error: string }
> {
  // Helper para verificar si el cliente abortó
  const checkAborted = () => {
    if (input.abortSignal?.aborted) {
      console.info('[process-page] Abort detectado', { runId })
      throw new Error('Proceso cancelado por el cliente.')
    }
  }

  checkAborted() // Verificar al inicio
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const runId = input.runId?.trim()
  if (!runId) return { ok: false, error: 'Falta el identificador de la ejecución.' }

  const run = await fetchScrappingRunById(editor.admin, runId)
  if (!run) return { ok: false, error: 'No se encontró la ejecución de scrapping.' }

  const benchStart = await loadRetailBenchmarks(editor.admin, run.retail_id)

  if (run.status === 'completed' || run.status === 'cancelled' || run.status === 'paused') {
    const t0 = await countScrappingPages(editor.admin, runId)
    const scrappingRowsTotal = await selectScrappingRowCountForRun(editor.admin, runId)
    const processed = t0.done + t0.failed
    return {
      ok: true,
      done: true,
      // El cliente trata `cancelled: true` como "termina sin error". Aplica también para `paused`.
      cancelled: run.status === 'cancelled' || run.status === 'paused',
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

  checkAborted()
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

  let currentPageUrl: string | undefined
  let currentPageId: string | undefined

  let page = await claimNextScrappingPage(editor.admin, runId)
  if (page) {
    currentPageUrl = page.page_url
    currentPageId = page.id
  }
  if (!page && tallies0.pending > 0) {
    page = await claimNextScrappingPage(editor.admin, runId)
  }

  if (!page) {
    const t = await countScrappingPages(editor.admin, runId)
    const runGate = await fetchScrappingRunById(editor.admin, runId)
    const waveDone =
      t.total > 0 && t.pending === 0 && t.processing === 0 && isScrappingQueueSealed(runGate?.total_pages)
    if (runGate?.status === 'cancelled' || runGate?.status === 'paused') {
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
  let pageDiagnostic: string | undefined
  let expandError: string | undefined
  let lastPersistErr: unknown
  let productsFound = 0
  let rowsWritten = 0

  const extractedAt = new Date().toISOString()

  try {
    checkAborted() // Verificar antes de capturar la página
    checkAborted() // Verificar antes de fetch a Lider
    // Sin timeout artificial: Lider puede tardar ~26s en fetch HTML (ver fetchLiderHtmlPage).
    const cap = await captureRetailPage(page.retailer, page.page_url)
    if (!cap.ok) {
      pageError = cap.error
      pageDiagnostic = cap.__diagnostic
      if (pageDiagnostic) {
        await logWarn(editor.admin, {
          module: "retail-scrapping",
          message: pageError,
          context: { runId, pageUrl: page.page_url, pageIndex: page.page_index, diagnostic: pageDiagnostic },
          screen: "captura-cadenas-2",
        })
      }
    } else {
      productsFound = cap.data.rawProductCount
      if (process.env.NODE_ENV === 'development') {
        console.log(`[process-page] pageIdx=${page.page_index} capOk=true rawCount=${cap.data.rawProductCount} snapshots=${cap.data.snapshots.length} rows=${cap.data.snapshots.length}`)
      }

      if (productsFound > 0 && cap.data.snapshots.length === 0) {
        console.warn(
          `[scrapping] página ${page.page_index}: ${productsFound} producto(s) vistos pero ninguno pasó validación (precio/ref/título).`,
        )
      }

      const pathDerived = deriveSectionCategoryFromListingUrl(page.page_url, listingPathConfig ?? undefined)
      const rows = cap.data.snapshots.map((r) => ({
        run_id: runId,
        retailer: page.retailer,
        external_ref: r.external_ref,
        product_url: (r.source_url ?? '').trim() || page.page_url,
        product_name: r.title,
        brand: r.brand ?? null,
        price: r.price,
        currency: 'CLP',
        source_chain: page.retailer,
        listing_url: page.page_url,
        sections: pathDerived.sections,
        categories: pathDerived.categories,
        image_url: r.image_url ?? null,
        extracted_at: extractedAt,
      }))

      if (rows.length > 0) {
        checkAborted()
        // Insertar todo lo capturado: la depuración de ya homologados ocurre en paso 1
        // (`purgeScrappingRowsThatAlreadyHaveRetailLink`), no durante el barrido.
        const chunk = 50
        for (let i = 0; i < rows.length; i += chunk) {
          checkAborted() // Verificar antes de cada chunk de insert
          const slice = rows.slice(i, i + chunk) as ScrappingUpsertRow[]
          const { error: upErr } = await upsertScrappingChunkForRun(editor.admin, slice)
          if (upErr) {
            lastPersistErr = upErr
            pageError = getUserFriendlyErrorMessage(upErr, 'generic')
            break
          }
        }
        if (!pageError) {
          rowsWritten = rows.length

          // Insertar snapshots en catalog_retail_snapshots para historial de precios
          const snapshotRows = cap.data.snapshots.map((r) => ({
            retailer: page.retailer,
            external_ref: r.external_ref,
            source_url: (r.source_url ?? '').trim() || page.page_url,
            title: r.title,
            price: r.price,
            category_hint: r.category_hint ?? null,
            brand_hint: r.brand ?? null,
            captured_at: extractedAt,
            match_method: 'scrapping_capture',
          }))
          const SNAP_CHUNK = 200
          for (let i = 0; i < snapshotRows.length; i += SNAP_CHUNK) {
            checkAborted()
            const slice = snapshotRows.slice(i, i + SNAP_CHUNK)
            await editor.admin.from('catalog_retail_snapshots').insert(slice as never)
          }
        }
      }

      if (!pageError) {
        checkAborted()
        const nextUrl = computeNextRetailPageUrl(page.page_url, page.retailer, cap.data.rawProductCount)
        if (nextUrl) {
          const app = await appendScrappingPage(editor.admin, runId, page.retailer, nextUrl)
          if (app.error) {
            expandError = getUserFriendlyErrorMessage(app.error, 'generic')
          }
        }
      }
    }

    checkAborted() // Verificar antes de actualizar estado de página
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
    const tAfterFinalize = await countScrappingPages(editor.admin, runId)
    if (process.env.NODE_ENV === 'development') {
      console.log(`[process-page] after finalize pageId=${page.id} status=${pageError ? 'failed' : 'done'} counts=`, tAfterFinalize)
    }
  } catch (e) {
    // Si es error de aborto, no marcar la página como failed
    if (input.abortSignal?.aborted || e instanceof Error && e.message.includes('cancelado')) {
      throw e // Re-lanzar para que se maneje arriba
    }
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

  /**
   * Conteo en BD por respuesta, igual que `countScrappingPages` para las cajas de páginas.
   * Esto mantiene la caja "Productos" del modal sincronizada con la realidad en cada respuesta del worker,
   * en vez de quedarse con `run.rows_inserted` leído al inicio (valor fantasma hasta el cierre de wave).
   */
  const rowsCountForRun =
    (await selectScrappingRowCountForRun(editor.admin, runId)) ?? Number(run.rows_inserted ?? 0)

  let benchOut = benchStart
  const runBeforeBench = await fetchScrappingRunById(editor.admin, runId)
  if (
    waveDone &&
    runBeforeBench?.status !== 'cancelled' &&
    runBeforeBench?.status !== 'paused'
  ) {
    benchOut = await refreshRetailBenchmarksAfterWaveClose(editor.admin, run.retail_id, runId, t2.total)
  }

  const totalPagesDb = resolveScrappingRunTotalPagesForDb(waveDone, t2.total, runForSeal?.total_pages)

  /**
   * Solo actualizamos si la corrida sigue en `running`: si entre tanto el usuario la pausó (`paused`)
   * o canceló (`cancelled`), no la pisamos. Eso preserva el estado correcto del Detener / fresh start.
   */
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
    .eq('status', 'running' as never)

  const runAfter = await fetchScrappingRunById(editor.admin, runId)
  const cancelledFlag = runAfter?.status === 'cancelled' || runAfter?.status === 'paused'

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
    __diagnostic: pageDiagnostic,
    pageUrl: currentPageUrl,
    pageId: currentPageId,
  }
}

/**
 * Recibe HTML de una página capturada desde el navegador del usuario.
 * Detecta el retailer (Jumbo o Lider) y usa el parser correcto.
 * Evita anti-bot porque la petición sale de IP residencial.
 */
export async function submitPageHtmlAction(input: {
  runId: string
  pageId: string
  pageUrl: string
  html: string
}): Promise<
  | { ok: true; productsFound: number; rowsWritten: number }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  // Detectar retailer según la URL
  const isJumbo = input.pageUrl.toLowerCase().includes('jumbo.cl')
  const retailer = isJumbo ? 'jumbo' : 'lider'

  try {
    let snapshots: Array<{
      external_ref: string
      source_url: string | null
      title: string
      brand: string | null
      price: number | null
      unit_price: number | string | null
      category_hint: string | null
      description_hint: string | null
      image_url: string | null
      listing_url: string
      sections: string | null
      categories: string | null
    }>
    let rawProductCount: number

    if (isJumbo) {
      const { extractProductsFromJumboShelfHtml } = await import(
        '@/server/retail/capture/jumbo-html-parser'
      )
      const products = extractProductsFromJumboShelfHtml(input.html, input.pageUrl)
      rawProductCount = products.length

      // Derivar sección del slug de la URL
      const sectionSlug = new URL(input.pageUrl).pathname.replace(/^\//, '').split('/')[0] ?? ''

      snapshots = products.map((p) => ({
        external_ref: p.productId,
        source_url: p.productUrl,
        title: p.name,
        brand: p.brand,
        price: p.price,
        unit_price: p.price,
        category_hint: sectionSlug,
        description_hint: null,
        image_url: p.imageUrl,
        listing_url: input.pageUrl,
        sections: sectionSlug,
        categories: null,
      }))
    } else {
      const { parseLiderHtmlPage, partitionLiderCaptureForCleanInsert } = await import(
        '@/server/retail/capture/lider-capture'
      )
      const cap = parseLiderHtmlPage(input.html, input.pageUrl)
      const part = partitionLiderCaptureForCleanInsert({
        snapshots: cap.snapshots,
        stagingRows: cap.stagingRows,
        rawProductCount: cap.rawProductCount,
      })
      snapshots = part.cleanStaging.map((r) => ({
        external_ref: r.external_ref,
        source_url: r.source_url,
        title: r.title,
        brand: r.brand,
        price: r.price,
        unit_price: r.unit_price,
        category_hint: r.category_hint,
        description_hint: r.description_hint,
        image_url: r.image_url,
        listing_url: input.pageUrl,
        sections: r.category_hint,
        categories: null,
      }))
      rawProductCount = cap.rawProductCount
    }

    const extractedAt = new Date().toISOString()
    const listingPathConfig = await loadRetailListingPathConfig(editor.admin, (await fetchScrappingRunById(editor.admin, input.runId))?.retail_id ?? '')
    const pathDerived = deriveSectionCategoryFromListingUrl(input.pageUrl, listingPathConfig ?? undefined)

    const rows = snapshots.map((r) => ({
      run_id: input.runId,
      retailer,
      external_ref: r.external_ref,
      product_url: (r.source_url ?? '').trim() || input.pageUrl,
      product_name: r.title,
      brand: r.brand ?? null,
      price: r.price,
      currency: 'CLP',
      source_chain: retailer,
      listing_url: input.pageUrl,
      sections: pathDerived.sections,
      categories: pathDerived.categories,
      image_url: r.image_url ?? null,
      extracted_at: extractedAt,
    }))

    if (rows.length > 0) {
      const chunk = 50
      for (let i = 0; i < rows.length; i += chunk) {
        const slice = rows.slice(i, i + chunk) as ScrappingUpsertRow[]
        const { error: upErr } = await upsertScrappingChunkForRun(editor.admin, slice)
        if (upErr) {
          await finalizeScrappingPage(editor.admin, input.pageId, {
            status: 'failed',
            products_found: rawProductCount,
            rows_written: 0,
            error_message: getUserFriendlyErrorMessage(upErr, 'generic'),
          })
          return { ok: false, error: getUserFriendlyErrorMessage(upErr, 'generic') }
        }
      }
    }

    await finalizeScrappingPage(editor.admin, input.pageId, {
      status: 'done',
      products_found: rawProductCount,
      rows_written: rows.length,
    })

    return { ok: true, productsFound: rawProductCount, rowsWritten: rows.length }
  } catch (e) {
    await finalizeScrappingPage(editor.admin, input.pageId, {
      status: 'failed',
      products_found: 0,
      rows_written: 0,
      error_message: getUserFriendlyErrorMessage(e, 'generic'),
    })
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

/** Alias para compatibilidad con código existente */
export async function submitLiderPageHtmlAction(input: {
  runId: string
  pageId: string
  pageUrl: string
  html: string
}): Promise<
  | { ok: true; productsFound: number; rowsWritten: number }
  | { ok: false; error: string }
> {
  return submitPageHtmlAction(input)
}

export async function listRetailTargetsAction(): Promise<
  | { ok: true; retails: RetailTargetRow[] }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }
  try {
    const { data, error } = await editor.admin.rpc('list_retail_for_scrapping')
    if (error) throw error
    return { ok: true, retails: (data ?? []) as RetailTargetRow[] }
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
    const { data, error } = await editor.admin.rpc('list_scrapping_runs', {
      p_limit: 32,
    } as never)
    if (error) throw error
    return { ok: true, runs: (data ?? []) as ScrappingRunRow[] }
  } catch (e) {
    const realError = e instanceof Error ? e.message : (typeof e === 'object' && e !== null ? JSON.stringify(e) : String(e))
    console.error('[listScrappingRunsAction] ERROR REAL:', realError)
    return { ok: false, error: `DB Error: ${realError}` }
  }
}

/** Init combinado: retails + runs en una sola llamada para evitar serverless tax doble. */
export async function getScrappingInitAction(): Promise<
  | { ok: true; retails: RetailTargetRow[]; runs: ScrappingRunRow[] }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }
  try {
    const [{ data: retailsData, error: retailsErr }, { data: runsData, error: runsErr }] = await Promise.all([
      editor.admin.rpc('list_retail_for_scrapping'),
      editor.admin.rpc('list_scrapping_runs', { p_limit: 32 } as never),
    ])
    if (retailsErr) throw retailsErr
    if (runsErr) throw runsErr
    return {
      ok: true,
      retails: (retailsData ?? []) as RetailTargetRow[],
      runs: (runsData ?? []) as ScrappingRunRow[],
    }
  } catch (e) {
    const realError = e instanceof Error ? e.message : (typeof e === 'object' && e !== null ? JSON.stringify(e) : String(e))
    console.error('[getScrappingInitAction] ERROR REAL:', realError)
    return { ok: false, error: 'DB Error: ' + realError }
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
  { ok: true; result: ScrappingExactCatalogMatchStats } | { ok: false; error: string; __technical?: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  try {
    const blockingN = await countBlockingScrappingRuns(editor.admin)
    if (blockingN === -1) {
      return {
        ok: false,
        error: 'No se pudo verificar si hay scrapping en curso. Intenta nuevamente.',
      }
    }
    if (blockingN !== 0) {
      return {
        ok: false,
        error:
          'Hay una corrida de scrapping en curso o pausada. Finalizá o retomá el barrido antes de homologar.',
      }
    }

    const purgeRes = await purgeScrappingRowsThatAlreadyHaveRetailLink(editor.admin)
    if (purgeRes.error) {
      const tech = purgeRes.error instanceof Error ? purgeRes.error.message : String(purgeRes.error)
      return { ok: false, error: getUserFriendlyErrorMessage(purgeRes.error, 'generic'), __technical: tech }
    }

    const { data, error } = await editor.admin.rpc('scrapping_apply_exact_catalog_matches')
    if (error) {
      const tech = error instanceof Error ? error.message : JSON.stringify(error)
      return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic'), __technical: tech }
    }
    const raw = data as unknown
    if (raw == null || typeof raw !== 'object') {
      const tech = JSON.stringify({ raw: String(raw), type: typeof raw })
      console.error('[applyScrappingExactCatalogMatchesAction] RPC retornó valor inesperado:', tech)
      return { ok: false, error: 'No se pudo completar la acción. Intenta nuevamente.', __technical: tech }
    }
    // Supabase puede envolver jsonb en array de 1 elemento
    const o: Record<string, unknown> = Array.isArray(raw) && raw.length > 0 && raw[0] != null && typeof raw[0] === 'object' ? (raw[0] as Record<string, unknown>) : (raw as Record<string, unknown>)
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
  { ok: true; summary: HomologationStep2RpcSummary } | { ok: false; error: string; __technical?: string }
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

/** Paso 2 · cola IA gris en lotes pequeños (para progress real en el wizard). */
export async function runScrappingHomologationGrayIaBatchAction(input: {
  afterId?: string | null
  batchSize?: number
}): Promise<
  { ok: true; result: HomologGrayIaBatchResult } | { ok: false; error: string }
> {
  const gate = await assertNoRunningScrappingForHomologation()
  if (!gate.ok) return { ok: false, error: gate.error }
  const r = await processHomologationGrayIaBatch(gate.admin, input)
  if (!r.ok) return r
  revalidatePath('/captura-cadenas-2')
  return r
}

/** Paso 3 · crear productos nuevos en lotes pequeños (para progress real en el wizard). */
export async function runScrappingHomologationCreateNewBatchAction(input: {
  afterId?: string | null
  batchSize?: number
  fallbackCategoryId?: string | null
}): Promise<
  { ok: true; result: CreateNewProductsBatchResult } | { ok: false; error: string }
> {
  const gate = await assertNoRunningScrappingForHomologation()
  if (!gate.ok) return { ok: false, error: gate.error }
  const r = await processHomologationCreateNewBatch(gate.admin, input)
  if (!r.ok) return r
  revalidatePath('/captura-cadenas-2')
  revalidatePath('/catalogo')
  return r
}

/** Paso 3 · crear TODOS los productos nuevos en lotes atómicos. */
export async function runScrappingHomologationCreateNewAllAction(input?: {
  batchSize?: number
}): Promise<
  { ok: true; result: CreateNewProductsAllResult } | { ok: false; error: string; __technical?: string }
> {
  const gate = await assertNoRunningScrappingForHomologation()
  if (!gate.ok) {
    console.error('[create-new-action] ERROR:', gate.error)
    const admin = createServiceRoleClient()
    await logError(admin, {
      module: '[create-new-action]',
      message: 'Validación fallida antes de procesar',
      context: { error: gate.error },
      screen: 'create-new-products-modal',
    })
    return { ok: false, error: gate.error }
  }
  const r = await processHomologationCreateNewAll(gate.admin, input ?? {})
  if (!r.ok) {
    console.error('[create-new-action] ERROR:', r.error)
    await logError(gate.admin, {
      module: '[create-new-action]',
      message: 'Error en procesamiento atómico',
      context: { rawError: r.error },
      screen: 'create-new-products-modal',
    })
    return r
  }
  revalidatePath('/captura-cadenas-2')
  revalidatePath('/catalogo')
  return r
}

export type CatalogSectionWithCategories = {
  sectionId: string
  sectionName: string
  categories: { id: string; name: string }[]
}

/** Lista secciones y categorías del catálogo (para selector manual en Paso 3). */
export async function getCatalogSectionsWithCategoriesAction(): Promise<
  { ok: true; sections: CatalogSectionWithCategories[] } | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }
  const [secRes, catRes] = await Promise.all([
    editor.admin.from('sections').select('id, name').order('sort_order', { ascending: true }),
    editor.admin.from('categories').select('id, name, section_id').order('sort_order', { ascending: true }),
  ])
  if (secRes.error || catRes.error) return { ok: false, error: 'No se pudo cargar la taxonomía.' }
  type SecRow = { id: string; name: string }
  type CatRow = { id: string; name: string; section_id: string }
  const cats = (catRes.data ?? []) as CatRow[]
  const sections: CatalogSectionWithCategories[] = ((secRes.data ?? []) as SecRow[]).map((s) => ({
    sectionId: s.id,
    sectionName: s.name,
    categories: cats.filter((c) => c.section_id === s.id).map((c) => ({ id: c.id, name: c.name })),
  })).filter((s) => s.categories.length > 0)
  return { ok: true, sections }
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

/** Totales para UI: pending global, cola IA gris, revision humana USER_REVIEW, pending_new.
 * Usa RPC scrapping_homologation_dashboard para resolver 4 conteos en una sola query.
 */
export async function getScrappingHomologationDashboardAction(): Promise<
  | { ok: true; pendingAny: number; grayIaQueued: number; userReview: number; pendingNew: number }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const { data, error } = await editor.admin.rpc('scrapping_homologation_dashboard')
  const rawData = data as unknown
  if (error || !rawData || !Array.isArray(rawData) || rawData.length === 0) {
    return { ok: false, error: 'No se pudo leer el estado de homologacion.' }
  }

  const row = rawData[0] as Record<string, unknown>
  return {
    ok: true,
    pendingAny: Number(row.pending_any ?? 0),
    grayIaQueued: Number(row.gray_ia_queued ?? 0),
    userReview: Number(row.user_review ?? 0),
    pendingNew: Number(row.pending_new ?? 0),
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

/** Importa productos de Lider desde el script Python local del usuario.
 *  El script corre en PC (IP residencial) donde no hay anti-bot.
 */
export async function importLiderProductsFromJsonAction(input: {
  products: Array<{
    id?: string
    nombre: string
    marca?: string
    fabricante?: string
    precio?: string
    precio_anterior?: string
    precio_unitario?: string
    imagen_url?: string
    url_producto?: string
    descripcion_corta?: string
    categoria?: string
    subcategoria?: string
    listing_url?: string
  }>
  runId?: string
}): Promise<
  | { ok: true; runId: string; inserted: number; snapshots: number }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const products = input.products ?? []
  if (products.length === 0) {
    return { ok: false, error: 'No se recibieron productos para importar.' }
  }

  // Crear o reutilizar run
  let runId = input.runId?.trim()
  if (!runId) {
    const { data: retailData } = await editor.admin
      .from('retail')
      .select('id,name')
      .ilike('name', 'lider')
      .limit(1)
      .maybeSingle()
    const retailId = retailData ? (retailData as { id: string; name: string }).id : null

    const runRes = await insertScrappingRun(editor.admin, {
      retailer: 'lider',
      sourceChain: 'lider',
      totalPages: 0,
      retailId,
    })
    if ('error' in runRes) {
      return { ok: false, error: 'No se pudo crear la corrida de importación.' }
    }
    runId = runRes.id

    await editor.admin
      .from('scrapping_runs')
      .update({ status: 'completed', finished_at: new Date().toISOString() } as never)
      .eq('id', runId)
  }

  const extractedAt = new Date().toISOString()

  function parsePrice(raw: string | undefined): number {
    if (!raw) return 0
    const cleaned = raw
      .replace('$', '')
      .replace(/\./g, '')
      .replace(/,/g, '.')
      .replace(/\s*x.*$/, '')
      .trim()
    const n = Number.parseFloat(cleaned)
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
  }

  const rows: ScrappingUpsertRow[] = []
  const snapshotRows: Array<{
    retailer: string
    external_ref: string
    source_url: string | null
    title: string
    price: number
    category_hint: string | null
    brand_hint: string | null
    captured_at: string
    match_method: string
  }> = []

  for (const p of products) {
    const name = p.nombre?.trim()
    if (!name) continue

    const price = parsePrice(p.precio)
    const externalRef = p.id?.trim() || p.url_producto || `local:${hashStable(p.nombre + (p.precio ?? ''))}`
    const productUrl = p.url_producto?.trim() || ''
    const listingUrl = p.listing_url?.trim() || productUrl
    const brand = p.marca?.trim() || p.fabricante?.trim() || null
    const imageUrl = p.imagen_url?.trim() || null
    const section = p.categoria?.trim() || null
    const category = p.subcategoria?.trim() || null

    rows.push({
      run_id: runId,
      retailer: 'lider',
      external_ref: externalRef,
      product_url: productUrl,
      product_name: name,
      brand,
      price,
      currency: 'CLP',
      source_chain: 'lider',
      listing_url: listingUrl,
      sections: section,
      categories: category,
      image_url: imageUrl,
      extracted_at: extractedAt,
    })

    snapshotRows.push({
      retailer: 'lider',
      external_ref: externalRef,
      source_url: productUrl || null,
      title: name,
      price,
      category_hint: category ?? section ?? null,
      brand_hint: brand,
      captured_at: extractedAt,
      match_method: 'python_local_import',
    })
  }

  // Insertar en batch
  const chunk = 50
  let inserted = 0
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk)
    const { error: upErr } = await upsertScrappingChunkForRun(editor.admin, slice)
    if (upErr) {
      return { ok: false, error: getUserFriendlyErrorMessage(upErr, 'generic') }
    }
    inserted += slice.length
  }

  // Insertar snapshots
  const SNAP_CHUNK = 200
  for (let i = 0; i < snapshotRows.length; i += SNAP_CHUNK) {
    const slice = snapshotRows.slice(i, i + SNAP_CHUNK)
    await editor.admin.from('catalog_retail_snapshots').insert(slice as never)
  }

  // Actualizar run
  await editor.admin
    .from('scrapping_runs')
    .update({
      rows_inserted: inserted,
      pages_done: 1,
      pages_ok: 1,
      total_pages: 1,
      status: 'completed',
      finished_at: new Date().toISOString(),
    } as never)
    .eq('id', runId)

  revalidatePath('/captura-cadenas-2')
  return { ok: true, runId, inserted, snapshots: snapshotRows.length }
}

function hashStable(v: unknown): string {
  try {
    const s = JSON.stringify(v)
    let h = 0
    for (let i = 0; i < s.length; i++) {
      h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
    }
    return Math.abs(h).toString(36)
  } catch {
    return String(Date.now())
  }
}
