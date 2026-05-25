/**
 * Helper compartido para descargar una imagen de URL pública y subirla
 * al Storage de Supabase como thumbnail de un producto del catálogo.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getPublicUploadBucket } from '@/lib/storage-bucket'
import logger from '@/lib/logger'

function isUniqueViolation(err: { code?: string }): boolean {
  return err?.code === '23505'
}

export type DownloadImageResult =
  | { ok: true; publicUrl: string }
  | { ok: false }

/** Intenta descargar una imagen y subirla al storage de Supabase. */
export async function downloadAndUploadProductImage(
  admin: SupabaseClient,
  catalogProductId: string,
  sourceUrl: string,
): Promise<DownloadImageResult> {
  try {
    logger.debug({ catalogProductId, sourceUrl }, '[download-image] descargando imagen')
    const resp = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'HubStockAI/1.0' },
    })
    if (!resp.ok) {
      logger.warn({ catalogProductId, sourceUrl, status: resp.status }, '[download-image] imagen no disponible')
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
      logger.error({ catalogProductId, path, err: upErr.message }, '[download-image] error subiendo imagen al storage')
      return { ok: false }
    }

    const { data: urlData } = admin.storage.from(bucket).getPublicUrl(path)
    const publicUrl = urlData?.publicUrl
    if (!publicUrl) return { ok: false }

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
    logger.error({ catalogProductId, err: e instanceof Error ? e.message : String(e) }, '[download-image] excepción en descarga/subida')
    return { ok: false }
  }
}
