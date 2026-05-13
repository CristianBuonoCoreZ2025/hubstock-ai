'use server'

import { revalidatePath } from 'next/cache'
import { assertProfileMembership } from '@/lib/profile/membership'
import { getProfileContext } from '@/lib/profile/context'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/server/supabase-admin'
import { getUserFriendlyErrorMessage } from '@/lib/user-friendly-errors'
import { CATALOG_GRID_PAGE_SIZE } from '@/lib/catalog-grid'
import {
  deriveSectionCategoryFromListingUrl,
  type RetailListingPathConfig,
} from '@/lib/retail-listing-url-path'
import { captureLiderRetailPage, partitionLiderCaptureForCleanInsert } from '@/server/retail/capture/lider-capture'
import {
  appendScrappingPage,
  cancelAllRunningScrappingRuns,
  claimNextScrappingPage,
  countScrappingPages,
  fetchScrappingRunById,
  finalizeScrappingPage,
  insertScrappingPageRows,
  insertScrappingRun,
  purgeScrappingProductsAndPages,
  listRecentScrappingRuns,
  listRetailTargets,
  resetStaleScrappingPagesProcessing,
  type ScrappingProductRow,
} from '@/server/retail/scrapping/lider-scrapping-service'
import type { RetailTargetRow, ScrappingRunRow } from '@/types/retail-scrapping-ui'
import {
  buildLiderFullCatalogPageSeeds,
  isLiderCatalogSystemSearchUrl,
  isLiderHtmlBrowseListingUrl,
  nextLiderCatalogSystemSliceUrl,
  nextLiderHtmlBrowseListingPageUrl,
} from '@/server/retail/capture/lider-catalog-plan'

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
 * Nueva ejecución «full»: cola de URLs de listado según `retail.base_url` (motor Lider).
 * Cancela cualquier corrida `running`, vacía `scrapping` y `scrapping_pages`, luego crea la corrida nueva.
 * Conserva filas en `scrapping_runs` (historial; las canceladas quedan registradas).
 */
export async function startLiderScrappingRunAction(input: {
  retailId: string
}): Promise<
  | {
      ok: true
      runId: string
      totalPages: number
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

    const seeds = await buildLiderFullCatalogPageSeeds(baseUrl)
    if (seeds.length === 0) {
      return {
        ok: false,
        error: 'No se pudo armar la cola de URLs para este retail. Reintenta más tarde.',
      }
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
      totalPages: seeds.length,
      retailId: row.id,
    })
    if ('error' in ins) {
      return { ok: false, error: getUserFriendlyErrorMessage(ins.error, 'generic') }
    }

    const { error: pqErr } = await insertScrappingPageRows(editor.admin, ins.id, retailerKey, seeds)
    if (pqErr) {
      await editor.admin.from('scrapping_runs').delete().eq('id', ins.id)
      return { ok: false, error: getUserFriendlyErrorMessage(pqErr, 'generic') }
    }

    revalidatePath('/captura-cadenas-2')
    return {
      ok: true,
      runId: ins.id,
      totalPages: seeds.length,
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
      /** Máximo histórico de páginas en cola para este retail (referencia de barra). */
      retailMaxPages: number
      /** Máximo histórico de filas en `scrapping` para este retail (referencia). */
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

  const rowsInsertedBase = Number(run.rows_inserted ?? 0)
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
    return { ok: false, error: 'Esta ejecución no tiene páginas en cola.' }
  }

  let page = await claimNextScrappingPage(editor.admin, runId)
  if (!page && tallies0.pending > 0) {
    page = await claimNextScrappingPage(editor.admin, runId)
  }

  if (!page) {
    const t = await countScrappingPages(editor.admin, runId)
    const waveDone = t.total > 0 && t.pending === 0 && t.processing === 0
    const runGate = await fetchScrappingRunById(editor.admin, runId)
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
        const chunk = 300
        for (let i = 0; i < rows.length; i += chunk) {
          const slice = rows.slice(i, i + chunk)
          const { error: upErr } = await editor.admin
            .from('scrapping')
            .upsert(slice as never, { onConflict: 'run_id,retailer,external_ref' })
          if (upErr) {
            pageError = getUserFriendlyErrorMessage(upErr, 'generic')
            break
          }
        }
        if (!pageError) {
          rowsWritten = part.cleanStaging.length
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

    await finalizeScrappingPage(editor.admin, page.id, {
      status: pageError ? 'failed' : 'done',
      products_found: productsFound,
      rows_written: pageError ? 0 : rowsWritten,
      error_message: pageError ?? null,
    })
  } catch (e) {
    pageError = getUserFriendlyErrorMessage(e, 'generic')
    await finalizeScrappingPage(editor.admin, page.id, {
      status: 'failed',
      products_found: 0,
      rows_written: 0,
      error_message: pageError,
    })
  }

  const t2 = await countScrappingPages(editor.admin, runId)
  const completed = t2.done + t2.failed
  const waveDone = t2.total > 0 && t2.pending === 0 && t2.processing === 0
  const runSummary = scrappingRunSummaryAfterWave(waveDone, t2, pageError ?? expandError)

  let scrappingRowsTotal: number | undefined
  if (waveDone) {
    scrappingRowsTotal = await selectScrappingRowCountForRun(editor.admin, runId)
  }

  let benchOut = benchStart
  const runBeforeBench = await fetchScrappingRunById(editor.admin, runId)
  if (waveDone && runBeforeBench?.status !== 'cancelled') {
    benchOut = await refreshRetailBenchmarksAfterWaveClose(editor.admin, run.retail_id, runId, t2.total)
  }

  await editor.admin
    .from('scrapping_runs')
    .update({
      pages_done: completed,
      total_pages: t2.total,
      pages_ok: t2.done,
      pages_failed: t2.failed,
      status: waveDone ? 'completed' : 'running',
      finished_at: waveDone ? new Date().toISOString() : null,
      rows_inserted: rowsInsertedBase + (pageError ? 0 : rowsWritten),
      error_message: waveDone ? runSummary : null,
    } as never)
    .eq('id', runId)
    .neq('status', 'cancelled' as never)

  const runAfter = await fetchScrappingRunById(editor.admin, runId)
  const cancelledFlag = runAfter?.status === 'cancelled'

  const rowsInsertedAfter = rowsInsertedBase + (pageError ? 0 : rowsWritten)
  const scrappingRowsTally = waveDone ? (scrappingRowsTotal ?? rowsInsertedAfter) : rowsInsertedAfter

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
    error: pageError ?? expandError,
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
