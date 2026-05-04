/** Tipos MIME aceptados por las rutas `/api/ai/*` (validación Zod). */
const API_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

/**
 * Devuelve un mime compatible con la API a partir del archivo del navegador.
 */
export function resolveApiImageMimeType(file: File): string {
  // Algunos SO/navegadores envían image/jpg; el API solo acepta image/jpeg (Zod).
  if (file.type === 'image/jpg') {
    return 'image/jpeg'
  }
  if (file.type && API_IMAGE_MIMES.has(file.type)) {
    return file.type
  }
  const n = file.name.toLowerCase()
  if (n.endsWith('.png')) return 'image/png'
  if (n.endsWith('.webp')) return 'image/webp'
  if (n.endsWith('.heic')) return 'image/heic'
  if (n.endsWith('.heif')) return 'image/heif'
  return 'image/jpeg'
}

/**
 * Codifica el archivo en base64 sin armar un string binario gigante en memoria
 * (evita errores o bloqueos con fotos grandes desde el móvil).
 */
export async function fileToBase64(file: File): Promise<string> {
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
    reader.onerror = () => {
      reject(reader.error ?? new Error('file_read_error'))
    }
    reader.readAsDataURL(file)
  })
}
