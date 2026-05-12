'use server'

import { revalidatePath } from 'next/cache'
import { assertProfileMembership } from '@/lib/profile/membership'
import { getProfileContext } from '@/lib/profile/context'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/server/supabase-admin'
import { CATALOG_GRID_PAGE_SIZE } from '@/lib/catalog-grid'
import { normalizeCatalogAlias } from '@/lib/catalog-alias'
import {
  getUserFriendlyErrorMessage,
  isUniqueViolation,
} from '@/lib/user-friendly-errors'
import { normalizeSearchText } from '@/lib/search'
import {
  extractListedProductsFromRetailHtml,
  htmlListedProductToSyntheticVtex,
} from '@/server/retail-capture/extract-products-from-retail-html'
import { fetchLiderRetailProducts } from '@/server/retail-capture/fetch-lider-retail'
import {
  fetchRetailSweepPage,
  retailSearchMechanismLabel,
} from '@/server/retail-capture/retail-search-router'
import {
  fetchVtexSearchProducts,
  resolveVtexBaseUrlForRetailer,
  VTEX_SEARCH_PAGE_BUDGET_MS,
  VTEX_SEARCH_PER_ATTEMPT_TIMEOUT_MS,
} from '@/server/retail-capture/fetch-vtex-search'
import { extractProductArrayFromJson } from '@/server/retail-capture/parse-json-products'
import {
  mapVtexProductList,
  type RetailSnapshotRow,
} from '@/server/retail-capture/map-vtex-product'
import {
  runRetailRecaptureHomologatedBatch,
  type RecaptureHomologatedResult,
} from '@/server/retail-capture/recapture-homologated'
import {
  decideRetailMaster,
  enrichRetailCandidatesCompositeScore,
  RETAIL_COMPOSITE_THRESHOLDS,
  type MatchCandidate,
} from '@/lib/retail-association'
import {
  messageForRetailCaptureBatchCreateFailure,
  messageForRetailListingRpcFailure,
  messageForRetailSnapshotInsertFailure,
} from '@/lib/retail-rpc-errors'
import {
  retailSweepLogError,
  retailSweepLogInfo,
  retailSweepLogWarn,
  retailSweepProgressEvery,
} from '@/lib/retail-sweep-log'
import {
  isRetailIaHomologationConfigured,
  resolveRetailCatalogMatchWithOpenRouter,
  retailIaHomologationEnabled,
  retailIaHomologationMaxCallsPerRun,
} from '@/server/retail-openrouter-match'
import {
  captureLiderRetailPage,
  partitionLiderCaptureForCleanInsert,
} from '@/server/retail/capture/lider-capture'
import {
  appendRetailCapturePage,
  buildLiderFullCatalogPageSeeds,
  claimNextRetailCapturePage,
  countRetailCapturePages,
  finalizeRetailCapturePage,
  insertRetailCapturePageRows,
  isLiderCatalogSystemSearchUrl,
  isLiderHtmlBrowseListingUrl,
  nextLiderCatalogSystemSliceUrl,
  nextLiderHtmlBrowseListingPageUrl,
  resolveLiderStoreBaseUrl,
  resetStaleRetailCapturePagesProcessing,
} from '@/server/retail/capture/lider-catalog-plan'
import {
  fetchRetailBatchById,
  insertRetailCaptureBatch,
  refreshRetailBatchHomologationStats,
  updateRetailBatchProgress,
  type RetailCaptureBatchRow,
} from '@/server/retail/persistence/retail-batches'
import { homologateRetailCapturedBatch } from '@/server/retail/homologation/retail-homologation-engine'
import { countBlockingLiderTaxonomyMappings } from '@/server/retail/taxonomy/lider-taxonomy-service'

export type { RetailCaptureBatchRow } from '@/server/retail/persistence/retail-batches'

export type RetailListingRow = {
  snapshot_id: string
  retailer: string
  external_ref: string
  source_url: string | null
  title: string
  price: number
  category_hint: string | null
  brand_hint: string | null
  description_hint: string | null
  captured_at: string
  catalog_product_id: string | null
  linked_product_name: string | null
  total_count: number
}

export type RetailMatchCandidate = {
  catalog_product_id: string
  product_name: string
  category_id: string
  default_reference_price: number | null
  match_score: number
}

export type RetailHistoryRow = {
  price: number
  captured_at: string
  match_method: string | null
}

async function requireProfileViewer(): Promise<
  | { ok: true }
  | { ok: false; error: string }
> {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return { ok: false, error: 'Necesitas un perfil activo.' }
  }
  const supabase = await createClient()
  const gate = await assertProfileMembership(supabase, activeProfileId, {
    minRole: 'viewer',
  })
  if (!gate.ok) {
    return { ok: false, error: 'No tienes permisos para ver esta información.' }
  }
  return { ok: true }
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
      error: 'Se requiere rol editor o administrador para homologar precios.',
    }
  }

  try {
    const admin = createServiceRoleClient()
    return { ok: true, admin }
  } catch {
    return {
      ok: false,
      error:
        'Para guardar homologaciones configura SUPABASE_SERVICE_ROLE_KEY en el servidor.',
    }
  }
}

export async function fetchRetailListingsPage(input: {
  retailer: string | null
  unlinkedOnly: boolean
  search: string
  page: number
}): Promise<
  | { ok: true; rows: RetailListingRow[]; total: number; hasNextPage: boolean }
  | { ok: false; error: string }
> {
  const gate = await requireProfileViewer()
  if (!gate.ok) {
    return { ok: false, error: gate.error }
  }

  const supabase = await createClient()
  const retailerFilter =
    input.retailer != null && input.retailer !== 'all' ? input.retailer : null

  const { data, error } = await supabase.rpc('catalog_retail_listings_page', {
    p_retailer: retailerFilter,
    p_unlinked_only: input.unlinkedOnly,
    p_search: input.search.trim() || null,
    p_page: input.page,
    p_page_size: CATALOG_GRID_PAGE_SIZE,
  })

  if (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[fetchRetailListingsPage]', error)
    }
    return { ok: false, error: messageForRetailListingRpcFailure(error) }
  }

  const rows = (data ?? []) as RetailListingRow[]
  const total = rows[0]?.total_count ?? 0
  const hasNextPage = (input.page + 1) * CATALOG_GRID_PAGE_SIZE < total

  return { ok: true, rows, total, hasNextPage }
}

export async function fetchRetailPriceHistory(input: {
  retailer: string
  external_ref: string
}): Promise<{ ok: true; rows: RetailHistoryRow[] } | { ok: false; error: string }> {
  const gate = await requireProfileViewer()
  if (!gate.ok) {
    return { ok: false, error: gate.error }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('catalog_retail_snapshots')
    .select('price, captured_at, match_method')
    .eq('retailer', input.retailer)
    .eq('external_ref', input.external_ref)
    .order('captured_at', { ascending: false })
    .limit(80)

  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  }

  return {
    ok: true,
    rows: (data ?? []).map((r) => ({
      price: Number(r.price),
      captured_at: r.captured_at,
      match_method: r.match_method,
    })),
  }
}

export async function fetchRetailMatchCandidatesAction(input: {
  title: string
  price: number | null
  categoryId: string | null
}): Promise<
  | { ok: true; rows: RetailMatchCandidate[] }
  | { ok: false; error: string }
> {
  const gate = await requireProfileViewer()
  if (!gate.ok) {
    return { ok: false, error: gate.error }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('catalog_retail_match_candidates', {
    p_search_title: input.title,
    p_price: input.price,
    p_category_id: input.categoryId,
    p_limit: 15,
  })

  if (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[fetchRetailMatchCandidatesAction]', error)
    }
    return { ok: false, error: messageForRetailListingRpcFailure(error) }
  }

  const rows = (data ?? []).map(
    (r: {
      catalog_product_id: string
      product_name: string
      category_id: string
      default_reference_price: number | null
      match_score: number
    }) => ({
      catalog_product_id: r.catalog_product_id,
      product_name: r.product_name,
      category_id: r.category_id,
      default_reference_price:
        r.default_reference_price != null ? Number(r.default_reference_price) : null,
      match_score: Number(r.match_score),
    }),
  )

  const ranked = enrichRetailCandidatesCompositeScore(
    rows as MatchCandidate[],
    input.title,
    input.price,
  )

  return { ok: true, rows: ranked }
}

async function linkRetailListingWithAdmin(
  admin: ReturnType<typeof createServiceRoleClient>,
  input: {
    retailer: string
    external_ref: string
    catalog_product_id: string
    addTitleAlias?: boolean
    listingTitle?: string
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error: linkError } = await admin.from('catalog_retail_links').upsert(
    {
      retailer: input.retailer,
      external_ref: input.external_ref,
      catalog_product_id: input.catalog_product_id,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: 'retailer,external_ref' }
  )

  if (linkError) {
    return {
      ok: false,
      error: getUserFriendlyErrorMessage(linkError, 'generic'),
    }
  }

  if (input.addTitleAlias && input.listingTitle?.trim()) {
    const normalized = normalizeCatalogAlias(input.listingTitle)
    if (normalized.length >= 2) {
      const ins = await admin.from('catalog_product_aliases').insert({
        catalog_product_id: input.catalog_product_id,
        alias_normalized: normalized,
      } as never)
      if (ins.error && !isUniqueViolation(ins.error)) {
        return {
          ok: false,
          error: getUserFriendlyErrorMessage(ins.error, 'generic'),
        }
      }
    }
  }

  return { ok: true }
}

async function syncRetailCapturedProductAfterManualLink(
  admin: ReturnType<typeof createServiceRoleClient>,
  input: { retailer: string; external_ref: string; catalog_product_id: string },
): Promise<void> {
  await admin
    .from('retail_captured_products')
    .update({
      catalog_product_id: input.catalog_product_id,
      status: 'linked',
      decision_source: 'manual_ui',
      decision_confidence: null,
      decision_reason: 'Homologación manual desde el catálogo.',
      review_tray: null,
      group_key: null,
      suggested_master_id: null,
    } as never)
    .eq('retailer', input.retailer)
    .eq('external_ref', input.external_ref)
}

export async function linkRetailListingAction(input: {
  retailer: string
  external_ref: string
  catalog_product_id: string
  /** Si es true, registra el título del ítem como alias del maestro (útil para boletas). */
  addTitleAlias?: boolean
  listingTitle?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) {
    return { ok: false, error: editor.error }
  }

  const linkRes = await linkRetailListingWithAdmin(editor.admin, input)
  if (!linkRes.ok) return linkRes

  await syncRetailCapturedProductAfterManualLink(editor.admin, {
    retailer: input.retailer,
    external_ref: input.external_ref,
    catalog_product_id: input.catalog_product_id,
  })

  revalidatePath('/catalog')
  return { ok: true }
}

const CAPTURE_RETAILERS = ['jumbo', 'lider', 'central_mayorista'] as const
export type CaptureRetailer = (typeof CAPTURE_RETAILERS)[number]

function isCaptureRetailer(s: string): s is CaptureRetailer {
  return (CAPTURE_RETAILERS as readonly string[]).includes(s)
}

/** Desactivar toda auto-homologación tras insert (útil si el hosting corta por tiempo). */
function retailAutoAssociateEnabled(): boolean {
  const v = process.env.RETAIL_AUTO_ASSOCIATE_ENABLED?.trim().toLowerCase()
  if (v === '0' || v === 'false' || v === 'no') return false
  return true
}

/**
 * Máximo de filas de **esta importación** para la pasada difusa por RPC (tras homologación exacta masiva).
 * Por defecto conservador para serverless; subí con RETAIL_AUTO_ASSOCIATE_MAX_PER_RUN.
 */
function retailAutoAssociateMaxPerRun(): number {
  const raw = process.env.RETAIL_AUTO_ASSOCIATE_MAX_PER_RUN
  const n = raw != null && raw !== '' ? Number(raw) : NaN
  if (Number.isFinite(n) && n >= 0) return Math.min(Math.floor(n), 5000)
  return 400
}

/** Llamadas concurrentes a la RPC de candidatos + upsert de vínculo (evita cola secuencial larga). */
const RETAIL_AUTO_ASSOCIATE_CONCURRENCY = 8

/** Respuesta exitosa de `runRetailCatalogSweepAction` (tipado para la UI). */
export type RetailCatalogSweepOkResult = {
  ok: true
  retailer: CaptureRetailer
  inserted: number
  pagesFetched: number
  stoppedEarly: boolean
  hitSafetyItemCap: boolean
  /** Término de búsqueda amplia realmente usado (tras normalizar `*`). */
  effectiveSweepTerm: string
  /** true si el usuario envió solo `*` y se reemplazó. */
  sweepReplacedStarOnly: boolean
  /** URL base desde la que se llamó a la tienda. */
  vtexBaseUrlUsed: string
  /** Igual que el input: todo el catálogo vs máximo manual. */
  captureAll: boolean
  /** Tope de ítems de esta ejecución (1M en modo completo o el máximo manual). */
  maxTotalLimit: number
} & RetailImportAutoAssociateFields

export type RetailImportAutoAssociateFields = {
  /** Homologación masiva por título = maestro (normalizeSearchText), un maestro por texto; misma regla de marca que «título idéntico». */
  exactTitleLinked: number
  exactTitleSkippedAmbiguousCatalog: number
  exactTitleSkippedNoCatalogProduct: number
  exactTitleSkippedHeuristic: number
  autoLinked: number
  /** Vínculos logrados en la pasada difusa **solo** por OpenRouter (tras fallar la heurística). */
  autoLinkedByAi: number
  autoAssociateCapped: boolean
  /** Filas consideradas para homologar automática (0 si está desactivada por env). */
  autoAssociateAttempted: number
  /** Fallos de RPC o de guardado del vínculo. */
  autoAssociateFailed: number
  /** Candidatos evaluados pero la heurística no autorizó vínculo automático. */
  autoAssociateSkippedNoMatch: number
  /** true si RETAIL_AUTO_ASSOCIATE_ENABLED desactiva la pasada automática. */
  autoAssociateDisabled: boolean
}

type CatalogMiniForExactIndex = {
  id: string
  name: string
  category_id: string
  default_reference_price: number | null
}

type ExactNormIndexEntry =
  | { status: 'unique'; product: CatalogMiniForExactIndex }
  | { status: 'ambiguous' }

/**
 * Índice nombre-normalizado → maestro (o ambiguo si hay más de un producto activo con el mismo texto normalizado).
 */
async function buildCatalogExactNormIndex(
  admin: ReturnType<typeof createServiceRoleClient>,
): Promise<Map<string, ExactNormIndexEntry>> {
  const map = new Map<string, ExactNormIndexEntry>()
  const pageSize = 1000
  let from = 0
  for (;;) {
    const { data, error } = await admin
      .from('catalog_products')
      .select('id,name,category_id,default_reference_price')
      .eq('active', true)
      .order('id')
      .range(from, from + pageSize - 1)

    if (error) {
      retailSweepLogError('índice exacto catálogo: lectura falló', {
        message: error.message,
      })
      throw new Error(error.message)
    }
    const rows = data ?? []
    if (rows.length === 0) break

    for (const raw of rows) {
      const r = raw as {
        id: string
        name: string
        category_id: string
        default_reference_price: number | null
      }
      const k = normalizeSearchText(r.name)
      if (k.length < 2) continue
      const cur = map.get(k)
      const product: CatalogMiniForExactIndex = {
        id: r.id,
        name: r.name,
        category_id: r.category_id,
        default_reference_price:
          r.default_reference_price != null ? Number(r.default_reference_price) : null,
      }
      if (!cur) {
        map.set(k, { status: 'unique', product })
      } else if (cur.status === 'unique') {
        map.set(k, { status: 'ambiguous' })
      }
    }

    if (rows.length < pageSize) break
    from += pageSize
  }
  return map
}

/** Todas las capturas sin vínculo de una cadena (paginado; una lectura por barrido). */
async function fetchAllUnlinkedRetailListingRows(
  admin: ReturnType<typeof createServiceRoleClient>,
  retailer: CaptureRetailer,
): Promise<RetailListingRow[]> {
  const out: RetailListingRow[] = []
  const pageSize = 500
  let page = 0
  for (;;) {
    const { data, error } = await admin.rpc('catalog_retail_listings_page', {
      p_retailer: retailer,
      p_unlinked_only: true,
      p_search: null,
      p_page: page,
      p_page_size: pageSize,
    } as never)

    if (error) {
      retailSweepLogError('listado sin vínculo para homologación exacta', {
        message: error.message,
        retailer,
      })
      throw new Error(error.message)
    }

    const chunk = (data ?? []) as RetailListingRow[]
    out.push(...chunk)
    if (chunk.length < pageSize) break
    page += 1
    if (page > 20_000) {
      retailSweepLogWarn('homologación exacta: tope de páginas de seguridad', {
        retailer,
        rowsSoFar: out.length,
      })
      break
    }
  }
  return out
}

async function bulkExactTitleAutoLinkForRetailer(
  admin: ReturnType<typeof createServiceRoleClient>,
  retailer: CaptureRetailer,
): Promise<{
  linked: number
  skippedAmbiguousCatalog: number
  skippedNoCatalogProduct: number
  skippedHeuristic: number
}> {
  const catalogIndex = await buildCatalogExactNormIndex(admin)
  const unlinked = await fetchAllUnlinkedRetailListingRows(admin, retailer)

  let skippedAmbiguousCatalog = 0
  let skippedNoCatalogProduct = 0
  let skippedHeuristic = 0

  type PendingLink = {
    retailer: string
    external_ref: string
    catalog_product_id: string
    listingTitle: string
  }
  const pending: PendingLink[] = []

  for (const row of unlinked) {
    const rt = normalizeSearchText(row.title)
    if (rt.length < 2) {
      skippedNoCatalogProduct++
      continue
    }
    const entry = catalogIndex.get(rt)
    if (!entry) {
      skippedNoCatalogProduct++
      continue
    }
    if (entry.status === 'ambiguous') {
      skippedAmbiguousCatalog++
      continue
    }

    const decision = decideRetailMaster({
      candidates: [
        {
          catalog_product_id: entry.product.id,
          product_name: entry.product.name,
          category_id: entry.product.category_id,
          default_reference_price: entry.product.default_reference_price,
          match_score: 0.995,
        },
      ],
      brandHint: row.brand_hint,
      descriptionHint: row.description_hint,
      retailTitle: row.title,
      retailPrice: row.price,
    })

    if (decision.action !== 'link') {
      skippedHeuristic++
      continue
    }

    pending.push({
      retailer: row.retailer,
      external_ref: row.external_ref,
      catalog_product_id: decision.catalogProductId,
      listingTitle: row.title,
    })
  }

  const LINK_CHUNK = 350
  let linked = 0
  for (let i = 0; i < pending.length; i += LINK_CHUNK) {
    const slice = pending.slice(i, i + LINK_CHUNK)
    const rowsUpsert = slice.map((p) => ({
      retailer: p.retailer,
      external_ref: p.external_ref,
      catalog_product_id: p.catalog_product_id,
      updated_at: new Date().toISOString(),
    }))
    const { error: upErr } = await admin
      .from('catalog_retail_links')
      .upsert(rowsUpsert as never, { onConflict: 'retailer,external_ref' })
    if (upErr) {
      retailSweepLogError('homologación exacta: upsert vínculos', {
        message: upErr.message,
        chunk: Math.floor(i / LINK_CHUNK),
      })
      throw new Error(getUserFriendlyErrorMessage(upErr, 'generic'))
    }
    linked += slice.length
  }

  const aliasRows: { catalog_product_id: string; alias_normalized: string }[] = []
  const seenAlias = new Set<string>()
  for (const p of pending) {
    const normalized = normalizeCatalogAlias(p.listingTitle)
    if (normalized.length < 2) continue
    const key = `${p.catalog_product_id}\0${normalized}`
    if (seenAlias.has(key)) continue
    seenAlias.add(key)
    aliasRows.push({
      catalog_product_id: p.catalog_product_id,
      alias_normalized: normalized,
    })
  }

  const ALIAS_CHUNK = 200
  for (let i = 0; i < aliasRows.length; i += ALIAS_CHUNK) {
    const chunk = aliasRows.slice(i, i + ALIAS_CHUNK)
    const { error: aErr } = await admin.from('catalog_product_aliases').insert(chunk as never)
    if (aErr && !isUniqueViolation(aErr)) {
      retailSweepLogWarn('homologación exacta: alias no insertado', {
        message: aErr.message,
      })
    }
  }

  return {
    linked,
    skippedAmbiguousCatalog,
    skippedNoCatalogProduct,
    skippedHeuristic,
  }
}

async function filterSnapshotRowsStillUnlinked(
  admin: ReturnType<typeof createServiceRoleClient>,
  retailer: string,
  rows: RetailSnapshotRow[],
): Promise<RetailSnapshotRow[]> {
  if (rows.length === 0) return []
  const refs = [...new Set(rows.map((r) => r.external_ref))]
  const linked = new Set<string>()
  const chunkSize = 500
  for (let i = 0; i < refs.length; i += chunkSize) {
    const slice = refs.slice(i, i + chunkSize)
    const { data } = await admin
      .from('catalog_retail_links')
      .select('external_ref')
      .eq('retailer', retailer)
      .in('external_ref', slice)
    for (const r of data ?? []) {
      linked.add((r as { external_ref: string }).external_ref)
    }
  }
  return rows.filter((r) => !linked.has(r.external_ref))
}

function matchCandidatesFromRpc(candRaw: unknown): MatchCandidate[] {
  const candList = Array.isArray(candRaw) ? candRaw : []
  return candList.map(
    (r: {
      catalog_product_id: string
      product_name: string
      category_id: string
      default_reference_price: number | null
      match_score: number
    }) => ({
      catalog_product_id: String(r.catalog_product_id),
      product_name: String(r.product_name),
      category_id: String(r.category_id),
      default_reference_price:
        r.default_reference_price != null ? Number(r.default_reference_price) : null,
      match_score: Number(r.match_score),
    }),
  )
}

function candidatesPayloadForOpenRouter(candidates: MatchCandidate[]): Array<{
  id: string
  nombre: string
  precio_referencia: number | null
}> {
  const max = 12
  return candidates.slice(0, max).map((c) => ({
    id: c.catalog_product_id,
    nombre: c.product_name.slice(0, 220),
    precio_referencia: c.default_reference_price,
  }))
}

type RowOutcome = 'linked' | 'linked_ai' | 'failed' | 'skipped'

/** Una fila retail (captura o listado RPC). */
type RetailMatchRowInput = {
  retailer: string
  external_ref: string
  title: string
  price: number | null
  brand_hint: string | null
  description_hint: string | null
}

/**
 * Heurística local + opcional OpenRouter si `iaBudget` no es null y queda cupo.
 */
async function matchRetailCaptureRow(
  admin: ReturnType<typeof createServiceRoleClient>,
  row: RetailMatchRowInput,
  iaBudget: { remaining: number } | null,
): Promise<RowOutcome> {
  try {
    const searchTitle =
      row.description_hint ? `${row.title} ${row.description_hint}`.trim() : row.title
    const { data: candRaw, error: cErr } = await admin.rpc('catalog_retail_match_candidates', {
      p_search_title: searchTitle,
      p_price: row.price,
      p_category_id: null,
      p_limit: 15,
    } as never)
    if (cErr) return 'failed'
    const candidates = enrichRetailCandidatesCompositeScore(
      matchCandidatesFromRpc(candRaw),
      row.title,
      row.price,
    )
    const decision = decideRetailMaster({
      candidates,
      brandHint: row.brand_hint,
      descriptionHint: row.description_hint,
      retailTitle: row.title,
      retailPrice: row.price,
      ...RETAIL_COMPOSITE_THRESHOLDS,
    })
    if (decision.action === 'link') {
      const linkTry = await linkRetailListingWithAdmin(admin, {
        retailer: row.retailer as CaptureRetailer,
        external_ref: row.external_ref,
        catalog_product_id: decision.catalogProductId,
        addTitleAlias: true,
        listingTitle: row.title,
      })
      if (!linkTry.ok) return 'failed'
      return 'linked'
    }

    if (iaBudget == null || iaBudget.remaining <= 0 || candidates.length === 0) {
      return 'skipped'
    }

    const payload = candidatesPayloadForOpenRouter(candidates)
    if (payload.length === 0) return 'skipped'

    iaBudget.remaining -= 1
    const ai = await resolveRetailCatalogMatchWithOpenRouter({
      retailTitle: row.title,
      retailPrice: row.price,
      brandHint: row.brand_hint,
      descriptionHint: row.description_hint,
      candidates: payload,
    })
    if (!ai) return 'skipped'

    const linkTry = await linkRetailListingWithAdmin(admin, {
      retailer: row.retailer as CaptureRetailer,
      external_ref: row.external_ref,
      catalog_product_id: ai.catalogProductId,
      addTitleAlias: true,
      listingTitle: row.title,
    })
    if (!linkTry.ok) return 'failed'

    retailSweepLogInfo('auto-asociación: vínculo por OpenRouter', {
      retailer: row.retailer,
      external_ref: row.external_ref,
      confidence: ai.confidence,
    })
    return 'linked_ai'
  } catch (e) {
    retailSweepLogWarn('auto-asociación: fila omitida por error', {
      retailer: row.retailer,
      external_ref: row.external_ref,
      message: e instanceof Error ? e.message : String(e),
    })
    return 'failed'
  }
}

function accumulateRowOutcome(
  o: RowOutcome,
  tallies: { linked: number; linkedByAi: number; failed: number; skippedNoMatch: number },
): void {
  if (o === 'linked') tallies.linked++
  else if (o === 'linked_ai') {
    tallies.linked++
    tallies.linkedByAi++
  } else if (o === 'failed') tallies.failed++
  else tallies.skippedNoMatch++
}

/**
 * Pasada difusa (RPC `catalog_retail_match_candidates` + decideRetailMaster):
 * solo sobre filas de esta importación que **siguen sin vínculo** tras la homologación exacta masiva.
 * Si `RETAIL_IA_HOMOLOGATION_ENABLED` y hay `OPENROUTER_API_KEY`, segunda pasada con modelo de documento (OpenRouter)
 * entre los mismos candidatos cuando la heurística no vincula (tope `RETAIL_IA_HOMOLOG_MAX_PER_RUN`).
 */
async function autoAssociateSnapshotRowsAfterInsert(
  admin: ReturnType<typeof createServiceRoleClient>,
  rows: RetailSnapshotRow[],
): Promise<{
  linked: number
  linkedByAi: number
  attempted: number
  failed: number
  skippedNoMatch: number
  disabled: boolean
}> {
  try {
    if (!retailAutoAssociateEnabled()) {
      return {
        linked: 0,
        linkedByAi: 0,
        attempted: 0,
        failed: 0,
        skippedNoMatch: 0,
        disabled: true,
      }
    }

    const max = retailAutoAssociateMaxPerRun()
    const slice = rows.slice(0, max)
    const useIa = retailIaHomologationEnabled() && isRetailIaHomologationConfigured()
    const iaBudget = useIa ? { remaining: retailIaHomologationMaxCallsPerRun() } : null

    function rowInput(r: RetailSnapshotRow): RetailMatchRowInput {
      return {
        retailer: r.retailer,
        external_ref: r.external_ref,
        title: r.title,
        price: r.price,
        brand_hint: r.brand_hint,
        description_hint: r.description_hint,
      }
    }

    const tallies = { linked: 0, linkedByAi: 0, failed: 0, skippedNoMatch: 0 }

    if (useIa) {
      for (const row of slice) {
        const o = await matchRetailCaptureRow(admin, rowInput(row), iaBudget)
        accumulateRowOutcome(o, tallies)
      }
    } else {
      for (let i = 0; i < slice.length; i += RETAIL_AUTO_ASSOCIATE_CONCURRENCY) {
        const batch = slice.slice(i, i + RETAIL_AUTO_ASSOCIATE_CONCURRENCY)
        const outcomes = await Promise.all(
          batch.map((row) => matchRetailCaptureRow(admin, rowInput(row), null)),
        )
        for (const o of outcomes) accumulateRowOutcome(o, tallies)
      }
    }

    return {
      linked: tallies.linked,
      linkedByAi: tallies.linkedByAi,
      attempted: slice.length,
      failed: tallies.failed,
      skippedNoMatch: tallies.skippedNoMatch,
      disabled: false,
    }
  } catch (e) {
    retailSweepLogError('auto-asociación tras insert: fallo global', {
      message: e instanceof Error ? e.message : String(e),
    })
    return {
      linked: 0,
      linkedByAi: 0,
      attempted: 0,
      failed: 0,
      skippedNoMatch: 0,
      disabled: false,
    }
  }
}

function packRetailImportAutoAssociate(
  rowsLength: number,
  assoc: Awaited<ReturnType<typeof autoAssociateSnapshotRowsAfterInsert>>,
  exact?: Partial<
    Pick<
      RetailImportAutoAssociateFields,
      | 'exactTitleLinked'
      | 'exactTitleSkippedAmbiguousCatalog'
      | 'exactTitleSkippedNoCatalogProduct'
      | 'exactTitleSkippedHeuristic'
    >
  >,
): RetailImportAutoAssociateFields {
  const max = retailAutoAssociateMaxPerRun()
  return {
    exactTitleLinked: exact?.exactTitleLinked ?? 0,
    exactTitleSkippedAmbiguousCatalog: exact?.exactTitleSkippedAmbiguousCatalog ?? 0,
    exactTitleSkippedNoCatalogProduct: exact?.exactTitleSkippedNoCatalogProduct ?? 0,
    exactTitleSkippedHeuristic: exact?.exactTitleSkippedHeuristic ?? 0,
    autoLinked: assoc.linked,
    autoLinkedByAi: assoc.linkedByAi,
    autoAssociateCapped: rowsLength > max,
    autoAssociateAttempted: assoc.attempted,
    autoAssociateFailed: assoc.failed,
    autoAssociateSkippedNoMatch: assoc.skippedNoMatch,
    autoAssociateDisabled: assoc.disabled,
  }
}

async function safeBulkExactTitleAutoLink(
  admin: ReturnType<typeof createServiceRoleClient>,
  retailer: CaptureRetailer,
): Promise<
  Pick<
    RetailImportAutoAssociateFields,
    | 'exactTitleLinked'
    | 'exactTitleSkippedAmbiguousCatalog'
    | 'exactTitleSkippedNoCatalogProduct'
    | 'exactTitleSkippedHeuristic'
  >
> {
  try {
    const r = await bulkExactTitleAutoLinkForRetailer(admin, retailer)
    return {
      exactTitleLinked: r.linked,
      exactTitleSkippedAmbiguousCatalog: r.skippedAmbiguousCatalog,
      exactTitleSkippedNoCatalogProduct: r.skippedNoCatalogProduct,
      exactTitleSkippedHeuristic: r.skippedHeuristic,
    }
  } catch (e) {
    retailSweepLogError('homologación por título exacto (masiva): abortada', {
      retailer,
      message: e instanceof Error ? e.message : String(e),
    })
    return {
      exactTitleLinked: 0,
      exactTitleSkippedAmbiguousCatalog: 0,
      exactTitleSkippedNoCatalogProduct: 0,
      exactTitleSkippedHeuristic: 0,
    }
  }
}

/** Primer fallo «sin productos parseables» — mensaje por cadena (Lider ≠ VTEX). */
function sweepFailureNoParseableProducts(
  retailer: CaptureRetailer,
  hint: string,
  base: string,
): { error: string; suggestJsonImport: boolean; suggestedJsonBaseUrl: string | null } {
  switch (retailer) {
    case 'lider':
      return {
        error:
          `Lider (Next.js / carpeta lider/): en la página de búsqueda no aparecieron productos con precio para «${hint}». ` +
          'Probá un término más concreto. Para catálogo masivo usá el scraper por categorías → SQLite → scripts/import_retail_snapshots.py (scripts/RETAIL_CAPTURE.md). ' +
          'Si la tienda cambió la URL de búsqueda, definí RETAIL_LIDER_SEARCH_URL_TEMPLATE en el servidor (ruta con {query} y {page}).',
        suggestJsonImport: false,
        suggestedJsonBaseUrl: base,
      }
    case 'jumbo':
      return {
        error:
          `Jumbo (VTEX): ningún intento devolvió una lista usable de productos para «${hint}» (la tienda suele responder HTML). ` +
          'Probá otro término de barrido (p. ej. «a», «de», «la»), dejá el campo vacío para usar el valor por defecto del servidor, revisá RETAIL_VTEX_SWEEP_SEARCH_TERM o importá JSON desde DevTools → Network.',
        suggestJsonImport: true,
        suggestedJsonBaseUrl: base,
      }
    case 'central_mayorista':
      return {
        error:
          'Central Mayorista (VTEX): no hubo lista JSON usable para «' +
          hint +
          '». Revisá RETAIL_CENTRAL_MAYORISTA_VTEX_BASE_URL, el término de barrido o importá JSON desde DevTools.',
        suggestJsonImport: true,
        suggestedJsonBaseUrl: base,
      }
    default:
      return {
        error: 'No se pudieron obtener productos para «' + hint + '».',
        suggestJsonImport: true,
        suggestedJsonBaseUrl: base,
      }
  }
}

function summarizeAttemptStatuses(
  attempts?: Array<{ reason?: string; status?: number }>
): string {
  if (!attempts || attempts.length === 0) return ''
  const labels = attempts.map((a) => {
    if (a.reason === 'http_error') return `http:${String(a.status ?? '?')}`
    return String(a.reason ?? 'unknown')
  })
  return labels.join(', ')
}

function vtexHttpErrorMessage(
  status?: number,
  attempts?: Array<{ reason?: string; status?: number }>
): string {
  const trail = summarizeAttemptStatuses(attempts)
  const suffix = trail ? ` Detalle técnico: ${trail}.` : ''

  // Caso "todos los caminos muertos": ya probó múltiples endpoints (catalog + intelligent search)
  // y todos respondieron 404/410. No tiene sentido pedirle al usuario que cambie el término.
  const totalAttempts = attempts?.length ?? 0
  const allDead =
    totalAttempts >= 3 &&
    (attempts ?? []).every(
      (a) => a.reason === 'http_error' && (a.status === 404 || a.status === 410),
    )
  if (allDead) {
    return (
      'Esta tienda no tiene endpoints públicos de búsqueda disponibles desde el servidor. ' +
      'No es problema del término ni de la red. Usá importación JSON manualmente desde el botón ' +
      '«JSON o búsqueda puntual» (pegá la respuesta de la API VTEX desde DevTools del navegador).' +
      suffix
    )
  }

  if (status === 404) {
    return (
      'La tienda no expone un endpoint público de búsqueda para esta URL base (HTTP 404). ' +
      'Verificá que la URL sea solo el dominio de la tienda (por ejemplo https://www.jumbo.cl, sin rutas), ' +
      'probá otro término de barrido, o usá importación JSON.' +
      suffix
    )
  }
  if (status === 410) {
    return (
      'La tienda marcó como obsoleto el endpoint de búsqueda (HTTP 410) y los fallbacks automáticos ' +
      'tampoco respondieron. Usá importación JSON desde el botón «JSON o búsqueda puntual».' +
      suffix
    )
  }
  if (status === 401 || status === 403) {
    return (
      `La tienda bloqueó el acceso desde servidor (HTTP ${status}). ` +
      'Probá importación JSON desde navegador o capturas en tandas pequeñas.' +
      suffix
    )
  }
  if (status === 429) {
    return (
      'La tienda respondió límite de tasa (HTTP 429). Esperá unos minutos y reintentá.' +
      suffix
    )
  }
  if (typeof status === 'number') {
    return (
      `La tienda respondió con error HTTP ${status} al pedir datos. ` +
      'Revisá la URL base VTEX o probá otro término.' +
      suffix
    )
  }
  return 'No se pudo completar la acción en la búsqueda de la tienda. Intenta nuevamente.'
}

export async function runRetailWebCaptureAction(input: {
  retailer: CaptureRetailer
  searchQuery: string
  maxItems: number
}): Promise<
  | ({ ok: true; inserted: number } & RetailImportAutoAssociateFields)
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) {
    return { ok: false, error: editor.error }
  }

  const q = normalizeSearchText(input.searchQuery)
  if (q.length < 2) {
    return {
      ok: false,
      error: 'Escribe al menos 2 caracteres para buscar.',
    }
  }

  const base =
    input.retailer === 'lider' ? resolveLiderStoreBaseUrl() : resolveVtexBaseUrlForRetailer(input.retailer)
  if (!base) {
    return {
      ok: false,
      error:
        'La captura automática para Central Mayorista requiere RETAIL_CENTRAL_MAYORISTA_VTEX_BASE_URL en el servidor (URL base VTEX) o podés importar JSON desde esta pantalla.',
    }
  }

  const maxItems = Math.min(100, Math.max(1, Math.floor(input.maxItems || 40)))

  const fetched =
    input.retailer === 'lider' ?
      await fetchLiderRetailProducts(base, q, maxItems)
    : await fetchVtexSearchProducts(base, q, maxItems)
  if (!fetched.ok) {
    if (fetched.reason === 'not_json') {
      return {
        ok: false,
        error:
          input.retailer === 'lider' ?
            'No aparecieron productos con precio en la búsqueda HTML para ese término. Probá otra palabra o usá la carpeta lider con import_retail_snapshots.py para catálogo completo.'
          : 'La tienda no devolvió datos utilizables desde el servidor en este momento. Probá más tarde o pegá JSON de la respuesta desde DevTools.',
      }
    }
    if (fetched.reason === 'http_error') {
      return {
        ok: false,
        error: vtexHttpErrorMessage(fetched.status, fetched.attempts),
      }
    }
    return {
      ok: false,
      error:
        'La tienda no respondió a tiempo o hubo un problema de red. Intenta nuevamente o usa importación JSON.',
    }
  }

  const rows = mapVtexProductList(fetched.products, {
    retailer: input.retailer,
    vtexBaseUrl: base,
    matchMethod: input.retailer === 'lider' ? 'app_lider_next_search' : 'app_vtex_search',
  })

  if (rows.length === 0) {
    return {
      ok: false,
      error: 'No se encontraron productos con precio para importar.',
    }
  }

  const { error } = await editor.admin
    .from('catalog_retail_snapshots')
    .insert(rows as never)

  if (error) {
    return {
      ok: false,
      error: getUserFriendlyErrorMessage(error, 'generic'),
    }
  }

  const exactPack = await safeBulkExactTitleAutoLink(editor.admin, input.retailer)
  const remainingRows = await filterSnapshotRowsStillUnlinked(editor.admin, input.retailer, rows)
  const assoc = await autoAssociateSnapshotRowsAfterInsert(editor.admin, remainingRows)
  revalidatePath('/catalog')
  return {
    ok: true,
    inserted: rows.length,
    ...packRetailImportAutoAssociate(rows.length, assoc, exactPack),
  }
}

const SWEEP_PAGE_SIZE = 50
const SWEEP_INSERT_CHUNK = 450
/** Límite cuando el usuario elige un máximo manual (no «todo el catálogo»). */
const SWEEP_MAX_TOTAL_ITEMS = 50_000
/** Tope de seguridad si captureAll: no corta antes salvo límite de páginas o API vacía. */
const SWEEP_CAPTURE_ALL_CAP = 1_000_000

/**
 * VTEX/Chile: un comodín solo `*` suele responder HTML sin lista de productos útil.
 * Se sustituye por `RETAIL_VTEX_SWEEP_SEARCH_TERM` o `a`.
 */
function effectiveRetailSweepSearchTerm(fromUi: string | undefined | null): {
  term: string
  replacedStarOnly: boolean
} {
  const fallback = process.env.RETAIL_VTEX_SWEEP_SEARCH_TERM?.trim() || 'a'
  const raw = (fromUi ?? '').trim().slice(0, 200)
  if (!raw) {
    return { term: fallback, replacedStarOnly: false }
  }
  const nonSpace = raw.replace(/\s+/g, '')
  if (nonSpace.length > 0 && /^\*+$/.test(nonSpace)) {
    return { term: fallback, replacedStarOnly: true }
  }
  return { term: raw, replacedStarOnly: false }
}

/**
 * Recorre el endpoint VTEX en páginas (mismo término de búsqueda amplio) para nutrir capturas de una sola tienda.
 * Término efectivo: UI → `RETAIL_VTEX_SWEEP_SEARCH_TERM` → `a`; `*` solo se reemplaza automáticamente.
 */
export async function runRetailCatalogSweepAction(input: {
  retailer: CaptureRetailer
  maxTotalItems?: number
  /** Si viene vacío, se usa env o «a». Máx. 200 caracteres. El valor solo `*` se normaliza en servidor. */
  sweepSearchTerm?: string | null
  /**
   * Si es true, pagina hasta que la API devuelva vacío o página incompleta (deduplicando), hasta SWEEP_CAPTURE_ALL_CAP.
   * Si es false, usa `maxTotalItems` acotado a SWEEP_MAX_TOTAL_ITEMS.
   */
  captureAll?: boolean
}): Promise<RetailCatalogSweepOkResult | {
      ok: false
      error: string
      suggestJsonImport?: boolean
      /** VTEX storefront base conocida por el servidor cuando el barrido puede sugerir JSON. */
      suggestedJsonBaseUrl?: string | null
    }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) {
    return { ok: false, error: editor.error }
  }

  if (input.retailer === 'lider') {
    return {
      ok: false,
      error:
        'Para Lider el barrido masivo por término no está disponible. Usá la captura total por cola de páginas (Opciones avanzadas) o la búsqueda puntual con al menos 2 caracteres.',
      suggestJsonImport: false,
    }
  }

  const base = resolveVtexBaseUrlForRetailer(input.retailer)
  if (!base) {
    const centralHelp =
      input.retailer === 'central_mayorista' ?
        ' Configurá RETAIL_CENTRAL_MAYORISTA_VTEX_BASE_URL en el servidor con la URL base del catálogo (dominio público de la tienda, sin ruta de producto). Ejemplo típico: https://www.centralmayorista.cl'
      : ''
    return {
      ok: false,
      error:
        'La captura automática para esta cadena no está configurada en el servidor.' +
        centralHelp +
        ' También podés importar JSON desde esta pantalla.',
      suggestJsonImport: true,
    }
  }

  const captureAll = input.captureAll !== false

  const maxTotal = captureAll
    ? SWEEP_CAPTURE_ALL_CAP
    : Math.min(
        Math.max(50, Math.floor(input.maxTotalItems ?? 600)),
        SWEEP_MAX_TOTAL_ITEMS,
      )

  const fromUi = input.sweepSearchTerm?.trim()
  const { term: sweepTerm, replacedStarOnly } = effectiveRetailSweepSearchTerm(fromUi ?? '')
  if (replacedStarOnly) {
    retailSweepLogWarn('término de barrido «solo *» sustituido (VTEX suele devolver HTML sin productos)', {
      retailer: input.retailer,
      effectiveTerm: sweepTerm,
    })
  }
  // Páginas VTEX de 50 ítems; en captureAll muchas páginas por catálogos grandes.
  const maxPages = captureAll
    ? 100_000
    : Math.min(
        15_000,
        Math.ceil(maxTotal / SWEEP_PAGE_SIZE) * 5 + 200,
      )

  retailSweepLogInfo('barrido iniciado', {
    retailer: input.retailer,
    captureAll,
    maxTotal,
    maxPages,
    sweepTermPreview:
      sweepTerm.length > 80 ? `${sweepTerm.slice(0, 80)}…` : sweepTerm,
  })

  const accum: ReturnType<typeof mapVtexProductList> = []
  const seen = new Set<string>()
  let offset = 0
  let pagesFetched = 0
  let stoppedEarly = false

  while (accum.length < maxTotal && pagesFetched < maxPages) {
    const remaining = maxTotal - accum.length
    const chunkAsk = captureAll ? SWEEP_PAGE_SIZE : Math.min(SWEEP_PAGE_SIZE, remaining)
    const fetched = await fetchRetailSweepPage(input.retailer, base, sweepTerm, offset, chunkAsk)
    pagesFetched++

    retailSweepProgressEvery(pagesFetched, 'página de listado', {
      pagesFetched,
      filasUnicas: accum.length,
      offset,
    })

    if (!fetched.ok) {
      if (accum.length === 0) {
        if (fetched.reason === 'not_json') {
          const hint =
            sweepTerm.length > 40 ? `${sweepTerm.slice(0, 40)}…` : sweepTerm
          retailSweepLogError('primera página: sin datos parseables desde la tienda', {
            term: hint,
            retailer: input.retailer,
            mechanism: retailSearchMechanismLabel(input.retailer),
            offset,
          })
          const msg = sweepFailureNoParseableProducts(input.retailer, hint, base)
          return { ok: false, ...msg }
        }
        if (fetched.reason === 'http_error') {
          retailSweepLogError('primera página: HTTP error', {
            status: fetched.status,
            retailer: input.retailer,
            offset,
            attempts: fetched.attempts?.map((a) => ({
              reason: a.reason,
              status: a.status,
            })),
          })
          return {
            ok: false,
            error:
              `${vtexHttpErrorMessage(fetched.status, fetched.attempts)} ` +
              'En el hosting buscá el log [retail-catalog-sweep].',
            suggestJsonImport: true,
            suggestedJsonBaseUrl: base,
          }
        }
        if (fetched.reason === 'network') {
          retailSweepLogError('primera página: red o timeout', {
            retailer: input.retailer,
            mechanism: retailSearchMechanismLabel(input.retailer),
            offset,
            attempts: fetched.attempts?.map((a) => ({
              reason: a.reason,
              status: a.status,
            })),
          })
          const totalAttempts = fetched.attempts?.length ?? 0
          const allNetwork =
            totalAttempts > 0 &&
            (fetched.attempts ?? []).every((a) => a.reason === 'network')
          const trail = summarizeAttemptStatuses(fetched.attempts)
          const attemptSec = Math.round(VTEX_SEARCH_PER_ATTEMPT_TIMEOUT_MS / 1000)
          const budgetSec = Math.round(VTEX_SEARCH_PAGE_BUDGET_MS / 1000)
          const suffix = trail ? ` Detalle técnico: ${trail}.` : ''
          return {
            ok: false,
            error:
              (allNetwork
                ? `VTEX (${input.retailer}): la tienda no respondió en los endpoints intentados (timeout ~${attemptSec} s por intento, presupuesto ~${budgetSec} s). Probá importar JSON, otra red o más tarde.`
                : `VTEX (${input.retailer}): se agotó el presupuesto de la página (~${budgetSec} s) o falló la red en varios intentos. Probá importar JSON o reintentar.`
              ) +
              suffix +
              ' En el hosting buscá el log [retail-catalog-sweep].',
            suggestJsonImport: true,
            suggestedJsonBaseUrl: base,
          }
        }
        retailSweepLogError('primera página: fallo desconocido', {
          retailer: input.retailer,
          offset,
          reason: fetched,
        })
        return {
          ok: false,
          error:
            'No se pudo leer la primera página desde la tienda. Revisá los logs del servidor (prefijo [retail-catalog-sweep]) o probá importar JSON.',
          suggestJsonImport: true,
          suggestedJsonBaseUrl: base,
        }
      }
      retailSweepLogWarn('falló una página a mitad del barrido; se guarda lo acumulado', {
        reason: fetched.reason,
        status: fetched.status,
        pagesFetched,
        filasUnicas: accum.length,
        offset,
      })
      stoppedEarly = true
      break
    }

    if (fetched.products.length === 0) {
      break
    }

    const rows = mapVtexProductList(fetched.products, {
      retailer: input.retailer,
      vtexBaseUrl: base,
      matchMethod: 'app_vtex_catalog_sweep',
    })

    for (const row of rows) {
      if (seen.has(row.external_ref)) continue
      seen.add(row.external_ref)
      accum.push(row)
      if (accum.length >= maxTotal) break
    }

    offset += SWEEP_PAGE_SIZE
    if (fetched.products.length < chunkAsk) {
      break
    }
  }

  if (accum.length === 0) {
    retailSweepLogWarn('sin filas válidas tras barrido', {
      pagesFetched,
      retailer: input.retailer,
    })
    return {
      ok: false,
      error:
        input.retailer === 'jumbo' ?
          'Jumbo: ningún producto con precio válido tras el barrido. Revisá RETAIL_VTEX_SWEEP_SEARCH_TERM, la URL base o pegá JSON desde DevTools.'
        : 'Central Mayorista: ningún producto con precio válido. Revisá la URL base, el término de barrido o importá JSON.',
    }
  }

  retailSweepLogInfo('inserción en base', {
    totalFilas: accum.length,
    lotes: Math.ceil(accum.length / SWEEP_INSERT_CHUNK),
  })

  for (let i = 0; i < accum.length; i += SWEEP_INSERT_CHUNK) {
    const slice = accum.slice(i, i + SWEEP_INSERT_CHUNK)
    const batchIndex = Math.floor(i / SWEEP_INSERT_CHUNK) + 1
    const { error } = await editor.admin
      .from('catalog_retail_snapshots')
      .insert(slice as never)
    if (error) {
      retailSweepLogError('falló insert en catalog_retail_snapshots', {
        batchIndex,
        filasEnLote: slice.length,
        code: (error as { code?: string }).code,
        message: (error as { message?: string }).message,
      })
      return {
        ok: false,
        error: messageForRetailSnapshotInsertFailure(error),
      }
    }
  }

  const hitSafetyItemCap = captureAll && accum.length >= SWEEP_CAPTURE_ALL_CAP

  retailSweepLogInfo('barrido finalizado', {
    insertadas: accum.length,
    pagesFetched,
    stoppedEarly,
    hitSafetyItemCap,
  })

  const exactPack = await safeBulkExactTitleAutoLink(editor.admin, input.retailer)
  const remainingAccum = await filterSnapshotRowsStillUnlinked(editor.admin, input.retailer, accum)
  const assoc = await autoAssociateSnapshotRowsAfterInsert(editor.admin, remainingAccum)
  revalidatePath('/catalog')
  const payload: RetailCatalogSweepOkResult = {
    ok: true,
    retailer: input.retailer,
    inserted: accum.length,
    pagesFetched,
    stoppedEarly: stoppedEarly || hitSafetyItemCap,
    hitSafetyItemCap,
    effectiveSweepTerm: sweepTerm,
    sweepReplacedStarOnly: replacedStarOnly,
    vtexBaseUrlUsed: base,
    captureAll,
    maxTotalLimit: maxTotal,
    ...packRetailImportAutoAssociate(accum.length, assoc, exactPack),
  }
  return payload
}

export async function importRetailSnapshotsFromJsonAction(input: {
  retailer: string
  jsonText: string
  /** Para armar enlaces canónicos en VTEX; si se omite, se usa la URL base por cadena o Jumbo. */
  vtexBaseUrlOverride?: string | null
}): Promise<
  | ({ ok: true; inserted: number } & RetailImportAutoAssociateFields)
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) {
    return { ok: false, error: editor.error }
  }

  if (!isCaptureRetailer(input.retailer)) {
    return { ok: false, error: 'Cadena no válida.' }
  }

  const baseResolved =
    input.vtexBaseUrlOverride?.trim() ||
    resolveVtexBaseUrlForRetailer(input.retailer) ||
    'https://www.jumbo.cl'

  const pageHintForLd = `${baseResolved.replace(/\/+$/, '')}/busca`

  let arr: unknown[] = []
  let importMatchMethod: 'app_json_import' | 'app_html_ldjson_import' = 'app_json_import'

  try {
    const parsed: unknown = JSON.parse(input.jsonText)
    arr = extractProductArrayFromJson(parsed)
  } catch {
    const fromHtml = extractListedProductsFromRetailHtml(input.jsonText, pageHintForLd)
    arr = fromHtml.map((p) => htmlListedProductToSyntheticVtex(p))
    importMatchMethod = 'app_html_ldjson_import'
  }

  if (arr.length === 0) {
    return {
      ok: false,
      error:
        importMatchMethod === 'app_html_ldjson_import' ?
          'No se hallaron productos con precio en JSON-LD dentro del HTML pegado. Probá copiar otro bloque de la página o la respuesta JSON en Network si existe.'
        : 'No hay lista de productos reconocida. Pegá el cuerpo de la respuesta (array u objeto con products, records o data en DevTools → Network) o un fragmento HTML del listado que incluya JSON-LD.',
    }
  }

  const rows = mapVtexProductList(arr, {
    retailer: input.retailer,
    vtexBaseUrl: baseResolved,
    matchMethod: importMatchMethod,
  })

  if (rows.length === 0) {
    return {
      ok: false,
      error:
        'No se encontraron productos con precio válido en los datos pegados. Verificá que incluyan oferta/precio (JSON de API o HTML con JSON-LD de productos).',
    }
  }

  const { error } = await editor.admin
    .from('catalog_retail_snapshots')
    .insert(rows as never)

  if (error) {
    return {
      ok: false,
      error: getUserFriendlyErrorMessage(error, 'generic'),
    }
  }

  const retailerTyped = input.retailer as CaptureRetailer
  const exactPack = await safeBulkExactTitleAutoLink(editor.admin, retailerTyped)
  const remainingRows = await filterSnapshotRowsStillUnlinked(editor.admin, retailerTyped, rows)
  const assoc = await autoAssociateSnapshotRowsAfterInsert(editor.admin, remainingRows)
  revalidatePath('/catalog')
  return {
    ok: true,
    inserted: rows.length,
    ...packRetailImportAutoAssociate(rows.length, assoc, exactPack),
  }
}

/**
 * Homologación masiva solo por nombre (misma normalización que el catálogo en la app).
 * Útil si ya cargaste snapshots y querés aplicar vínculos sin repetir la captura.
 */
export async function bulkExactTitleRetailLinksAction(input: {
  retailer: CaptureRetailer
}): Promise<
  | {
      ok: true
      exactTitleLinked: number
      exactTitleSkippedAmbiguousCatalog: number
      exactTitleSkippedNoCatalogProduct: number
      exactTitleSkippedHeuristic: number
    }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) {
    return { ok: false, error: editor.error }
  }

  try {
    const r = await bulkExactTitleAutoLinkForRetailer(editor.admin, input.retailer)
    revalidatePath('/catalog')
    return {
      ok: true,
      exactTitleLinked: r.linked,
      exactTitleSkippedAmbiguousCatalog: r.skippedAmbiguousCatalog,
      exactTitleSkippedNoCatalogProduct: r.skippedNoCatalogProduct,
      exactTitleSkippedHeuristic: r.skippedHeuristic,
    }
  } catch (e) {
    return {
      ok: false,
      error: getUserFriendlyErrorMessage(e, 'generic'),
    }
  }
}

export async function unlinkRetailListingAction(input: {
  retailer: string
  external_ref: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) {
    return { ok: false, error: editor.error }
  }

  const { error } = await editor.admin
    .from('catalog_retail_links')
    .delete()
    .eq('retailer', input.retailer)
    .eq('external_ref', input.external_ref)

  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  }

  await editor.admin
    .from('retail_captured_products')
    .update({
      catalog_product_id: null,
      status: 'pending',
      decision_source: null,
      decision_confidence: null,
      decision_reason: null,
      review_tray: null,
      group_key: null,
      suggested_master_id: null,
    } as never)
    .eq('retailer', input.retailer)
    .eq('external_ref', input.external_ref)

  revalidatePath('/catalog')
  return { ok: true }
}

/** Recaptura precios VTEX solo para ítems ya homologados (historial de precios). Requiere editor + service role. */
export async function recaptureHomologatedLinkedAction(input: {
  retailer: CaptureRetailer
  limit?: number
}): Promise<
  RecaptureHomologatedResult | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) {
    return { ok: false, error: editor.error }
  }

  const limit = input.limit ?? 30
  const result = await runRetailRecaptureHomologatedBatch(editor.admin, input.retailer, limit)

  if (!result.ok) {
    return result
  }

  revalidatePath('/catalog')
  return result
}

/**
 * Vincula automáticamente capturas **sin homologar** al maestro cuando la RPC + heurística
 * (`retail-association`, misma base que `retail_import_decision.py`) indica enlace seguro.
 * No crea productos maestros nuevos (eso sigue siendo manual o script con flags).
 */
export async function autoAssociateUnlinkedRetailAction(input: {
  /** «all» = primer lote mezclando cadenas; si no, solo esa cadena. */
  retailerFilter: 'all' | CaptureRetailer
  maxRows?: number
}): Promise<
  | {
      ok: true
      processed: number
      linked: number
      linkedByAi: number
      skippedNotLink: number
      failed: number
    }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) {
    return { ok: false, error: editor.error }
  }

  const { admin } = editor
  const maxRows = Math.max(1, Math.min(40, input.maxRows ?? 32))
  const retailerParam = input.retailerFilter === 'all' ? null : input.retailerFilter

  const { data, error: listError } = await admin.rpc('catalog_retail_listings_page', {
    p_retailer: retailerParam,
    p_unlinked_only: true,
    p_search: null,
    p_page: 0,
    p_page_size: maxRows,
  } as never)

  if (listError) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[autoAssociateUnlinkedRetailAction] listings', listError)
    }
    return { ok: false, error: messageForRetailListingRpcFailure(listError) }
  }

  const rows = (data ?? []) as RetailListingRow[]
  let linked = 0
  let linkedByAi = 0
  let skippedNotLink = 0
  let failed = 0

  const useIa = retailIaHomologationEnabled() && isRetailIaHomologationConfigured()
  const iaBudget = useIa
    ? { remaining: Math.min(maxRows, retailIaHomologationMaxCallsPerRun()) }
    : null

  for (const row of rows) {
    if (row.catalog_product_id || row.linked_product_name) {
      skippedNotLink++
      continue
    }

    const input: RetailMatchRowInput = {
      retailer: row.retailer,
      external_ref: row.external_ref,
      title: row.title,
      price: row.price,
      brand_hint: row.brand_hint,
      description_hint: row.description_hint,
    }

    const o = await matchRetailCaptureRow(admin, input, iaBudget)
    if (o === 'linked') linked++
    else if (o === 'linked_ai') {
      linked++
      linkedByAi++
    } else if (o === 'failed') failed++
    else skippedNotLink++
  }

  revalidatePath('/catalog')

  return {
    ok: true,
    processed: rows.length,
    linked,
    linkedByAi,
    skippedNotLink,
    failed,
  }
}

export type RetailReviewQueueRow = {
  id: string
  batch_id: string
  retailer: string
  external_ref: string
  title: string
  price: number | null
  status: string
  decision_reason: string | null
  created_at: string
  description_hint?: string | null
}

export type RetailLiderReviewGroupSummary = {
  review_tray: string
  group_key: string
  suggested_master_id: string | null
  suggested_master_name: string | null
  product_count: number
  avg_confidence: number | null
  sample_titles: string[] | null
}

/**
 * Antes de un nuevo lote de captura Lider: elimina staging y snapshots de esa cadena.
 * Los vínculos (`catalog_retail_links`) y el catálogo maestro no se tocan; la grilla de precios refleja solo la última lectura.
 */
async function resetLiderRetailScrapeStagingForFreshCapture(
  admin: ReturnType<typeof createServiceRoleClient>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error: snapErr } = await admin.from('catalog_retail_snapshots').delete().eq('retailer', 'lider')
  if (snapErr) {
    return { ok: false, error: getUserFriendlyErrorMessage(snapErr, 'generic') }
  }
  const { error: batchErr } = await admin.from('retail_capture_batches').delete().eq('retailer', 'lider')
  if (batchErr) {
    return { ok: false, error: getUserFriendlyErrorMessage(batchErr, 'generic') }
  }
  retailSweepLogInfo('staging Lider: lectura nueva (snapshots y lotes anteriores eliminados)', {})
  return { ok: true }
}

/** Inicia un lote de captura retail (solo Lider): plan masivo en `retail_capture_pages` (sin términos de búsqueda del usuario). */
export async function startRetailCaptureBatchAction(input?: {
  retailer?: string
}): Promise<{ ok: true; batchId: string; totalPages: number } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) {
    return { ok: false, error: editor.error }
  }

  const retailer = (input?.retailer ?? 'lider').trim().toLowerCase()
  if (retailer !== 'lider') {
    return { ok: false, error: 'Por ahora solo está habilitada la cadena Lider.' }
  }

  const blockCount = await countBlockingLiderTaxonomyMappings(editor.admin)
  if (blockCount > 0) {
    return {
      ok: false,
      error:
        'Hay categorías Lider pendientes de homologar con el catálogo maestro. Completá el paso de taxonomía (detectar, aprobar sugerencias, crear categorías o ignorar) antes de crear productos o actualizar precios.',
    }
  }

  const wipe = await resetLiderRetailScrapeStagingForFreshCapture(editor.admin)
  if (!wipe.ok) {
    return { ok: false, error: wipe.error }
  }

  const seeds = await buildLiderFullCatalogPageSeeds()
  if (seeds.length === 0) {
    retailSweepLogError('plan captura Lider: sin semillas tras descubrimiento', { retailer })
    return {
      ok: false,
      error:
        'No se pudo descubrir el catálogo Lider automáticamente. Reintenta más tarde o revisa conectividad.',
    }
  }

  const ins = await insertRetailCaptureBatch(editor.admin, {
    retailer,
    total_pages: seeds.length,
  })
  if ('error' in ins) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[startRetailCaptureBatchAction] insert retail_capture_batches', ins.error)
    }
    return { ok: false, error: messageForRetailCaptureBatchCreateFailure(ins.error) }
  }

  const { error: pqErr } = await insertRetailCapturePageRows(editor.admin, ins.id, retailer, seeds)
  if (pqErr) {
    await editor.admin.from('retail_capture_batches').delete().eq('id', ins.id)
    if (process.env.NODE_ENV === 'development') {
      console.error('[startRetailCaptureBatchAction] insert retail_capture_pages', pqErr)
    }
    return {
      ok: false,
      error:
        'No se pudo guardar la cola de páginas del lote. Verifica permisos sobre la tabla retail_capture_pages (migración del proyecto).',
    }
  }

  revalidatePath('/catalog')
  return { ok: true, batchId: ins.id, totalPages: seeds.length }
}

/** Procesa la siguiente fila pending de `retail_capture_pages` (una petición HTTP acotada). */
export async function processRetailCaptureBatchPageAction(input: {
  batchId: string
}): Promise<
  | {
      ok: true
      done: boolean
      pageIndex: number
      productsThisPage: number
      nextPageIndex: number
      totalPages: number
      error?: string
    }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) {
    return { ok: false, error: editor.error }
  }

  const batch = await fetchRetailBatchById(editor.admin, input.batchId)
  if (!batch) {
    return { ok: false, error: 'No se encontró el lote de captura.' }
  }
  if (batch.retailer !== 'lider') {
    return { ok: false, error: 'Este lote no corresponde a Lider.' }
  }

  const blockCount = await countBlockingLiderTaxonomyMappings(editor.admin)
  if (blockCount > 0) {
    return {
      ok: false,
      error:
        'La taxonomía Lider no está resuelta (secciones o categorías pendientes). Completá el paso de taxonomía antes de cargar productos.',
    }
  }

  if (batch.status === 'completed' || batch.status === 'cancelled') {
    return {
      ok: true,
      done: true,
      pageIndex: batch.current_page,
      productsThisPage: 0,
      nextPageIndex: batch.current_page,
      totalPages: batch.total_pages ?? 0,
    }
  }

  const pipeline = (batch.pipeline_phase ?? 'capture').toLowerCase()
  if (pipeline !== 'capture') {
    return {
      ok: true,
      done: true,
      pageIndex: batch.current_page,
      productsThisPage: 0,
      nextPageIndex: batch.current_page,
      totalPages: batch.total_pages ?? 0,
    }
  }

  await resetStaleRetailCapturePagesProcessing(editor.admin, batch.id)

  const tallies0 = await countRetailCapturePages(editor.admin, batch.id)
  if (tallies0.total === 0) {
    return {
      ok: false,
      error:
        'Este lote no tiene cola de páginas (modelo antiguo). Iniciá un lote nuevo con captura total Lider.',
    }
  }

  let page = await claimNextRetailCapturePage(editor.admin, batch.id)
  if (!page && tallies0.pending > 0) {
    page = await claimNextRetailCapturePage(editor.admin, batch.id)
  }

  if (!page) {
    const t = await countRetailCapturePages(editor.admin, batch.id)
    const captureWaveDone =
      t.total > 0 && t.pending === 0 && t.processing === 0 && batch.status === 'running'

    if (captureWaveDone) {
      await updateRetailBatchProgress(editor.admin, batch.id, {
        status: 'completed',
        finished_at: new Date().toISOString(),
        pipeline_phase: 'processing',
        current_page: t.done + t.failed + t.skipped,
        total_pages: t.total,
        error_message: null,
      })
      revalidatePath('/catalog')
      return {
        ok: true,
        done: true,
        pageIndex: batch.current_page,
        productsThisPage: 0,
        nextPageIndex: t.done + t.failed + t.skipped,
        totalPages: t.total,
      }
    }

    revalidatePath('/catalog')
    return {
      ok: true,
      done: false,
      pageIndex: batch.current_page,
      productsThisPage: 0,
      nextPageIndex: batch.current_page,
      totalPages: t.total,
    }
  }

  let pageError: string | undefined
  let expandError: string | undefined
  let productsFound = 0
  let cleanN = 0
  let discardedN = 0
  let snapInsertDelta = 0
  let snapSkipDelta = 0

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
      discardedN = part.discardedProducts
      const cleanSnapshots = part.cleanSnapshots
      const cleanStaging = part.cleanStaging
      cleanN = cleanStaging.length

      if (cleanSnapshots.length > 0) {
        const refs = [...new Set(cleanSnapshots.map((s) => s.external_ref))]
        const latestPriceByRef = new Map<string, number>()
        if (refs.length > 0) {
          const { data: existingSnaps } = await editor.admin
            .from('catalog_retail_snapshots')
            .select('external_ref, price, captured_at')
            .eq('retailer', 'lider')
            .in('external_ref', refs)
            .order('captured_at', { ascending: false })

          for (const row of existingSnaps ?? []) {
            const er = String((row as { external_ref: string }).external_ref)
            if (!latestPriceByRef.has(er)) {
              latestPriceByRef.set(er, Number((row as { price: unknown }).price))
            }
          }
        }

        const sameRetailPrice = (prev: number, next: number) =>
          Number.isFinite(prev) && Number.isFinite(next) && Math.abs(prev - next) < 0.01

        const toInsert: typeof cleanSnapshots = []
        for (const s of cleanSnapshots) {
          const prev = latestPriceByRef.get(s.external_ref)
          if (prev != null && sameRetailPrice(prev, s.price)) {
            snapSkipDelta++
            continue
          }
          toInsert.push(s)
        }

        if (toInsert.length > 0) {
          const chunk = 400
          for (let i = 0; i < toInsert.length; i += chunk) {
            const slice = toInsert.slice(i, i + chunk)
            const { error: snapErr } = await editor.admin.from('catalog_retail_snapshots').insert(slice as never)
            if (snapErr) {
              pageError = getUserFriendlyErrorMessage(snapErr, 'generic')
              break
            }
          }
          if (!pageError) {
            snapInsertDelta = toInsert.length
          }
        }
      }

      if (!pageError && cleanStaging.length > 0) {
        const dbRows = cleanStaging.map((r) => ({
          batch_id: batch.id,
          retailer: 'lider',
          external_ref: r.external_ref,
          source_url: r.source_url,
          title: r.title,
          normalized_title: r.normalized_title,
          brand: r.brand,
          normalized_brand: r.normalized_brand,
          price: r.price,
          unit_price: r.unit_price,
          category_hint: r.category_hint,
          description_hint: r.description_hint,
          image_url: r.image_url,
          raw_data: r.raw_data,
          status: 'pending',
        }))
        const { error: upErr } = await editor.admin
          .from('retail_captured_products')
          .upsert(dbRows as never, { onConflict: 'batch_id,retailer,external_ref' })
        if (upErr) {
          pageError = getUserFriendlyErrorMessage(upErr, 'generic')
        }
      }

      if (!pageError && cap.ok) {
        const nextUrl =
          isLiderCatalogSystemSearchUrl(page.page_url) ?
            nextLiderCatalogSystemSliceUrl(page.page_url, cap.data.rawProductCount)
          : isLiderHtmlBrowseListingUrl(page.page_url) ?
            nextLiderHtmlBrowseListingPageUrl(page.page_url, cap.data.rawProductCount)
          : null
        if (nextUrl) {
          const app = await appendRetailCapturePage(editor.admin, batch.id, page.retailer, nextUrl)
          if (app.error) {
            expandError = getUserFriendlyErrorMessage(app.error, 'generic')
          }
        }
      }
    }

    await finalizeRetailCapturePage(editor.admin, page.id, {
      status: pageError ? 'failed' : 'done',
      products_found: productsFound,
      clean_products: pageError ? 0 : cleanN,
      discarded_products: pageError ? 0 : discardedN,
      error_message: pageError ?? null,
    })
  } catch (e) {
    pageError = getUserFriendlyErrorMessage(e, 'generic')
    await finalizeRetailCapturePage(editor.admin, page.id, {
      status: 'failed',
      products_found: 0,
      clean_products: 0,
      discarded_products: 0,
      error_message: pageError,
    })
  }

  const bRef = (await fetchRetailBatchById(editor.admin, batch.id)) ?? batch
  const prevSnapIns = bRef.snapshot_inserted_total ?? 0
  const prevSnapSkip = bRef.snapshot_skipped_same_price_total ?? 0
  const prevDisc = bRef.capture_discarded_total ?? 0

  const t2 = await countRetailCapturePages(editor.admin, batch.id)
  const completed = t2.done + t2.failed + t2.skipped
  const captureWaveDone = t2.total > 0 && t2.pending === 0 && t2.processing === 0

  await updateRetailBatchProgress(editor.admin, batch.id, {
    current_page: completed,
    total_pages: t2.total,
    total_found: bRef.total_found + productsFound,
    total_inserted: bRef.total_inserted + (pageError ? 0 : cleanN),
    capture_discarded_total: prevDisc + (pageError ? 0 : discardedN),
    snapshot_inserted_total: prevSnapIns + snapInsertDelta,
    snapshot_skipped_same_price_total: prevSnapSkip + snapSkipDelta,
    status: captureWaveDone ? 'completed' : 'running',
    finished_at: captureWaveDone ? new Date().toISOString() : null,
    pipeline_phase: captureWaveDone ? 'processing' : 'capture',
    error_message: pageError ?? expandError ?? null,
  })

  revalidatePath('/catalog')
  return {
    ok: true,
    done: captureWaveDone,
    pageIndex: page.page_index,
    productsThisPage: pageError ? 0 : cleanN,
    nextPageIndex: completed,
    totalPages: t2.total,
    error: pageError ?? expandError,
  }
}

/** Homologa filas pendientes del staging (opcionalmente acotadas a un lote). */
export async function runRetailHomologationAction(input?: {
  batchId?: string | null
  limit?: number
}): Promise<
  | { ok: true; processed: number }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) {
    return { ok: false, error: editor.error }
  }

  const limit = Math.min(80, Math.max(1, Math.floor(input?.limit ?? 40)))
  const { processed, batchIds } = await homologateRetailCapturedBatch(editor.admin, {
    batchId: input?.batchId ?? null,
    limit,
  })

  for (const bid of batchIds) {
    await refreshRetailBatchHomologationStats(editor.admin, bid)
    const b = await fetchRetailBatchById(editor.admin, bid)
    if (b) {
      const needsReview = (b.review_required ?? 0) + (b.duplicate_risk ?? 0) > 0
      await updateRetailBatchProgress(editor.admin, bid, {
        pipeline_phase: needsReview ? 'review' : 'processing',
      })
    }
  }

  revalidatePath('/catalog')
  return { ok: true, processed }
}

export type RetailCapturePageQueueStats = {
  total: number
  pending: number
  processing: number
  done: number
  failed: number
  skipped: number
}

function aggregateRetailCapturePageQueue(
  rows: { status: string }[] | null | undefined,
): RetailCapturePageQueueStats | null {
  if (!rows || rows.length === 0) return null
  const stats: RetailCapturePageQueueStats = {
    total: 0,
    pending: 0,
    processing: 0,
    done: 0,
    failed: 0,
    skipped: 0,
  }
  for (const r of rows) {
    stats.total++
    const s = (r.status ?? '').toLowerCase()
    if (s === 'pending') stats.pending++
    else if (s === 'processing') stats.processing++
    else if (s === 'done') stats.done++
    else if (s === 'failed') stats.failed++
    else if (s === 'skipped') stats.skipped++
  }
  return stats
}

export async function fetchRetailBatchSummaryAction(input?: {
  batchId?: string | null
}): Promise<
  | { ok: true; batch: RetailCaptureBatchRow | null; pageQueue: RetailCapturePageQueueStats | null }
  | { ok: false; error: string }
> {
  const gate = await requireProfileViewer()
  if (!gate.ok) {
    return { ok: false, error: gate.error }
  }

  const supabase = await createClient()
  if (input?.batchId) {
    const { data, error } = await supabase.from('retail_capture_batches').select('*').eq('id', input.batchId).maybeSingle()
    if (error) {
      return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
    }
    const batch = data as RetailCaptureBatchRow | null
    let pageQueue: RetailCapturePageQueueStats | null = null
    if (batch?.id) {
      const { data: rows } = await supabase.from('retail_capture_pages').select('status').eq('batch_id', batch.id)
      pageQueue = aggregateRetailCapturePageQueue(rows as { status: string }[])
    }
    return { ok: true, batch, pageQueue }
  }

  const { data, error } = await supabase
    .from('retail_capture_batches')
    .select('*')
    .eq('retailer', 'lider')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  }
  const batch = data as RetailCaptureBatchRow | null
  let pageQueue: RetailCapturePageQueueStats | null = null
  if (batch?.id) {
    const { data: rows } = await supabase.from('retail_capture_pages').select('status').eq('batch_id', batch.id)
    pageQueue = aggregateRetailCapturePageQueue(rows as { status: string }[])
  }
  return { ok: true, batch, pageQueue }
}

export async function fetchRetailReviewQueueAction(input?: {
  limit?: number
}): Promise<{ ok: true; rows: RetailReviewQueueRow[] } | { ok: false; error: string }> {
  const gate = await requireProfileViewer()
  if (!gate.ok) {
    return { ok: false, error: gate.error }
  }

  const lim = Math.min(100, Math.max(1, Math.floor(input?.limit ?? 50)))
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('retail_captured_products')
    .select('id,batch_id,retailer,external_ref,title,price,status,decision_reason,created_at,description_hint')
    .in('status', ['review', 'duplicate_risk'])
    .eq('retailer', 'lider')
    .order('created_at', { ascending: false })
    .limit(lim)

  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  }

  return {
    ok: true,
    rows: (data ?? []) as RetailReviewQueueRow[],
  }
}

export async function fetchRetailLiderReviewGroupsAction(input: {
  batchId: string
}): Promise<{ ok: true; groups: RetailLiderReviewGroupSummary[] } | { ok: false; error: string }> {
  const gate = await requireProfileViewer()
  if (!gate.ok) {
    return { ok: false, error: gate.error }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('retail_lider_review_groups_for_batch', {
    p_batch_id: input.batchId,
  })

  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  }

  const raw = (data ?? []) as Record<string, unknown>[]
  const groups: RetailLiderReviewGroupSummary[] = raw.map((r) => ({
    review_tray: String(r.review_tray ?? ''),
    group_key: String(r.group_key ?? ''),
    suggested_master_id:
      r.suggested_master_id != null && String(r.suggested_master_id).length > 0 ?
        String(r.suggested_master_id)
      : null,
    suggested_master_name:
      r.suggested_master_name != null && String(r.suggested_master_name).length > 0 ?
        String(r.suggested_master_name)
      : null,
    product_count: Number(r.product_count ?? 0),
    avg_confidence: r.avg_confidence != null ? Number(r.avg_confidence) : null,
    sample_titles: Array.isArray(r.sample_titles) ? (r.sample_titles as string[]) : [],
  }))

  return { ok: true, groups }
}

export async function fetchRetailLiderGroupDetailRowsAction(input: {
  batchId: string
  groupKey: string
  limit?: number
}): Promise<{ ok: true; rows: RetailReviewQueueRow[] } | { ok: false; error: string }> {
  const gate = await requireProfileViewer()
  if (!gate.ok) {
    return { ok: false, error: gate.error }
  }

  const lim = Math.min(100, Math.max(1, Math.floor(input.limit ?? 80)))
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('retail_captured_products')
    .select('id,batch_id,retailer,external_ref,title,price,status,decision_reason,created_at,description_hint')
    .eq('batch_id', input.batchId)
    .eq('group_key', input.groupKey)
    .in('status', ['review', 'duplicate_risk'])
    .order('created_at', { ascending: false })
    .limit(lim)

  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  }

  return { ok: true, rows: (data ?? []) as RetailReviewQueueRow[] }
}

export async function approveLiderReviewGroupLinkAction(input: {
  batchId: string
  groupKey: string
}): Promise<{ ok: true; linked: number } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) {
    return { ok: false, error: editor.error }
  }

  const batch = await fetchRetailBatchById(editor.admin, input.batchId)
  if (!batch || batch.retailer !== 'lider') {
    return { ok: false, error: 'No se encontró un lote Lider válido.' }
  }

  const { data: rows, error } = await editor.admin
    .from('retail_captured_products')
    .select('id,retailer,external_ref,title,suggested_master_id')
    .eq('batch_id', input.batchId)
    .eq('group_key', input.groupKey)
    .in('status', ['review', 'duplicate_risk'])

  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  }
  if (!rows?.length) {
    return { ok: false, error: 'No hay ítems activos en este grupo.' }
  }

  const sid = (rows[0] as { suggested_master_id: string | null }).suggested_master_id
  if (!sid) {
    return { ok: false, error: 'Este grupo no tiene maestro sugerido para aprobar en bloque.' }
  }

  let linked = 0
  for (const raw of rows as { id: string; retailer: string; external_ref: string; title: string }[]) {
    const linkRes = await linkRetailListingWithAdmin(editor.admin, {
      retailer: raw.retailer,
      external_ref: raw.external_ref,
      catalog_product_id: sid,
      addTitleAlias: false,
      listingTitle: raw.title,
    })
    if (!linkRes.ok) {
      continue
    }

    const { error: upErr } = await editor.admin
      .from('retail_captured_products')
      .update({
        catalog_product_id: sid,
        status: 'linked',
        decision_source: 'group_approve',
        decision_confidence: null,
        decision_reason: 'Aprobación masiva de vínculo desde bandeja de revisión.',
        review_tray: null,
        group_key: null,
        suggested_master_id: null,
      } as never)
      .eq('id', raw.id)

    if (!upErr) {
      linked++
    }
  }

  await refreshRetailBatchHomologationStats(editor.admin, input.batchId)
  revalidatePath('/catalog')
  return { ok: true, linked }
}

export async function discardLiderReviewGroupAction(input: {
  batchId: string
  groupKey: string
}): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) {
    return { ok: false, error: editor.error }
  }

  const { data, error } = await editor.admin
    .from('retail_captured_products')
    .update({
      status: 'discarded',
      catalog_product_id: null,
      review_tray: 'discarded_candidate',
      decision_source: 'group_discard',
      decision_confidence: null,
      decision_reason: 'Grupo descartado en revisión masiva Lider.',
      group_key: null,
      suggested_master_id: null,
    } as never)
    .eq('batch_id', input.batchId)
    .eq('group_key', input.groupKey)
    .in('status', ['review', 'duplicate_risk'])
    .select('id')

  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  }

  await refreshRetailBatchHomologationStats(editor.admin, input.batchId)
  revalidatePath('/catalog')
  return { ok: true, updated: data?.length ?? 0 }
}

export async function markLiderReviewGroupDuplicateAction(input: {
  batchId: string
  groupKey: string
}): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) {
    return { ok: false, error: editor.error }
  }

  const { data, error } = await editor.admin
    .from('retail_captured_products')
    .update({
      status: 'duplicate_risk',
      review_tray: 'duplicate_risk',
      catalog_product_id: null,
      decision_source: 'group_duplicate',
      decision_confidence: null,
      decision_reason: 'Marcado como duplicado en revisión masiva por grupo.',
    } as never)
    .eq('batch_id', input.batchId)
    .eq('group_key', input.groupKey)
    .in('status', ['review', 'duplicate_risk'])
    .select('id')

  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  }

  await refreshRetailBatchHomologationStats(editor.admin, input.batchId)
  revalidatePath('/catalog')
  return { ok: true, updated: data?.length ?? 0 }
}

export async function closeRetailCaptureBatchAction(input: {
  batchId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) {
    return { ok: false, error: editor.error }
  }

  const batch = await fetchRetailBatchById(editor.admin, input.batchId)
  if (!batch || batch.retailer !== 'lider') {
    return { ok: false, error: 'No se encontró un lote Lider válido.' }
  }
  if (batch.status !== 'completed') {
    return {
      ok: false,
      error: 'La captura por páginas aún no terminó. Completá todas las páginas antes de cerrar el lote.',
    }
  }

  const { count, error: cErr } = await editor.admin
    .from('retail_captured_products')
    .select('id', { count: 'exact', head: true })
    .eq('batch_id', input.batchId)
    .eq('status', 'pending')

  if (cErr) {
    return { ok: false, error: getUserFriendlyErrorMessage(cErr, 'generic') }
  }
  if (count != null && count > 0) {
    return {
      ok: false,
      error:
        'Aún hay productos pendientes de homologar. Ejecutá el procesamiento automático hasta vaciar la cola o resolvé los grupos.',
    }
  }

  await updateRetailBatchProgress(editor.admin, input.batchId, { pipeline_phase: 'closed' })
  revalidatePath('/catalog')
  return { ok: true }
}

type CatalogProductPickerRow = {
  id: string
  name: string
}

type CatalogProductPickerDbRow = {
  id: string
  name: string
  brand: string | null
  format: string | null
}



export async function searchCatalogProductsForPickerAction(
  searchQuery: string,
  includeInactive = false,
): Promise<
  | { ok: true; rows: CatalogProductPickerRow[] }
  | { ok: false; error: string }
> {
  const gate = await requireProfileViewer()
  if (!gate.ok) {
    return { ok: false, error: gate.error }
  }

  const q = searchQuery.trim()
  const normalized = normalizeSearchText(q)

  if (normalized.length < 2) {
    return { ok: true, rows: [] }
  }

  const supabase = await createClient()

  let query = supabase
    .from('catalog_products')
    .select('id, name, brand, format')
    .ilike('name', `%${q}%`)
    .order('name', { ascending: true })
    .limit(25)

  if (!includeInactive) {
    query = query.eq('active', true)
  }

  const { data, error } = await query

  if (error) {
    return {
      ok: false,
      error: getUserFriendlyErrorMessage(error, 'generic'),
    }
  }

  const rows: CatalogProductPickerRow[] = ((data ?? []) as CatalogProductPickerDbRow[]).map(
    (row) => {
      const label = [row.name, row.brand, row.format]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(' · ')

      return {
        id: row.id,
        name: label,
      }
    },
  )

  return { ok: true, rows }
}