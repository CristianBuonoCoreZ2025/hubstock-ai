/**
 * Acepta respuestas VTEX search (array raíz) u objetos con lista embebida.
 */
export function extractProductArrayFromJson(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw !== null && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    if (Array.isArray(o.products)) return o.products
    if (Array.isArray(o.data)) return o.data
    if (Array.isArray(o.result)) return o.result
  }
  return []
}
