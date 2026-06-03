import { DIACRITIC_MARK } from '@/lib/search'

const NON_LETTER_NUM_SPACE = /[^\p{L}\p{N}\s]/gu

/**
 * Normalización fuerte para comparar sección Lider ↔ public.sections:
 * minúsculas, sin acentos, sin comas ni signos, espacios colapsados, trim.
 * ñ se trata como n (NFD + quitar marcas combinatorias).
 */
export function normalizeLiderSectionKeyStrong(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .trim()
    .toLowerCase()
    .replace(/,/g, ' ')
    .normalize('NFD')
    .replace(DIACRITIC_MARK, '')
    .replace(/\u00f1/g, 'n')
    .replace(NON_LETTER_NUM_SPACE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const PROMO_OR_TECH = new RegExp(
  [
    'cyber',
    'black\\s*friday',
    'hot\\s*sale',
    'oferta',
    'descuento',
    'promo',
    'banner',
    'carrito',
    'checkout',
    'login',
    'registro',
    'mi\\s*cuenta',
    'sitemap',
    'api',
    'politica',
    'privacidad',
    'terminos',
    'ayuda',
    'contacto',
    'empleo',
    'trabaja',
  ].join('|'),
  'i',
)

/**
 * Etiqueta Lider (sección o categoría) con números: facetas, "3x", SKUs en el nombre, etc. No se muestra ni se homologa.
 */
export function liderTaxonomyDisplayContainsNumericCharacter(raw: string | null | undefined): boolean {
  if (!raw?.trim()) return false
  return /\p{N}/u.test(raw)
}

/** Slug o etiqueta que no debe contarse como sección de catálogo. */
export function shouldDiscardLiderSectionLabel(raw: string): boolean {
  const t = raw.trim()
  if (t.length < 2) return true
  if (liderTaxonomyDisplayContainsNumericCharacter(t)) return true
  if (/^\d+$/.test(t)) return true
  if (/^[0-9a-f-]{32,36}$/i.test(t)) return true
  if (/^\d[\d\s-]{5,}$/.test(t)) return true
  if (PROMO_OR_TECH.test(t)) return true
  return false
}

/**
 * Etiqueta de categoría Lider (URL, breadcrumb, hint) que no debe homologarse ni mostrarse al usuario:
 * códigos numéricos, colas de colección, ruido de menú técnico, etc.
 */
export function shouldDiscardLiderCategoryLabel(raw: string): boolean {
  const t = raw.trim()
  if (t.length < 2) return true
  if (shouldDiscardLiderSectionLabel(t)) return true
  const compact = t.replace(/\s+/g, '')
  // Cola tipo 60338008_85836428_40470033 (solo dígitos y guiones bajos)
  if (/^\d[\d_]+$/.test(compact) && compact.length >= 8) return true
  // Demasiados dígitos respecto al texto (p. ej. códigos de faceta)
  const letters = (t.match(/\p{L}/gu) ?? []).length
  const digits = (t.match(/\p{N}/gu) ?? []).length
  if (digits >= 4 && digits >= letters) return true
  return false
}

/** Misma regla que secciones: alinea nombres de categoría Lider ↔ public.categories. */
export function normalizeLiderCategoryKeyStrong(input: string | null | undefined): string {
  return normalizeLiderSectionKeyStrong(input)
}

/** Marca comercial que nunca se descarta solo por ser nombre corto o comercial (p. ej. La Boti). */
export function isProtectedCommercialLiderSection(display: string): boolean {
  const n = normalizeLiderSectionKeyStrong(display)
  return n.includes('boti')
}

/**
 * Hubs de tienda bajo `/content/{slug}/{id}` (La Boti, marcas propias, campañas, etc.).
 * Si no hay sección maestra equivalente, el flujo propone crearla en el catálogo (no se ignoran).
 */
const LIDER_CONTENT_HUB_STRONG_KEYS = new Set(
  [
    'La Boti',
    'Marcas Propias',
    'Marcas Americanas',
    'Soy Pyme',
    'Campañas',
    'Campanas',
  ].map((s) => normalizeLiderSectionKeyStrong(s)),
)

export function isLiderRetailContentHubStrongKey(normalizedExternalSection: string): boolean {
  return LIDER_CONTENT_HUB_STRONG_KEYS.has(normalizeLiderSectionKeyStrong(normalizedExternalSection))
}

/**
 * Normaliza etiqueta de sección para mostrar y para clave (alineada a public.sections).
 * Devuelve null si no hay evidencia útil.
 */
export function normalizeLiderSectionDisplay(raw: string): { display: string; normalized: string } | null {
  const display = raw
    .replace(/\s+/g, ' ')
    .replace(/[|»«]/g, ' ')
    .trim()
  if (!display) return null
  if (!isProtectedCommercialLiderSection(display) && shouldDiscardLiderSectionLabel(display)) return null
  const normalized = normalizeLiderSectionKeyStrong(display)
  if (!normalized || normalized.length < 2) return null
  return { display, normalized }
}

/** Clave normalizada fuerte de la sección sintética «Catálogo Lider» (filtros de fase 1). */
export const LIDER_CATALOG_SECTION_STRONG_KEY = normalizeLiderSectionKeyStrong('Catálogo Lider')
