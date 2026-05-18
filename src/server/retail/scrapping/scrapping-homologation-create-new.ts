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

/* ── Tipos ── */

export type CreateNewProductsSummary = {
  processed: number
  created: number
  skipped: number
  mediaOk: number
  mediaFailed: number
  errors: number
}

export type CreateNewProductsBatchResult = {
  stats: CreateNewProductsSummary
  hasMore: boolean
  lastId: string | null
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
    const resp = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'HubStockAI/1.0' },
    })
    if (!resp.ok) return { ok: false }

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
    if (upErr) return { ok: false }

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
  } catch {
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
  const limit = Math.min(Math.max(input.batchSize ?? 10, 1), 50)

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
  if (error) return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }

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

  const stats: CreateNewProductsSummary = {
    processed: 0, created: 0, skipped: 0, mediaOk: 0, mediaFailed: 0, errors: 0,
  }
  let lastId: string | null = null

  for (const row of list) {
    lastId = row.id
    stats.processed += 1

    try {
      // 1. Resolver categoría del catálogo
      const categoryId = await resolveCatalogCategoryIdForScrappingRow(admin, {
        retailer: row.retailer,
        sections: row.sections,
        categories: row.categories,
      })

      let sectionId: string | null = null

      if (categoryId) {
        // Obtener section_id de la categoría
        const { data: catRow } = await admin
          .from('categories')
          .select('id, section_id')
          .eq('id', categoryId)
          .maybeSingle()
        sectionId = (catRow as { section_id: string } | null)?.section_id ?? null
      }

      // Si no encontró taxonomía: usar override del usuario o primera categoría disponible
      let finalCategoryId = categoryId
      let finalSectionId = sectionId
      if (!finalCategoryId || !finalSectionId) {
        const overrideCatId = input.fallbackCategoryId?.trim() || null
        const fbQ = overrideCatId ?
          admin.from('categories').select('id, section_id').eq('id', overrideCatId).maybeSingle()
        : admin.from('categories').select('id, section_id').order('sort_order', { ascending: true }).limit(1).maybeSingle()
        const { data: fallback } = await fbQ
        if (fallback) {
          finalCategoryId = finalCategoryId ?? (fallback as { id: string }).id
          finalSectionId = finalSectionId ?? (fallback as { section_id: string }).section_id
        }
      }

      if (!finalCategoryId || !finalSectionId) {
        stats.skipped += 1
        continue
      }

      // 2. Calcular sort_order
      const { data: maxData } = await admin
        .from('catalog_products')
        .select('sort_order')
        .eq('category_id', finalCategoryId)
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle()
      const sortOrder = ((maxData as { sort_order: number } | null)?.sort_order ?? -1) + 1

      // 3. Normalizar datos
      const priceNum = typeof row.price === 'string' ? Number(row.price) : (row.price ?? 0)
      const validPrice = Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null

      const norm = normalizeRetailCapturedInput({
        retailer: row.retailer,
        external_ref: row.external_ref,
        source_url: row.product_url,
        title: row.product_name,
        brand: row.brand,
        price: validPrice,
        unit_price: null,
        category_hint: [row.sections, row.categories].filter(Boolean).join(' > '),
        description_hint: null,
        image_url: null,
        raw_data: null,
      })

      // 4. Crear producto en catalog_products
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
          source_product_url: row.product_url?.trim() || null,
        } as never)
        .select('id')
        .single()

      if (createErr || !created) {
        stats.errors += 1
        continue
      }

      const catalogProductId = (created as { id: string }).id
      stats.created += 1

      // 5. Crear link retail + alias
      const { error: linkErr } = await admin.from('catalog_retail_links').upsert(
        {
          retailer: row.retailer,
          external_ref: row.external_ref,
          catalog_product_id: catalogProductId,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: 'retailer,external_ref' },
      )
      if (linkErr) {
        stats.errors += 1
      }

      // Alias
      const aliasNorm = normalizeCatalogAlias(row.product_name)
      if (aliasNorm.length >= 2) {
        const ins = await admin.from('catalog_product_aliases').insert({
          catalog_product_id: catalogProductId,
          alias_normalized: aliasNorm,
        } as never)
        if (ins.error && !isUniqueViolation(ins.error)) {
          // non-fatal
        }
      }

      // 6. Intentar descargar imagen (primero desde image_url capturado, luego inferir desde product_url)
      const imageUrl = row.image_url?.trim() || inferImageUrlFromProductUrl(row.product_url)
      if (imageUrl) {
        const img = await downloadAndUploadProductImage(admin, catalogProductId, imageUrl)
        if (img.ok) {
          stats.mediaOk += 1
        } else {
          stats.mediaFailed += 1
        }
      } else {
        stats.mediaFailed += 1
      }

      // 7. Marcar fila de scrapping como procesada
      await admin
        .from('scrapping')
        .update({
          catalog_match_status: 'matched',
          matched_catalog_product_id: catalogProductId,
          catalog_matched_at: new Date().toISOString(),
          homolog_final_status: 'CREATED_NEW',
          homolog_reviewed_at: new Date().toISOString(),
        } as never)
        .eq('id', row.id)

    } catch {
      stats.errors += 1
    }
  }

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
