/**
 * Paso 3 del wizard de homologación: crear productos maestros nuevos
 * a partir de filas `scrapping` con `catalog_match_status = 'pending_new'`.
 *
 * Flujo por fila:
 *  1. Resolver section_id / category_id del catálogo vía taxonomía Lider
 *  2. Crear el producto en `catalog_products`
 *  3. Crear el link en `catalog_retail_links` + alias
 *  4. Descargar la imagen del producto y guardarla en Storage + `catalog_product_media`
 *  5. Marcar la fila de scrapping como `catalog_match_status = 'matched'`
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getUserFriendlyErrorMessage } from '@/lib/user-friendly-errors'
import { normalizeRetailCapturedInput } from '@/server/retail/normalize/normalize-retail-product'
import { normalizeCatalogAlias } from '@/lib/catalog-alias'
import { resolveCatalogCategoryIdForScrappingRow } from '@/server/retail/scrapping/scrapping-similarity-taxonomy'
import { getPublicUploadBucket } from '@/lib/storage-bucket'
import logger from '@/lib/logger'

/* ── Tipos ── */

export type CreateNewProductsSummary = {
  processed: number
  created: number
  recovered: number
  skipped: number
  mediaOk: number
  mediaFailed: number
  errors: number
  lastError?: string | null
}

export type CreateNewProductsBatchResult = {
  stats: CreateNewProductsSummary
  hasMore: boolean
  lastId: string | null
  total: number
}

export type CreateNewProductsAllResult = {
  stats: CreateNewProductsSummary
  total: number
}

/* ── Helpers internos ── */

function isUniqueViolation(err: { code?: string }): boolean {
  return err?.code === '23505'
}

/** Intenta descargar una imagen y subirla al storage de Supabase. */
async function downloadAndUploadProductImage(
  admin: SupabaseClient,
  catalogProductId: string,
  sourceUrl: string,
): Promise<{ ok: true; publicUrl: string } | { ok: false }> {
  try {
    logger.debug({ catalogProductId, sourceUrl }, '[create-new] descargando imagen')
    const resp = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'HubStockAI/1.0' },
    })
    if (!resp.ok) {
      logger.warn({ catalogProductId, sourceUrl, status: resp.status }, '[create-new] imagen no disponible')
      return { ok: false }
    }

    const contentType = resp.headers.get('content-type') ?? 'image/jpeg'
    const buffer = Buffer.from(await resp.arrayBuffer())
    if (buffer.byteLength < 200 || buffer.byteLength > 5_000_000) return { ok: false }

    const ext =
      contentType.includes('png') ? 'png'
      : contentType.includes('webp') ? 'webp'
      : 'jpg'
    const bucket = getPublicUploadBucket()
    const path = `catalog-products/${catalogProductId}/thumb.${ext}`

    const { error: upErr } = await admin.storage
      .from(bucket)
      .upload(path, buffer, { contentType, upsert: true })
    if (upErr) {
      logger.error({ catalogProductId, path, err: upErr.message }, '[create-new] error subiendo imagen al storage')
      return { ok: false }
    }

    const { data: urlData } = admin.storage.from(bucket).getPublicUrl(path)
    const publicUrl = urlData?.publicUrl
    if (!publicUrl) return { ok: false }

    // Insertar en catalog_product_media
    const { error: mediaErr } = await admin.from('catalog_product_media').insert({
      catalog_product_id: catalogProductId,
      kind: 'thumbnail',
      bucket_id: bucket,
      object_path: path,
      public_url: publicUrl,
    } as never)
    if (mediaErr && !isUniqueViolation(mediaErr)) return { ok: false }

    return { ok: true, publicUrl }
  } catch (e) {
    logger.error({ catalogProductId, err: e instanceof Error ? e.message : String(e) }, '[create-new] excepción en descarga/subida de imagen')
    return { ok: false }
  }
}

/** Busca una URL de imagen desde el product_url de Lider. */
function inferImageUrlFromProductUrl(productUrl: string | null): string | null {
  if (!productUrl?.trim()) return null
  // Lider usa VTEX → las imágenes siguen el patrón estándar
  // Pero no podemos inferir directamente desde la URL de producto.
  // Dejamos null; el caller puede proveer otra fuente.
  return null
}

/* ── Función principal por lotes ── */

/**
 * Procesa un lote de filas `pending_new` de la tabla scrapping:
 * crea el producto maestro, el link retail y descarga la imagen.
 */
export async function processHomologationCreateNewBatch(
  admin: SupabaseClient,
  input: { afterId?: string | null; batchSize?: number; fallbackCategoryId?: string | null },
): Promise<{ ok: true; result: CreateNewProductsBatchResult } | { ok: false; error: string }> {
  const limit = Math.min(Math.max(input.batchSize ?? 50, 1), 200)

  // Contar total pendiente
  const { count: totalRemaining } = await admin
    .from('scrapping')
    .select('id', { count: 'exact', head: true })
    .eq('catalog_match_status', 'pending_new')

  let q = admin
    .from('scrapping')
    .select('id, retailer, external_ref, product_url, product_name, brand, price, sections, categories, image_url, catalog_match_status')
    .eq('catalog_match_status', 'pending_new')
    .order('id', { ascending: true })
    .limit(limit)

  if (input.afterId?.trim()) {
    q = q.gt('id', input.afterId.trim())
  }

  const { data: rows, error } = await q
  if (error) {
    logger.error({ err: error.message, code: error.code }, '[create-new] error consultando scrapping pending_new')
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  }

  const list = (rows ?? []) as Array<{
    id: string
    retailer: string
    external_ref: string
    product_url: string | null
    product_name: string
    brand: string | null
    price: number | string | null
    sections: string | null
    categories: string | null
    image_url: string | null
  }>

  logger.info({ total: totalRemaining, batchSize: list.length, afterId: input.afterId ?? null }, '[create-new] iniciando lote')

  /* ── Pre-caché: taxonomía y fallback resueltos una sola vez fuera del loop ── */

  // Fallback category/section (una query, compartida por todas las filas del lote)
  type CatSection = { id: string; section_id: string }
  let fallbackCat: CatSection | null = null
  const overrideCatId = input.fallbackCategoryId?.trim() || null
  {
    const fbQ = overrideCatId ?
      admin.from('categories').select('id, section_id').eq('id', overrideCatId).maybeSingle()
    : admin.from('categories').select('id, section_id').order('sort_order', { ascending: true }).limit(1).maybeSingle()
    const { data } = await fbQ
    fallbackCat = (data as CatSection | null)
  }

  // Caché local de category → section_id para evitar queries repetidas dentro del loop
  const sectionCache = new Map<string, string>()

  // Caché de sort_order por category_id: arranca en -1, se incrementa localmente sin re-query
  const sortOrderCache = new Map<string, number>()

  // Resolver taxonomía para todas las filas en paralelo (resolveCatalogCategoryIdForScrappingRow ya cachea internamente)
  const resolvedCategoryIds = await Promise.all(
    list.map(row => resolveCatalogCategoryIdForScrappingRow(admin, {
      retailer: row.retailer,
      sections: row.sections,
      categories: row.categories,
    }))
  )

  // Caché de taxonomía por clave de fila
  const taxonomyCache = new Map<string, string | null>()
  for (let i = 0; i < list.length; i++) {
    const row = list[i]
    const key = `${row.retailer}|${row.sections ?? ''}|${row.categories ?? ''}`
    if (!taxonomyCache.has(key)) {
      taxonomyCache.set(key, resolvedCategoryIds[i] ?? null)
    }
  }

  const uniqueCategoryIds = [...new Set(resolvedCategoryIds.filter((id): id is string => id !== null))]

  // Precachear section_id para todas las categorías encontradas (una query con .in)
  if (uniqueCategoryIds.length > 0) {
    const { data: catRows } = await admin
      .from('categories')
      .select('id, section_id')
      .in('id', uniqueCategoryIds)
    for (const c of (catRows ?? []) as CatSection[]) {
      sectionCache.set(c.id, c.section_id)
    }

    // Precachear sort_order máximo por categoría (una query con .in)
    const { data: sortRows } = await admin
      .from('catalog_products')
      .select('category_id, sort_order')
      .in('category_id', uniqueCategoryIds)
      .order('sort_order', { ascending: false })
    const seen = new Set<string>()
    for (const r of (sortRows ?? []) as { category_id: string; sort_order: number }[]) {
      if (!seen.has(r.category_id)) {
        sortOrderCache.set(r.category_id, r.sort_order)
        seen.add(r.category_id)
      }
    }
  }

  /* ── Preparar trabajos: asignar sort_order localmente antes de lanzar en paralelo ── */

  type RowJob = {
    row: typeof list[number]
    finalCategoryId: string
    finalSectionId: string
    sortOrder: number
    validPrice: number | null
    sourceUrl: string | null
    norm: ReturnType<typeof normalizeRetailCapturedInput>
  }

  const jobs: RowJob[] = []
  const skippedIds: string[] = []

  for (const row of list) {
    const key = `${row.retailer}|${row.sections ?? ''}|${row.categories ?? ''}`
    const categoryId = taxonomyCache.get(key) ?? null
    let finalCategoryId = categoryId
    let finalSectionId = categoryId ? (sectionCache.get(categoryId) ?? null) : null
    if (!finalCategoryId || !finalSectionId) {
      if (fallbackCat) {
        finalCategoryId = finalCategoryId ?? fallbackCat.id
        finalSectionId = finalSectionId ?? fallbackCat.section_id
      }
    }
    if (!finalCategoryId || !finalSectionId) {
      logger.warn({ rowId: row.id, retailer: row.retailer, sections: row.sections, categories: row.categories }, '[create-new] sin categoría resuelta — omitido')
      skippedIds.push(row.id)
      continue
    }
    const currentMax = sortOrderCache.get(finalCategoryId) ?? -1
    const sortOrder = currentMax + 1
    sortOrderCache.set(finalCategoryId, sortOrder)

    const priceNum = typeof row.price === 'string' ? Number(row.price) : (row.price ?? 0)
    const validPrice = Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null
    const norm = normalizeRetailCapturedInput({
      retailer: row.retailer, external_ref: row.external_ref, source_url: row.product_url,
      title: row.product_name, brand: row.brand, price: validPrice, unit_price: null,
      category_hint: [row.sections, row.categories].filter(Boolean).join(' > '),
      description_hint: null, image_url: null, raw_data: null,
    })
    jobs.push({ row, finalCategoryId, finalSectionId, sortOrder, validPrice, sourceUrl: row.product_url?.trim() || null, norm })
  }

  /* ── Procesar todas las filas en paralelo ── */

  type JobResult = { created: number; recovered: number; skipped: number; errors: number; lastError?: string; imageTask?: { catalogProductId: string; imageUrl: string } }

  const jobResults = await Promise.allSettled(
    jobs.map(async (job): Promise<JobResult> => {
      const { row, finalCategoryId, finalSectionId, sortOrder, validPrice, sourceUrl, norm } = job
      const now = new Date().toISOString()

      // INSERT catalog_products
      const { data: created, error: createErr } = await admin
        .from('catalog_products')
        .insert({
          name: row.product_name.trim(),
          section_id: finalSectionId,
          category_id: finalCategoryId,
          brand: row.brand?.trim() || null,
          brand_id: null,
          format: norm.format_signature,
          unit: null,
          default_reference_price: validPrice,
          sort_order: sortOrder,
          active: true,
          source_system: 'scrapping_homologation',
          source_product_url: sourceUrl,
        } as never)
        .select('id')
        .single()

      let catalogProductId: string | null = null
      let isRecovered = false

      if (createErr) {
        if (isUniqueViolation(createErr) && sourceUrl) {
          const { data: existing } = await admin
            .from('catalog_products').select('id').eq('source_product_url', sourceUrl).maybeSingle()
          if (existing) {
            catalogProductId = (existing as { id: string }).id
            isRecovered = true
            logger.info({ rowId: row.id, catalogProductId, url: sourceUrl }, '[create-new] producto ya existía — vinculando')
          }
        }
        if (!catalogProductId) {
          logger.error({ rowId: row.id, code: createErr.code, err: createErr.message }, '[create-new] error insertando catalog_products')
          return { created: 0, recovered: 0, skipped: 0, errors: 1, lastError: createErr.message }
        }
      } else if (!created) {
        return { created: 0, recovered: 0, skipped: 0, errors: 1, lastError: 'No se obtuvo el producto creado' }
      } else {
        catalogProductId = (created as { id: string }).id
        logger.info({ rowId: row.id, catalogProductId, name: row.product_name }, '[create-new] producto creado')
      }

      // Link + alias + scrapping update en paralelo
      const aliasNorm = normalizeCatalogAlias(row.product_name)
      const [linkRes, aliasRes, scrappingRes] = await Promise.all([
        admin.from('catalog_retail_links').upsert(
          { retailer: row.retailer, external_ref: row.external_ref, catalog_product_id: catalogProductId, updated_at: now } as never,
          { onConflict: 'retailer,external_ref' },
        ),
        aliasNorm.length >= 2
          ? admin.from('catalog_product_aliases').insert({ catalog_product_id: catalogProductId, alias_normalized: aliasNorm } as never)
          : Promise.resolve({ error: null }),
        admin.from('scrapping').update({
          catalog_match_status: 'matched',
          matched_catalog_product_id: catalogProductId,
          catalog_matched_at: now,
          homolog_final_status: isRecovered ? 'MATCHED_EXISTING' : 'CREATED_NEW',
          homolog_reviewed_at: now,
        } as never).eq('id', row.id),
      ])

      if (linkRes.error) {
        logger.error({ rowId: row.id, catalogProductId, err: linkRes.error.message }, '[create-new] error insertando catalog_retail_links')
      }
      if (aliasRes.error) {
        logger.warn({ rowId: row.id, catalogProductId, err: aliasRes.error.message }, '[create-new] error insertando alias (no crítico)')
      }
      if (scrappingRes.error) {
        logger.error({ rowId: row.id, catalogProductId, err: scrappingRes.error.message }, '[create-new] error actualizando scrapping')
        return {
          created: 0, recovered: 0, skipped: 0, errors: 1,
          lastError: `No se pudo marcar la fila de scrapping: ${scrappingRes.error.message}`,
        }
      }

      const imageUrl = row.image_url?.trim() || inferImageUrlFromProductUrl(row.product_url)
      return {
        created: isRecovered ? 0 : 1,
        recovered: isRecovered ? 1 : 0,
        skipped: 0,
        errors: linkRes.error ? 1 : 0,
        imageTask: imageUrl ? { catalogProductId, imageUrl } : undefined,
      }
    })
  )

  /* ── Agregar resultados ── */

  const stats: CreateNewProductsSummary = {
    processed: list.length,
    created: 0, recovered: 0, skipped: skippedIds.length,
    mediaOk: 0, mediaFailed: 0, errors: 0,
  }
  const lastId = list.length > 0 ? list[list.length - 1].id : null
  const imageTasks: Array<{ catalogProductId: string; imageUrl: string }> = []

  for (const r of jobResults) {
    if (r.status === 'rejected') {
      stats.errors += 1
      stats.lastError = r.reason instanceof Error ? r.reason.message : String(r.reason)
      logger.error({ err: stats.lastError }, '[create-new] job rechazado inesperadamente')
      continue
    }
    const v = r.value
    stats.created += v.created
    stats.recovered += v.recovered
    stats.errors += v.errors
    if (v.lastError) stats.lastError = v.lastError
    if (v.imageTask) imageTasks.push(v.imageTask)
    else stats.mediaFailed += 1
  }

  // Imágenes en paralelo al final
  if (imageTasks.length > 0) {
    logger.info({ count: imageTasks.length }, '[create-new] descargando imágenes en paralelo')
    const imgResults = await Promise.allSettled(
      imageTasks.map(t => downloadAndUploadProductImage(admin, t.catalogProductId, t.imageUrl))
    )
    for (const r of imgResults) {
      if (r.status === 'fulfilled' && r.value.ok) stats.mediaOk += 1
      else stats.mediaFailed += 1
    }
  }

  logger.info({ ...stats, hasMore: list.length === limit }, '[create-new] lote finalizado')

  return {
    ok: true,
    result: {
      stats,
      hasMore: list.length === limit,
      lastId,
      total: totalRemaining ?? 0,
    },
  }
}

/**
 * Procesa TODOS los pending_new en una sola operación atómica.
 * Lee todas las filas de una vez, precachea taxonomía, procesa en paralelo.
 */
export async function processHomologationCreateNewAll(
  admin: SupabaseClient,
  input: { fallbackCategoryId?: string | null },
): Promise<{ ok: true; result: CreateNewProductsAllResult } | { ok: false; error: string }> {
  /* ── Leer TODOS los pending_new de una vez ── */
  const { count: totalRemaining } = await admin
    .from('scrapping')
    .select('id', { count: 'exact', head: true })
    .eq('catalog_match_status', 'pending_new')

  const { data: rows, error } = await admin
    .from('scrapping')
    .select('id, retailer, external_ref, product_url, product_name, brand, price, sections, categories, image_url, catalog_match_status')
    .eq('catalog_match_status', 'pending_new')
    .order('id', { ascending: true })

  if (error) {
    logger.error({ err: error.message, code: error.code }, '[create-new] error consultando scrapping pending_new')
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  }

  const list = (rows ?? []) as Array<{
    id: string; retailer: string; external_ref: string; product_url: string | null
    product_name: string; brand: string | null; price: number | string | null
    sections: string | null; categories: string | null; image_url: string | null
  }>

  logger.info({ total: totalRemaining, rows: list.length }, '[create-new] iniciando procesamiento atómico')

  if (list.length === 0) {
    return { ok: true, result: { stats: { processed: 0, created: 0, recovered: 0, skipped: 0, mediaOk: 0, mediaFailed: 0, errors: 0 }, total: 0 } }
  }

  /* ── Pre-caché ── */
  type CatSection = { id: string; section_id: string }
  let fallbackCat: CatSection | null = null
  const overrideCatId = input.fallbackCategoryId?.trim() || null
  {
    const fbQ = overrideCatId
      ? admin.from('categories').select('id, section_id').eq('id', overrideCatId).maybeSingle()
      : admin.from('categories').select('id, section_id').order('sort_order', { ascending: true }).limit(1).maybeSingle()
    const { data } = await fbQ
    fallbackCat = (data as CatSection | null)
  }

  const sectionCache = new Map<string, string>()
  const sortOrderCache = new Map<string, number>()

  const resolvedCategoryIds = await Promise.all(
    list.map(row => resolveCatalogCategoryIdForScrappingRow(admin, {
      retailer: row.retailer, sections: row.sections, categories: row.categories,
    }))
  )

  const taxonomyCache = new Map<string, string | null>()
  for (let i = 0; i < list.length; i++) {
    const row = list[i]
    const key = `${row.retailer}|${row.sections ?? ''}|${row.categories ?? ''}`
    if (!taxonomyCache.has(key)) taxonomyCache.set(key, resolvedCategoryIds[i] ?? null)
  }

  const uniqueCategoryIds = [...new Set(resolvedCategoryIds.filter((id): id is string => id !== null))]
  if (uniqueCategoryIds.length > 0) {
    const { data: catRows } = await admin.from('categories').select('id, section_id').in('id', uniqueCategoryIds)
    for (const c of (catRows ?? []) as CatSection[]) sectionCache.set(c.id, c.section_id)

    const { data: sortRows } = await admin.from('catalog_products').select('category_id, sort_order').in('category_id', uniqueCategoryIds).order('sort_order', { ascending: false })
    const seen = new Set<string>()
    for (const r of (sortRows ?? []) as { category_id: string; sort_order: number }[]) {
      if (!seen.has(r.category_id)) { sortOrderCache.set(r.category_id, r.sort_order); seen.add(r.category_id) }
    }
  }

  /* ── Preparar jobs ── */
  type RowJob = {
    row: typeof list[number]; finalCategoryId: string; finalSectionId: string
    sortOrder: number; validPrice: number | null; sourceUrl: string | null
    norm: ReturnType<typeof normalizeRetailCapturedInput>
  }

  const jobs: RowJob[] = []
  const skippedIds: string[] = []

  for (const row of list) {
    const key = `${row.retailer}|${row.sections ?? ''}|${row.categories ?? ''}`
    const categoryId = taxonomyCache.get(key) ?? null
    let finalCategoryId = categoryId
    let finalSectionId = categoryId ? (sectionCache.get(categoryId) ?? null) : null
    if (!finalCategoryId || !finalSectionId) {
      if (fallbackCat) {
        finalCategoryId = finalCategoryId ?? fallbackCat.id
        finalSectionId = finalSectionId ?? fallbackCat.section_id
      }
    }
    if (!finalCategoryId || !finalSectionId) {
      logger.warn({ rowId: row.id }, '[create-new] sin categoría resuelta — omitido')
      skippedIds.push(row.id)
      continue
    }
    const currentMax = sortOrderCache.get(finalCategoryId) ?? -1
    const sortOrder = currentMax + 1
    sortOrderCache.set(finalCategoryId, sortOrder)

    const priceNum = typeof row.price === 'string' ? Number(row.price) : (row.price ?? 0)
    const validPrice = Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null
    const norm = normalizeRetailCapturedInput({
      retailer: row.retailer, external_ref: row.external_ref, source_url: row.product_url,
      title: row.product_name, brand: row.brand, price: validPrice, unit_price: null,
      category_hint: [row.sections, row.categories].filter(Boolean).join(' > '),
      description_hint: null, image_url: null, raw_data: null,
    })
    jobs.push({ row, finalCategoryId, finalSectionId, sortOrder, validPrice, sourceUrl: row.product_url?.trim() || null, norm })
  }

  /* ── Batch inserts masivos ── */
  const now = new Date().toISOString()

  // Detectar productos ya existentes por source_product_url
  const sourceUrls = [...new Set(jobs.map(j => j.sourceUrl).filter(Boolean) as string[])]
  const existingByUrl = new Map<string, string>()
  if (sourceUrls.length > 0) {
    const { data: existing } = await admin.from('catalog_products').select('id, source_product_url').in('source_product_url', sourceUrls)
    for (const e of (existing ?? []) as { id: string; source_product_url: string }[]) {
      existingByUrl.set(e.source_product_url, e.id)
    }
  }

  // Separar: nuevos vs recuperados
  const newJobs = jobs.filter(j => !existingByUrl.has(j.sourceUrl ?? ''))
  const recoveredJobs = jobs.filter(j => existingByUrl.has(j.sourceUrl ?? ''))

  // 1) Batch insert catalog_products (solo nuevos)
  let insertedIds: string[] = []
  if (newJobs.length > 0) {
    const { data, error } = await admin.from('catalog_products').insert(
      newJobs.map(j => ({
        name: j.row.product_name.trim(),
        section_id: j.finalSectionId,
        category_id: j.finalCategoryId,
        brand: j.row.brand?.trim() || null,
        brand_id: null,
        format: j.norm.format_signature,
        unit: null,
        default_reference_price: j.validPrice,
        sort_order: j.sortOrder,
        active: true,
        source_system: 'scrapping_homologation',
        source_product_url: j.sourceUrl,
      })) as never[]
    ).select('id')
    if (error) {
      logger.error({ err: error.message }, '[create-new] error batch insert catalog_products')
      return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
    }
    insertedIds = ((data ?? []) as { id: string }[]).map(r => r.id)
  }

  // Mapear job → catalog_product_id
  const jobToCatalogId = new Map<number, string>()
  newJobs.forEach((j, i) => { jobToCatalogId.set(jobs.indexOf(j), insertedIds[i]) })
  recoveredJobs.forEach(j => { jobToCatalogId.set(jobs.indexOf(j), existingByUrl.get(j.sourceUrl ?? '')!) })

  // 2) Batch insert catalog_retail_links
  const allLinks = jobs.map((j, idx) => {
    const catalogProductId = jobToCatalogId.get(idx)
    if (!catalogProductId) return null
    return {
      retailer: j.row.retailer,
      external_ref: j.row.external_ref,
      catalog_product_id: catalogProductId,
      updated_at: now,
    }
  }).filter(Boolean) as never[]

  if (allLinks.length > 0) {
    const { error } = await admin.from('catalog_retail_links').upsert(allLinks, { onConflict: 'retailer,external_ref' })
    if (error) logger.error({ err: error.message }, '[create-new] error batch insert links')
  }

  // 3) Batch insert aliases
  const allAliases = jobs.map((j, idx) => {
    const aliasNorm = normalizeCatalogAlias(j.row.product_name)
    if (aliasNorm.length < 2) return null
    const catalogProductId = jobToCatalogId.get(idx)
    if (!catalogProductId) return null
    return { catalog_product_id: catalogProductId, alias_normalized: aliasNorm }
  }).filter(Boolean) as never[]

  if (allAliases.length > 0) {
    const { error } = await admin.from('catalog_product_aliases').insert(allAliases)
    if (error) logger.warn({ err: error.message }, '[create-new] error batch insert aliases (posible duplicado)')
  }

  // 4) Batch update scrapping
  const allUpdates = jobs.map((j, idx) => {
    const catalogProductId = jobToCatalogId.get(idx)
    const isRecovered = existingByUrl.has(j.sourceUrl ?? '')
    if (!catalogProductId) return null
    return {
      id: j.row.id,
      catalog_match_status: 'matched',
      matched_catalog_product_id: catalogProductId,
      catalog_matched_at: now,
      homolog_final_status: isRecovered ? 'MATCHED_EXISTING' : 'CREATED_NEW',
      homolog_reviewed_at: now,
    }
  }).filter(Boolean) as never[]

  if (allUpdates.length > 0) {
    // Supabase no tiene batch update por ID fácilmente, hacemos upsert
    const { error } = await admin.from('scrapping').upsert(allUpdates, { onConflict: 'id' })
    if (error) {
      logger.error({ err: error.message }, '[create-new] error batch update scrapping')
      return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
    }
  }

  /* ── Imágenes en paralelo ── */
  const imageTasks: Array<{ catalogProductId: string; imageUrl: string }> = []
  for (const j of jobs) {
    const idx = jobs.indexOf(j)
    const catalogProductId = jobToCatalogId.get(idx)
    if (!catalogProductId) continue
    const imageUrl = j.row.image_url?.trim() || inferImageUrlFromProductUrl(j.row.product_url)
    if (imageUrl) imageTasks.push({ catalogProductId, imageUrl })
  }

  let mediaOk = 0
  let mediaFailed = 0
  if (imageTasks.length > 0) {
    logger.info({ count: imageTasks.length }, '[create-new] descargando imágenes en paralelo')
    const imgResults = await Promise.allSettled(imageTasks.map(t => downloadAndUploadProductImage(admin, t.catalogProductId, t.imageUrl)))
    for (const r of imgResults) {
      if (r.status === 'fulfilled' && r.value.ok) mediaOk += 1
      else mediaFailed += 1
    }
  }

  const stats: CreateNewProductsSummary = {
    processed: jobs.length,
    created: newJobs.length,
    recovered: recoveredJobs.length,
    skipped: skippedIds.length,
    mediaOk,
    mediaFailed,
    errors: 0,
  }

  logger.info({ ...stats }, '[create-new] procesamiento atómico finalizado')

  return { ok: true, result: { stats, total: totalRemaining ?? 0 } }
}
