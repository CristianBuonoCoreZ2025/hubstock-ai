'use server'

import { getProfileContext } from '@/lib/profile/context'
import { assertProfileMembership } from '@/lib/profile/membership'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/server/supabase-admin'
import { downloadAndUploadProductImage } from '@/lib/catalog-image-download'
import { getUserFriendlyErrorMessage } from '@/lib/user-friendly-errors'

export type FetchMissingImagesResult =
  | {
      ok: true
      processed: number
      success: number
      failed: number
      remaining: number
      __diagnostic?: Record<string, unknown>
    }
  | {
      ok: false
      error: string
      __diagnostic?: Record<string, unknown>
    }

/**
 * Descarga imágenes faltantes para productos del catálogo creados desde scrapping.
 * Busca scrapping.image_url para productos sin catalog_product_media.
 */
export async function fetchMissingCatalogImagesAction(
  input?: { batchSize?: number }
): Promise<FetchMissingImagesResult> {
  const diag: Record<string, unknown> = { step: 'init' }
  try {
    const userData = await getProfileContext()
    diag.profile = userData.activeProfileId
    if (!userData.activeProfileId) {
      return { ok: false, error: 'No hay perfil activo.', __diagnostic: diag }
    }

    const supabase = await createClient()
    const membership = await assertProfileMembership(supabase, userData.activeProfileId, {
      minRole: 'editor',
    })
    diag.membership = membership.ok ? membership.role : membership.reason
    if (!membership.ok) {
      return { ok: false, error: membership.reason, __diagnostic: diag }
    }

    const admin = createServiceRoleClient()
    const batchSize = Math.min(Math.max(input?.batchSize ?? 50, 1), 100)
    diag.batchSize = batchSize

    // 1) Contar total productos scrapping
    const { count: totalScrapping, error: countErr } = await admin
      .from('catalog_products')
      .select('id', { count: 'exact', head: true })
      .in('source_system', ['scrapping_homologation', 'scrapping_homologation_v2'])

    if (countErr) {
      diag.step = 'count_error'
      diag.countError = countErr
      return { ok: false, error: getUserFriendlyErrorMessage(countErr, 'generic'), __diagnostic: diag }
    }
    diag.totalScrapping = totalScrapping ?? 0

    // 2) Traer productos scrapping SIN imagen (outer join manual)
    const { data: products, error: prodErr } = await admin
      .from('catalog_products')
      .select('id, name, source_system')
      .in('source_system', ['scrapping_homologation', 'scrapping_homologation_v2'])
      .limit(500)

    if (prodErr) {
      diag.step = 'products_error'
      diag.prodError = prodErr
      return { ok: false, error: getUserFriendlyErrorMessage(prodErr, 'generic'), __diagnostic: diag }
    }
    diag.productsFetched = (products ?? []).length

    // 3) Traer todos los IDs que YA tienen media
    const { data: mediaRows, error: mediaErr } = await admin
      .from('catalog_product_media')
      .select('catalog_product_id')

    if (mediaErr) {
      diag.step = 'media_error'
      diag.mediaError = mediaErr
      return { ok: false, error: getUserFriendlyErrorMessage(mediaErr, 'generic'), __diagnostic: diag }
    }
    const withMedia = new Set<string>(
      ((mediaRows ?? []) as Array<{ catalog_product_id: string }>).map((r) => r.catalog_product_id)
    )
    diag.withMediaCount = withMedia.size

    // 4) Filtrar SIN imagen, tomar batch
    const needImage = ((products ?? []) as Array<{ id: string; name: string; source_system: string }>)
      .filter((p) => !withMedia.has(p.id))
      .slice(0, batchSize)

    diag.needImageCount = needImage.length
    diag.needImageIds = needImage.map((p) => p.id)

    if (needImage.length === 0) {
      diag.step = 'no_need'
      return {
        ok: true,
        processed: 0,
        success: 0,
        failed: 0,
        remaining: (totalScrapping ?? 0) - withMedia.size,
        __diagnostic: diag,
      }
    }

    const productIds = needImage.map((p) => p.id)

    // 5) Buscar image_url en scrapping
    const { data: scrappingRows, error: scrErr } = await admin
      .from('scrapping')
      .select('matched_catalog_product_id, image_url')
      .in('matched_catalog_product_id', productIds)
      .not('image_url', 'is', null)

    if (scrErr) {
      diag.step = 'scrapping_error'
      diag.scrErr = scrErr
      return { ok: false, error: getUserFriendlyErrorMessage(scrErr, 'generic'), __diagnostic: diag }
    }
    const scrappingData = (scrappingRows ?? []) as Array<{
      matched_catalog_product_id: string
      image_url: string
    }>
    diag.scrappingRowsFound = scrappingData.length

    const urlByProduct = new Map<string, string>()
    for (const row of scrappingData) {
      if (!urlByProduct.has(row.matched_catalog_product_id)) {
        urlByProduct.set(row.matched_catalog_product_id, row.image_url.trim())
      }
    }
    diag.productsWithUrl = urlByProduct.size

    // 6) Descargar imágenes en paralelo
    let success = 0
    let failed = 0
    const tasks: Array<Promise<void>> = []

    for (const pid of productIds) {
      const url = urlByProduct.get(pid)
      if (!url) {
        failed++
        continue
      }
      tasks.push(
        downloadAndUploadProductImage(admin, pid, url).then((res) => {
          if (res.ok) success++
          else failed++
        })
      )
    }

    await Promise.all(tasks)

    diag.step = 'done'
    diag.success = success
    diag.failed = failed

    // 7) Recalcular remaining (refrescando withMedia con los nuevos)
    const { data: freshMedia } = await admin
      .from('catalog_product_media')
      .select('catalog_product_id')

    const freshWithMedia = new Set<string>(
      ((freshMedia ?? []) as Array<{ catalog_product_id: string }>).map((r) => r.catalog_product_id)
    )
    const remaining = (totalScrapping ?? 0) - freshWithMedia.size

    return {
      ok: true,
      processed: needImage.length,
      success,
      failed,
      remaining,
      __diagnostic: diag,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    diag.step = 'exception'
    diag.exception = msg
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic'), __diagnostic: diag }
  }
}
