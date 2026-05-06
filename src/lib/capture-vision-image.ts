'use client'

/**
 * Prepara imagen para rutas `/api/ai/*` (captura, chequeo de stock, boleta por foto):
 * reduce tamaño antes del POST para acelerar red e inferencia.
 */

import { fileToBase64, resolveApiImageMimeType } from '@/lib/ai-mime'

export const VISION_ANALYSIS_MAX_EDGE = 1680

const JPEG_QUALITY = 0.84

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('decode_failed'))
    img.src = src
  })
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('file_read_invalid_result'))
        return
      }
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('file_read_error'))
    reader.readAsDataURL(blob)
  })
}

export type VisionImagePayload = {
  imageBase64: string
  mimeType: string
  /** true si se envió el archivo tal cual (p. ej. HEIC o canvas no disponible). */
  usedOriginalFile: boolean
}

/**
 * Escala a JPEG por canvas cuando el navegador puede decodificar la imagen.
 * HEIC u otros fallos → base64 del archivo original.
 */
export async function buildVisionAnalysisImagePayload(
  file: File
): Promise<VisionImagePayload> {
  const originalMime = resolveApiImageMimeType(file)

  if (originalMime === 'image/heic' || originalMime === 'image/heif') {
    const imageBase64 = await fileToBase64(file)
    return {
      imageBase64,
      mimeType: originalMime,
      usedOriginalFile: true,
    }
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await loadImage(objectUrl)
    const maxEdge = VISION_ANALYSIS_MAX_EDGE
    const scale = Math.min(
      1,
      maxEdge / Math.max(img.naturalWidth, img.naturalHeight)
    )
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('no_canvas')
    }
    ctx.drawImage(img, 0, 0, w, h)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
    })
    if (!blob) {
      throw new Error('to_blob_failed')
    }

    const imageBase64 = await blobToBase64(blob)
    return {
      imageBase64,
      mimeType: 'image/jpeg',
      usedOriginalFile: false,
    }
  } catch {
    const imageBase64 = await fileToBase64(file)
    return {
      imageBase64,
      mimeType: originalMime,
      usedOriginalFile: true,
    }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
