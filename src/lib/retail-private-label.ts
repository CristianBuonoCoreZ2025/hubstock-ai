/**
 * Alineado a scripts/retail_private_label.py: marca propia en fresco/pan → «Marca genérica».
 */

const GENERIC_BRAND_CANONICAL = 'Marca genérica'

const PRIVATE_BRAND =
  /(^|\s)(marca\s*)?(l[ií]der|jumbo)(\.cl)?($|\s)/i
const CENTRAL_BRAND = /central\s*mayorista/i

function haystack(name: string | null | undefined, categoryHint: string | null | undefined): string {
  return `${name ?? ''} ${categoryHint ?? ''}`.toLowerCase()
}

function matchesFreshBakeryContext(
  name: string | null | undefined,
  categoryHint: string | null | undefined,
): boolean {
  const h = haystack(name, categoryHint)
  const needles = [
    'verdur',
    'frut',
    'hortaliz',
    'fresco',
    'tomate',
    'lechuga',
    'zanahoria',
    'cebolla',
    'papa',
    'palta',
    'plátano',
    'banana',
    'manzana',
    'naranja',
    'uva',
    'berenjena',
    'apio',
    'champiñ',
    'espárrag',
    'esparrag',
    'marraqueta',
    'hallulla',
    'pan ',
    'panader',
    'bolla',
    'baguette',
    'reposter',
    'masa ',
    'harina ',
    ' boller',
    'bollería',
    'ensalada',
  ]
  return needles.some((n) => h.includes(n))
}

export function isPrivateLabelBrandText(raw: string | null | undefined): boolean {
  if (!raw?.trim()) return false
  const t = raw.trim().split(/\s+/).join(' ').toLowerCase()
  if (['líder', 'lider', 'jumbo', 'marca líder', 'marca jumbo'].includes(t)) return true
  if (CENTRAL_BRAND.test(t)) return true
  if (PRIVATE_BRAND.test(t)) return true
  if (t.includes('marca') && (t.includes('líder') || t.includes('lider') || t.includes('jumbo')))
    return true
  return false
}

export function foldPrivateLabelBrand(
  rawBrand: string | null | undefined,
  productName: string | null | undefined,
  categoryHint: string | null | undefined,
): { brand: string | null; usedGeneric: boolean } {
  if (!isPrivateLabelBrandText(rawBrand ?? null)) {
    return { brand: rawBrand ?? null, usedGeneric: false }
  }
  if (!matchesFreshBakeryContext(productName, categoryHint)) {
    return { brand: rawBrand ?? null, usedGeneric: false }
  }
  return { brand: GENERIC_BRAND_CANONICAL, usedGeneric: true }
}
