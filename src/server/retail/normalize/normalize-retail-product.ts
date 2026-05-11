import { foldPrivateLabelBrand } from '@/lib/retail-private-label'
import { normalizeSearchText } from '@/lib/search'
import type { NormalizedRetailProduct, RetailCapturedProductInput } from '@/server/retail/capture/retail-types'

/**
 * Extrae una firma de presentación (ml / L / g / kg) desde título o texto de precio por unidad.
 * Sirve para no enlazar 1 L con 500 ml.
 */
export function extractFormatSignature(text: string | null | undefined): string | null {
  if (!text?.trim()) return null
  const t = text.toLowerCase().replace(/\s+/g, ' ')
  const patterns: RegExp[] = [
    /\b(\d+[.,]?\d*)\s*(l|lt|litro|litros)\b/i,
    /\b(\d+[.,]?\d*)\s*(ml|mililitro|mililitros)\b/i,
    /\b(\d+[.,]?\d*)\s*(kg|kilogramo|kilogramos)\b/i,
    /\b(\d+[.,]?\d*)\s*(g|gr|gramo|gramos)\b/i,
    /\b(\d+)\s*x\s*(\d+[.,]?\d*)\s*(ml|g|l|kg)\b/i,
  ]
  for (const re of patterns) {
    const m = t.match(re)
    if (m) return m[0].replace(/,/g, '.').replace(/\s+/g, ' ').trim()
  }
  return null
}

/** Convierte firma a volumen aproximado en ml (solo para comparar mismas familias). */
export function volumeMlFromSignature(sig: string | null): number | null {
  if (!sig) return null
  const s = sig.toLowerCase().replace(/,/g, '.')
  const pack = s.match(/(\d+)\s*x\s*([\d.]+)\s*(ml|l|g|kg)/)
  if (pack) {
    const n = Number(pack[1])
    const unit = Number(pack[2])
    const u = pack[3]
    if (!Number.isFinite(n) || !Number.isFinite(unit)) return null
    if (u === 'ml') return n * unit
    if (u === 'l') return n * unit * 1000
    if (u === 'g') return null
    if (u === 'kg') return null
  }
  const ml = s.match(/([\d.]+)\s*(ml|mililitro|mililitros)/)
  if (ml) {
    const v = Number(ml[1])
    return Number.isFinite(v) ? v : null
  }
  const l = s.match(/([\d.]+)\s*(l|lt|litro|litros)\b/)
  if (l) {
    const v = Number(l[1])
    return Number.isFinite(v) ? v * 1000 : null
  }
  return null
}

export function normalizeRetailCapturedInput(
  input: RetailCapturedProductInput,
): NormalizedRetailProduct & { folded_brand: string | null } {
  const folded = foldPrivateLabelBrand(
    input.brand,
    input.title,
    input.category_hint ?? undefined,
  )
  const titleForNorm = input.title.trim()
  const brandStr = folded.brand?.trim() || input.brand?.trim() || ''
  const combinedHint = [input.title, input.unit_price, input.description_hint].filter(Boolean).join(' ')
  const sig = extractFormatSignature(combinedHint)
  return {
    normalized_title: normalizeSearchText(titleForNorm),
    normalized_brand: normalizeSearchText(brandStr),
    format_signature: sig,
    volume_ml: volumeMlFromSignature(sig),
    folded_brand: folded.brand ?? (input.brand?.trim() || null),
  }
}
