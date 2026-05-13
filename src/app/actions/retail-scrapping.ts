'use server'

import { revalidatePath } from 'next/cache'
import { assertProfileMembership } from '@/lib/profile/membership'
import { getProfileContext } from '@/lib/profile/context'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/server/supabase-admin'
import { getUserFriendlyErrorMessage } from '@/lib/user-friendly-errors'
import { CATALOG_GRID_PAGE_SIZE } from '@/lib/catalog-grid'
import { captureLiderRetailPage, partitionLiderCaptureForCleanInsert } from '@/server/retail/capture/lider-capture'
import {
  appendScrappingPage,
  claimNextScrappingPage,
  countScrappingPages,
  fetchScrappingRunById,
  finalizeScrappingPage,
  insertScrappingPageRows,
  insertScrappingRun,
  listRecentScrappingRuns,
  resetStaleScrappingPagesProcessing,
  type ScrappingProductRow,
  type ScrappingRunRow,
} from '@/server/retail/scrapping/lider-scrapping-service'
import {
  buildLiderFullCatalogPageSeeds,
  isLiderCatalogSystemSearchUrl,
  isLiderHtmlBrowseListingUrl,
  nextLiderCatalogSystemSliceUrl,
  nextLiderHtmlBrowseListingPageUrl,
} from '@/server/retail/capture/lider-catalog-plan'

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
 * Nueva ejecución «full»: cola de URLs de listado Lider (mismo descubrimiento que captura retail).
 * No valida taxonomía: solo acumula filas en `scrapping` para análisis posterior.
 */
export async function startLiderScrappingRunAction(): Promise<
  | { ok: true; runId: string; totalPages: number }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  try {
    const seeds = await buildLiderFullCatalogPageSeeds()
    if (seeds.length === 0) {
      return {
        ok: false,
        error: 'No se pudo armar la cola de URLs Lider. Reintenta más tarde.',
      }
    }

    const ins = await insertScrappingRun(editor.admin, {
      retailer: 'lider',
      sourceChain: 'lider',
      totalPages: seeds.length,
    })
    if ('error' in ins) {
      return { ok: false, error: getUserFriendlyErrorMessage(ins.error, 'generic') }
    }

    const { error: pqErr } = await insertScrappingPageRows(editor.admin, ins.id, 'lider', seeds)
    if (pqErr) {
      await editor.admin.from('scrapping_runs').delete().eq('id', ins.id)
      return { ok: false, error: getUserFriendlyErrorMessage(pqErr, 'generic') }
    }

    revalidatePath('/captura-cadenas-2')
    return { ok: true, runId: ins.id, totalPages: seeds.length }
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
      pageIndex: number
      productsThisPage: number
      rowsWritten: number
      nextPageIndex: number
      totalPages: number
      error?: string
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

  if (run.status === 'completed' || run.status === 'cancelled') {
    const t0 = await countScrappingPages(editor.admin, runId)
    return {
      ok: true,
      done: true,
      pageIndex: run.pages_done,
      productsThisPage: 0,
      rowsWritten: 0,
      nextPageIndex: t0.done + t0.failed,
      totalPages: t0.total,
    }
  }

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
    if (waveDone) {
      await editor.admin
        .from('scrapping_runs')
        .update({
          status: 'completed',
          finished_at: new Date().toISOString(),
          pages_done: t.done + t.failed,
          total_pages: t.total,
        } as never)
        .eq('id', runId)
    }
    revalidatePath('/captura-cadenas-2')
    return {
      ok: true,
      done: waveDone,
      pageIndex: run.pages_done,
      productsThisPage: 0,
      rowsWritten: 0,
      nextPageIndex: t.done + t.failed,
      totalPages: t.total,
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

      const rows = part.cleanStaging.map((r) => ({
        run_id: runId,
        retailer: 'lider',
        external_ref: r.external_ref,
        product_url: (r.source_url ?? '').trim() || page.page_url,
        product_name: r.title,
        brand: r.brand ?? null,
        price: r.price,
        currency: 'CLP',
        source_chain: 'lider',
        listing_url: page.page_url,
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

  await editor.admin
    .from('scrapping_runs')
    .update({
      pages_done: completed,
      total_pages: t2.total,
      status: waveDone ? 'completed' : 'running',
      finished_at: waveDone ? new Date().toISOString() : null,
      rows_inserted: rowsInsertedBase + (pageError ? 0 : rowsWritten),
      error_message: pageError ?? expandError ?? null,
    } as never)
    .eq('id', runId)

  revalidatePath('/captura-cadenas-2')
  return {
    ok: true,
    done: waveDone,
    pageIndex: page.page_index,
    productsThisPage: pageError ? 0 : productsFound,
    rowsWritten: pageError ? 0 : rowsWritten,
    nextPageIndex: completed,
    totalPages: t2.total,
    error: pageError ?? expandError,
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
