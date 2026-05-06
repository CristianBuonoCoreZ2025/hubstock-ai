'use client'

/**
 * Genera una miniatura JPEG local para vista previa (no usar el archivo original en <img>).
 * Solo ejecutar en el navegador.
 */
export type ThumbnailResult = {
  url: string
  thumbWidth: number
  thumbHeight: number
  thumbBytesApprox: number
}

export async function createThumbnailPreviewUrl(
  file: File,
  maxEdge = 280
): Promise<ThumbnailResult> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await loadImage(objectUrl)
    URL.revokeObjectURL(objectUrl)

    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
    const thumbWidth = Math.max(1, Math.round(img.naturalWidth * scale))
    const thumbHeight = Math.max(1, Math.round(img.naturalHeight * scale))

    const canvas = document.createElement('canvas')
    canvas.width = thumbWidth
    canvas.height = thumbHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('No canvas context')
    }
    ctx.drawImage(img, 0, 0, thumbWidth, thumbHeight)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.82)
    })
    if (!blob) {
      throw new Error('toBlob failed')
    }

    const url = URL.createObjectURL(blob)
    return {
      url,
      thumbWidth,
      thumbHeight,
      thumbBytesApprox: blob.size,
    }
  } catch (e) {
    URL.revokeObjectURL(objectUrl)
    throw e
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('No se pudo decodificar la imagen para miniatura'))
    img.src = src
  })
}
