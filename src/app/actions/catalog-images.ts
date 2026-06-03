'use server'

import { getProfileContext } from '@/lib/profile/context'
import { assertProfileMembership } from '@/lib/profile/membership'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/server/supabase-admin'
import { downloadAndUploadProductImage } from '@/lib/catalog-image-download'
import { getPublicUploadBucket } from '@/lib/storage-bucket'
import { getUserFriendlyErrorMessage } from '@/lib/user-friendly-errors'
import { resolveLiderStoreBaseUrl } from '@/server/retail/capture/lider-catalog-plan'
import { fetchLiderRetailProducts } from '@/server/retail-capture/fetch-lider-retail'
import { recaptureProductImageUrl } from '@/lib/catalog-image-recapture'

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

/** Muestra de un fallo individual para diagnostico */
type FailSample = {
  productId: string
  productName?: string
  stage: 'no_link' | 'no_snapshot_image' | 'search_api' | 'no_url_found' | 'download'
  detail: string
  searchUrl?: string
}

const EXTERNAL_MEDIA_BUCKET = 'external'

/**
 * Busca un producto por nombre en la cadena retail y retorna la primera imagen encontrada.
 *
 * - Lider: HTML scraping via fetch-lider-retail (super.lider.cl NO expone la API VTEX publica)
 * - Jumbo / Central Mayorista: API VTEX catalog_system ft=
 *
 * Solo se usa como fallback cuando catalog_retail_snapshots.image_url esta vacia.
 */
async function fetchImageByNameForRetailer(
  retailer: string,
  base: string,
  productName: string,
): Promise<{ imageUrl: string | null; searchUrl: string; error: string | null }> {
  const shortName = productName.split(/\s+/).slice(0, 4).join(' ')

  if (retailer === 'lider') {
    const searchUrl = `${base.replace(/\/+$/, '')}/search?q=${encodeURIComponent(shortName)}`
    try {
      const result = await fetchLiderRetailProducts(base, shortName, 5)
      if (!result.ok) {
        const statusStr = 'status' in result && result.status ? ` (HTTP ${result.status})` : ''
        return { imageUrl: null, searchUrl, error: `busqueda HTML fallo: ${result.reason}${statusStr}` }
      }
      if (result.products.length === 0) {
        return { imageUrl: null, searchUrl, error: 'sin resultados en busqueda HTML de Lider' }
      }
      for (const rawProduct of result.products) {
        const product = rawProduct as Record<string, unknown>
        const items = product.items
        if (!Array.isArray(items) || items.length === 0) continue
        const item = items[0] as Record<string, unknown>
        const images = item.images
        if (!Array.isArray(images) || images.length === 0) continue
        const firstImg = images[0] as Record<string, unknown>
        const raw = firstImg.imageUrl ?? firstImg.ImageUrl
        if (typeof raw === 'string' && raw.trim().startsWith('http')) {
          return { imageUrl: raw.trim(), searchUrl, error: null }
        }
      }
      return {
        imageUrl: null,
        searchUrl,
        error: `${result.products.length} productos en HTML pero ninguno con imagen`,
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { imageUrl: null, searchUrl, error: `excepcion en busqueda Lider: ${msg}` }
    }
  }

  // Jumbo / Central Mayorista: API VTEX ft=
  const searchUrl = `${base.replace(/\/+$/, '')}/api/catalog_system/pub/products/search?_from=0&_to=4&ft=${encodeURIComponent(shortName)}`
  try {
    const res = await fetch(searchUrl, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; HubStockAI/1.0)' },
      cache: 'no-store',
    })
    if (!res.ok) return { imageUrl: null, searchUrl, error: `HTTP ${res.status}` }
    const json = (await res.json()) as unknown
    if (!Array.isArray(json) || json.length === 0) {
      return {
        imageUrl: null,
        searchUrl,
        error: Array.isArray(json) ? 'array vacio' : `respuesta no es array (${typeof json})`,
      }
    }
    for (const rawProduct of json) {
      const product = rawProduct as Record<string, unknown>
      const items = product.items
      if (!Array.isArray(items) || items.length === 0) continue
      const item = items[0] as Record<string, unknown>
      const images = item.images
      if (!Array.isArray(images) || images.length === 0) continue
      const firstImg = images[0] as Record<string, unknown>
      const raw = firstImg.imageUrl ?? firstImg.ImageUrl
      if (typeof raw === 'string' && raw.trim().startsWith('http')) {
        return { imageUrl: raw.trim(), searchUrl, error: null }
      }
    }
    return { imageUrl: null, searchUrl, error: `${json.length} productos encontrados pero ninguno con imagen` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { imageUrl: null, searchUrl, error: `excepcion: ${msg}` }
  }
}

/**
 * Descarga imagenes faltantes para productos del catalogo creados desde scrapping.
 *
 * Estrategia (en orden):
 * 1. scrapping.matched_catalog_product_id -> image_url  (productos v2 nuevos)
 * 2. catalog_retail_links -> catalog_retail_snapshots.image_url  (imagen ya scrapeada)
 * 3. Fallback: busqueda por nombre en la cadena retail (HTML para Lider, VTEX ft= para otros)
 *
 * El campo __diagnostic contiene:
 *   - failSamples: primeros 10 fallos con motivo exacto y URL intentada
 *   - searchUrlSamples: primeras 5 URLs de busqueda construidas para verificacion manual
 *   - metricas de cada etapa
 */
/**
 * Health-check rapido para retailer. Evita lanzar 48+ requests si la API esta bloqueada.
 */
async function isRetailerSearchHealthy(retailer: string, base: string): Promise<boolean> {
  const testName = 'test'
  if (retailer === 'lider') {
    try {
      const result = await fetchLiderRetailProducts(base, testName, 1)
      return result.ok
    } catch {
      return false
    }
  }
  // Jumbo / Central Mayorista: API VTEX ft=
  const searchUrl = `${base.replace(/\/+$/, '')}/api/catalog_system/pub/products/search?_from=0&_to=0&ft=${encodeURIComponent(testName)}`
  try {
    const res = await fetch(searchUrl, {
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; HubStockAI/1.0)' },
      cache: 'no-store',
    })
    if (!res.ok) return false
    const text = await res.text()
    if (text.trim().startsWith('<')) return false
    JSON.parse(text) // validar que es JSON
    return true
  } catch {
    return false
  }
}

export async function fetchMissingCatalogImagesAction(
  input?: { batchSize?: number }
): Promise<FetchMissingImagesResult> {
  const diag: Record<string, unknown> = { step: 'init' }
  const failSamples: FailSample[] = []
  const searchUrlSamples: string[] = []

  function addFail(sample: FailSample) {
    if (failSamples.length < 10) failSamples.push(sample)
  }

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

    // Verificar bucket de storage antes de intentar descargas
    const bucketName = getPublicUploadBucket()
    const { data: buckets } = await admin.storage.listBuckets()
    const bucketExists = buckets?.some((b) => b.name === bucketName)
    if (!bucketExists) {
      diag.step = 'bucket_missing'
      diag.bucketName = bucketName
      return {
        ok: false,
        error: `El bucket "${bucketName}" no existe en Supabase Storage. Crealo antes de recuperar imagenes.`,
        __diagnostic: diag,
      }
    }
    diag.batchSize = batchSize

    // 1) Contar total productos scrapping
    const { count: totalScrapping, error: countErr } = await admin
      .from('catalog_products')
      .select('id', { count: 'exact', head: true })
      .in('source_system', ['scrapping_homologation', 'scrapping_homologation_v2'])
      .order('created_at', { ascending: true })

    if (countErr) {
      diag.step = 'count_error'
      return { ok: false, error: getUserFriendlyErrorMessage(countErr, 'generic'), __diagnostic: diag }
    }
    diag.totalScrapping = totalScrapping ?? 0

    // 2) Traer productos scrapping (con name para diagnostico)
    const { data: products, error: prodErr } = await admin
      .from('catalog_products')
      .select('id, name, source_system')
      .in('source_system', ['scrapping_homologation', 'scrapping_homologation_v2'])
      .limit(500)

    if (prodErr) {
      diag.step = 'products_error'
      return { ok: false, error: getUserFriendlyErrorMessage(prodErr, 'generic'), __diagnostic: diag }
    }
    diag.productsFetched = (products ?? []).length

    /**
     * 3) Traer media existente (con bucket_id) y separar:
     *    - storage interno (bucket_id != 'external'): producto YA tiene thumbnail listo.
     *    - storage externo (bucket_id == 'external'): URL del retail pendiente de descarga.
     *      Inserta el SQL `scrapping_create_new_products_all` v2 al crear productos nuevos.
     */
    const { data: mediaRows, error: mediaErr } = await admin
      .from('catalog_product_media')
      .select('catalog_product_id, bucket_id, public_url')

    if (mediaErr) {
      diag.step = 'media_error'
      return { ok: false, error: getUserFriendlyErrorMessage(mediaErr, 'generic'), __diagnostic: diag }
    }

    const withInternalMedia = new Set<string>()
    const externalUrlByProduct = new Map<string, string>()
    for (const row of (mediaRows ?? []) as Array<{
      catalog_product_id: string
      bucket_id: string | null
      public_url: string | null
    }>) {
      if (row.bucket_id === EXTERNAL_MEDIA_BUCKET) {
        const u = row.public_url?.trim()
        if (u && u.startsWith('http')) externalUrlByProduct.set(row.catalog_product_id, u)
      } else {
        withInternalMedia.add(row.catalog_product_id)
      }
    }
    diag.withInternalMediaCount = withInternalMedia.size
    diag.withExternalMediaCount = externalUrlByProduct.size

    // 4) Filtrar SIN thumbnail interno, mezclar aleatoriamente y tomar batch
    const allProducts = (products ?? []) as Array<{ id: string; name: string; source_system: string }>
    const withoutInternal = allProducts.filter((p) => !withInternalMedia.has(p.id))
    // Mezclar para evitar procesar siempre los mismos productos (ej: todos Jumbo bloqueado)
    for (let i = withoutInternal.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[withoutInternal[i], withoutInternal[j]] = [withoutInternal[j], withoutInternal[i]]
    }
    const needImage = withoutInternal.slice(0, batchSize)
    const nameByProduct = new Map<string, string>(allProducts.map((p) => [p.id, p.name]))

    diag.needImageCount = needImage.length
    diag.sampleProductNames = needImage.slice(0, 3).map((p) => p.name)

    if (needImage.length === 0) {
      diag.step = 'no_need'
      return {
        ok: true,
        processed: 0,
        success: 0,
        failed: 0,
        remaining: (totalScrapping ?? 0) - withInternalMedia.size,
        __diagnostic: diag,
      }
    }

    const productIds = needImage.map((p) => p.id)
    const urlByProduct = new Map<string, string>()

    /**
     * Estrategia 0 (la principal post-v2): URL externa ya registrada en
     * `catalog_product_media` con bucket_id='external'. La copió el SQL al crear el producto.
     */
    for (const pid of productIds) {
      const u = externalUrlByProduct.get(pid)
      if (u) urlByProduct.set(pid, u)
    }
    diag.foundByStrategy0_externalMedia = urlByProduct.size

    // ─── Estrategia 1: scrapping.matched_catalog_product_id -> image_url ────────
    const { data: byMatchedId, error: scrErr } = await admin
      .from('scrapping')
      .select('matched_catalog_product_id, image_url, product_url')
      .in('matched_catalog_product_id', productIds)

    if (scrErr) {
      diag.step = 'scrapping_error'
      return { ok: false, error: getUserFriendlyErrorMessage(scrErr, 'generic'), __diagnostic: diag }
    }
    const productUrlById = new Map<string, string>()
    const sizeBeforeS1 = urlByProduct.size
    for (const row of (byMatchedId ?? []) as Array<{
      matched_catalog_product_id: string
      image_url: string | null
      product_url: string | null
    }>) {
      if (row.image_url?.trim() && !urlByProduct.has(row.matched_catalog_product_id)) {
        urlByProduct.set(row.matched_catalog_product_id, row.image_url.trim())
      }
      if (row.product_url?.trim() && !productUrlById.has(row.matched_catalog_product_id)) {
        productUrlById.set(row.matched_catalog_product_id, row.product_url.trim())
      }
    }
    diag.addedByStrategy1_scrapping = urlByProduct.size - sizeBeforeS1
    diag.cumulativeAfterStrategy1 = urlByProduct.size
    diag.productUrlsAvailable = productUrlById.size

    // ─── Estrategia 2: catalog_retail_links -> catalog_retail_snapshots.image_url ──
    const missingAfterS1 = productIds.filter((pid) => !urlByProduct.has(pid))
    diag.missingAfterStrategy1 = missingAfterS1.length

    if (missingAfterS1.length > 0) {
      const { data: linkRows, error: linkErr } = await admin
        .from('catalog_retail_links')
        .select('retailer, external_ref, catalog_product_id')
        .in('catalog_product_id', missingAfterS1)

      diag.linkErr = linkErr ? String(linkErr.message ?? '') : null
      const linkData = (linkRows ?? []) as Array<{
        retailer: string
        external_ref: string
        catalog_product_id: string
      }>
      diag.linksFound = linkData.length

      // Productos sin link en catalog_retail_links
      const linkedIds = new Set(linkData.map((l) => l.catalog_product_id))
      for (const pid of missingAfterS1) {
        if (!linkedIds.has(pid)) {
          addFail({
            productId: pid,
            productName: nameByProduct.get(pid),
            stage: 'no_link',
            detail: 'sin entrada en catalog_retail_links',
          })
        }
      }

      if (linkData.length > 0) {
        // Obtener image_url (y source_url de referencia) de catalog_retail_snapshots
        const refsByRetailer = new Map<string, string[]>()
        for (const l of linkData) {
          const list = refsByRetailer.get(l.retailer) ?? []
          list.push(l.external_ref)
          refsByRetailer.set(l.retailer, list)
        }

        type SnapData = { image_url: string | null; source_url: string | null }
        const snapByRef = new Map<string, SnapData>()

        for (const [retailer, refs] of refsByRetailer.entries()) {
          const { data: snapRows } = await admin
            .from('catalog_retail_snapshots')
            .select('external_ref, image_url, source_url')
            .eq('retailer', retailer)
            .in('external_ref', refs)
            .order('captured_at', { ascending: false })

          for (const s of (snapRows ?? []) as Array<{
            external_ref: string
            image_url: string | null
            source_url: string | null
          }>) {
            if (!snapByRef.has(s.external_ref)) {
              snapByRef.set(s.external_ref, { image_url: s.image_url, source_url: s.source_url })
            }
          }
        }
        diag.snapshotsFound = snapByRef.size

        let snapWithImage = 0
        let snapWithoutImage = 0
        for (const v of snapByRef.values()) {
          if (v.image_url?.trim()) snapWithImage++
          else snapWithoutImage++
        }
        diag.snapshotsWithImageUrl = snapWithImage
        diag.snapshotsWithoutImageUrl = snapWithoutImage

        // Asignar image_url directo desde snapshot
        const sizeBeforeS2 = urlByProduct.size
        for (const link of linkData) {
          if (urlByProduct.has(link.catalog_product_id)) continue
          const snap = snapByRef.get(link.external_ref)
          if (snap?.image_url?.trim()) {
            urlByProduct.set(link.catalog_product_id, snap.image_url.trim())
          }
        }
        diag.addedByStrategy2_snapshot = urlByProduct.size - sizeBeforeS2
        diag.cumulativeAfterStrategy2 = urlByProduct.size

        // ─── Estrategia 3 (fallback): busqueda por nombre en retail ────────────
        const stillMissing = linkData.filter((l) => !urlByProduct.has(l.catalog_product_id))
        diag.missingAfterStrategy2 = stillMissing.length

        if (stillMissing.length > 0) {
          const liderBase = resolveLiderStoreBaseUrl()
          const searchTasks: Array<Promise<void>> = []
          let searchHit = 0
          let searchMiss = 0

          // Health-check rapido: si Jumbo o Central devuelven HTML/410, saltarlas todas
          const needsJumbo = stillMissing.some((l) => l.retailer === 'jumbo')
          const needsCentral = stillMissing.some((l) => l.retailer === 'central_mayorista')
          const jumboHealthy = needsJumbo ? await isRetailerSearchHealthy('jumbo', 'https://www.jumbo.cl') : true
          const centralHealthy = needsCentral ? await isRetailerSearchHealthy('central_mayorista', 'https://www.centralmayor.cl') : true
          diag.jumboHealthy = jumboHealthy
          diag.centralHealthy = centralHealthy

          for (const link of stillMissing) {
            const apiBase =
              link.retailer === 'lider' ? liderBase
              : link.retailer === 'jumbo' ? 'https://www.jumbo.cl'
              : link.retailer === 'central_mayorista' ? 'https://www.centralmayor.cl'
              : null

            if (!apiBase) {
              addFail({
                productId: link.catalog_product_id,
                productName: nameByProduct.get(link.catalog_product_id),
                stage: 'no_snapshot_image',
                detail: `retailer desconocido: "${link.retailer}"`,
              })
              searchMiss++
              continue
            }

            if (link.retailer === 'jumbo' && !jumboHealthy) {
              addFail({
                productId: link.catalog_product_id,
                productName: nameByProduct.get(link.catalog_product_id),
                stage: 'search_api',
                detail: 'Jumbo API no disponible (bloqueada). Se omite busqueda.',
              })
              searchMiss++
              continue
            }
            if (link.retailer === 'central_mayorista' && !centralHealthy) {
              addFail({
                productId: link.catalog_product_id,
                productName: nameByProduct.get(link.catalog_product_id),
                stage: 'search_api',
                detail: 'Central Mayorista API no disponible (bloqueada). Se omite busqueda.',
              })
              searchMiss++
              continue
            }

            const name = nameByProduct.get(link.catalog_product_id) ?? ''
            if (!name) {
              addFail({
                productId: link.catalog_product_id,
                productName: undefined,
                stage: 'no_snapshot_image',
                detail: 'sin nombre de producto para buscar',
              })
              searchMiss++
              continue
            }

            const pid = link.catalog_product_id
            searchTasks.push(
              fetchImageByNameForRetailer(link.retailer, apiBase, name).then(
                ({ imageUrl, searchUrl, error }) => {
                  if (searchUrlSamples.length < 5) searchUrlSamples.push(searchUrl)
                  if (imageUrl && !urlByProduct.has(pid)) {
                    urlByProduct.set(pid, imageUrl)
                    searchHit++
                  } else {
                    addFail({
                      productId: pid,
                      productName: name,
                      stage: 'search_api',
                      detail: error ?? 'sin imagen en resultado de busqueda',
                      searchUrl,
                    })
                    searchMiss++
                  }
                }
              )
            )
          }

          await Promise.all(searchTasks)
          diag.searchHit = searchHit
          diag.searchMiss = searchMiss
        }
      }
    }

    // Productos que no encontraron URL por ninguna estrategia
    for (const pid of productIds) {
      if (!urlByProduct.has(pid)) {
        addFail({
          productId: pid,
          productName: nameByProduct.get(pid),
          stage: 'no_url_found',
          detail: 'ninguna estrategia encontro image_url',
        })
      }
    }

    diag.totalFoundUrls = urlByProduct.size
    diag.searchUrlSamples = searchUrlSamples
    diag.step = 'downloading'

    // ─── Descarga en paralelo ─────────────────────────────────────────────────
    let success = 0
    let failed = 0
    const downloadTasks: Array<Promise<void>> = []

    for (const pid of productIds) {
      const url = urlByProduct.get(pid)
      if (!url) {
        failed++
        continue
      }
      downloadTasks.push(
        (async () => {
          // Intento 1: URL guardada
          let res = await downloadAndUploadProductImage(admin, pid, url)
          if (res.ok) {
            success++
            return
          }
          // Intento 2: recapturar desde product_url si la URL guardada expiro
          const productUrl = productUrlById.get(pid)
          if (productUrl) {
            const freshUrl = await recaptureProductImageUrl(productUrl)
            if (freshUrl && freshUrl !== url) {
              res = await downloadAndUploadProductImage(admin, pid, freshUrl)
              if (res.ok) {
                success++
                return
              }
            }
          }
          // Fallo definitivo
          failed++
          addFail({
            productId: pid,
            productName: nameByProduct.get(pid),
            stage: 'download',
            detail: 'download fallo y recaptura no encontro imagen fresca',
            searchUrl: url,
          })
        })()
      )
    }

    await Promise.all(downloadTasks)

    diag.step = 'done'
    diag.success = success
    diag.failed = failed
    diag.failSamples = failSamples

    // Recalcular remaining
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
    diag.failSamples = failSamples
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic'), __diagnostic: diag }
  }
}
