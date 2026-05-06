/**
 * Une salida nueva (varios productos en una foto) con formato antigua (un solo objeto JSON).
 */

export function normalizeMultiProductVisionJson(parsed: unknown): unknown[] {
  if (parsed === null || parsed === undefined) return []
  if (Array.isArray(parsed)) {
    return parsed.filter((p) => p != null && typeof p === 'object')
  }
  if (typeof parsed !== 'object') return []

  const o = parsed as Record<string, unknown>
  const raw = o.products
  if (Array.isArray(raw)) {
    return raw.filter((p) => p != null && typeof p === 'object')
  }

  /** Formato anterior: todas las propiedades en la raíz (un solo producto) */
  if (
    typeof o.name === 'string' ||
    o.brand !== undefined ||
    o.productType !== undefined ||
    o.gtin !== undefined
  ) {
    return [o]
  }
  return []
}
