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
import { getPublicUploadBucket } from '@/lib/storage-bucket'
import logger from '@/lib/logger'
import {
  normalizeLiderSectionKeyStrong,
  normalizeLiderCategoryKeyStrong,
} from '@/lib/lider-taxonomy-section-heuristics'

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

  /* ── Precargar TODA la taxonomía en 2 queries (BEVECOHO: nunca query por query) ── */
  const taxonomyCache = new Map<string, string | null>()

  // 1) Cargar todas las secciones Lider linked de una vez
  const { data: allLiderSecs } = await admin
    .from('retail_taxonomy_lider_sections')
    .select('id, section_id, normalized_external_section')
    .eq('retailer', 'lider')
    .eq('status', 'linked')

  const secByNorm = new Map<string, { id: string; section_id: string }>()
  for (const s of (allLiderSecs ?? []) as { id: string; section_id: string; normalized_external_section: string }[]) {
    secByNorm.set(s.normalized_external_section, { id: s.id, section_id: s.section_id })
  }

  // 2) Cargar todos los mappings Lider linked de una vez
  const { data: allMappings } = await admin
    .from('retail_taxonomy_mappings')
    .select('lider_section_id, normalized_external_category, category_id, section_id')
    .eq('retailer', 'lider')
    .eq('status', 'linked')

  const mapKey = (liderSectionId: string, normCat: string) => `${liderSectionId}|${normCat}`
  const mapByKey = new Map<string, string>()
  for (const m of (allMappings ?? []) as { lider_section_id: string; normalized_external_category: string; category_id: string; section_id: string }[]) {
    mapByKey.set(mapKey(m.lider_section_id, m.normalized_external_category), m.category_id)
  }

  // Resolver taxonomía en memoria (0 queries adicionales)
  for (const row of list) {
    const key = `${row.retailer}|${row.sections ?? ''}|${row.categories ?? ''}`
    if (taxonomyCache.has(key)) continue

    const ns = normalizeLiderSectionKeyStrong(row.sections ?? '')
    const nc = normalizeLiderCategoryKeyStrong(row.categories ?? '')
    if (!ns || !nc) { taxonomyCache.set(key, null); continue }

    const sec = secByNorm.get(ns)
    if (!sec) { taxonomyCache.set(key, null); continue }

    const catId = mapByKey.get(mapKey(sec.id, nc))
    if (!catId || sec.section_id !== sec.section_id) { taxonomyCache.set(key, null); continue }

    taxonomyCache.set(key, catId)
  }

  const uniqueCategoryIds = [...new Set([...taxonomyCache.values()].filter((id): id is string => id !== null))]

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
/**
 * Crea productos maestros desde scrapping pending_new via RPC atomico en Postgres.
 * Reemplaza la logica de batches que se atascaba por limite de PostgREST.
 */
export async function processHomologationCreateNewAll(
  admin: SupabaseClient,
): Promise<{ ok: true; result: CreateNewProductsAllResult } | { ok: false; error: string; __technical?: string }> {
  try {
    const { data, error } = await admin.rpc('scrapping_create_new_products_all' as never)
    if (error) {
      const msg = error instanceof Error ? error.message : JSON.stringify(error)
      const code = (error as unknown as { code?: string }).code
      const tech = code ? `[${code}] ${msg}` : msg
      logger.error({ err: msg, code }, '[create-new] RPC error')
      return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic'), __technical: tech }
    }

    const raw = data as unknown
    const o: Record<string, unknown> =
      Array.isArray(raw) && raw.length > 0 && raw[0] != null && typeof raw[0] === 'object'
        ? (raw[0] as Record<string, unknown>)
        : (raw as Record<string, unknown>)

    const processed = Number(o.processed ?? 0)
    const created = Number(o.created ?? 0)
    const recovered = Number(o.recovered ?? 0)

    const result: CreateNewProductsAllResult = {
      stats: {
        processed,
        created,
        recovered,
        skipped: Number(o.skipped ?? 0),
        mediaOk: 0,
        mediaFailed: 0,
        errors: 0,
      },
      total: processed,
    }

    logger.info({ ...result.stats }, '[create-new] RPC completado')
    return { ok: true, result }
  } catch (e) {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, '[create-new] excepcion')
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}
