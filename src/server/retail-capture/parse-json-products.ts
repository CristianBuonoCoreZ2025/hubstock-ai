/**
 * Extrae lista de productos de respuestas VTEX (search, Intelligent Search, pegado desde DevTools).
 * Devuelve null si el JSON no coincide con formas conocidas (no es necesariamente HTML).
 */
export function extractVtexProductArrayFromResponse(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed
  if (parsed !== null && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>
    if (Array.isArray(o.products)) return o.products
    if (Array.isArray(o.records)) return o.records
    if (Array.isArray(o.data)) return o.data
    if (Array.isArray(o.result)) return o.result
    if (Array.isArray(o.items)) return o.items

    const data = o.data
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
      const d = data as Record<string, unknown>
      if (Array.isArray(d.products)) return d.products
      if (Array.isArray(d.records)) return d.records
      if (Array.isArray(d.items)) return d.items
    }

    const response = o.response
    if (response !== null && typeof response === 'object' && !Array.isArray(response)) {
      const r = response as Record<string, unknown>
      if (Array.isArray(r.products)) return r.products
      if (Array.isArray(r.records)) return r.records
    }
  }
  return null
}

/**
 * Igual que extractVtexProductArrayFromResponse pero nunca null (importación desde UI).
 */
export function extractProductArrayFromJson(raw: unknown): unknown[] {
  return extractVtexProductArrayFromResponse(raw) ?? []
}
