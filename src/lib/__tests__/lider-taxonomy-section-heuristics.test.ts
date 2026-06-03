import { describe, it, expect } from 'vitest'
import {
  normalizeLiderSectionKeyStrong,
  normalizeLiderCategoryKeyStrong,
  liderTaxonomyDisplayContainsNumericCharacter,
  shouldDiscardLiderSectionLabel,
  shouldDiscardLiderCategoryLabel,
  isProtectedCommercialLiderSection,
  isLiderRetailContentHubStrongKey,
  normalizeLiderSectionDisplay,
  LIDER_CATALOG_SECTION_STRONG_KEY,
} from '@/lib/lider-taxonomy-section-heuristics'

/* ------------------------------------------------------------------ */
/*  normalizeLiderSectionKeyStrong                                    */
/* ------------------------------------------------------------------ */
describe('normalizeLiderSectionKeyStrong', () => {
  it('returns empty for null/undefined/empty', () => {
    expect(normalizeLiderSectionKeyStrong(null)).toBe('')
    expect(normalizeLiderSectionKeyStrong(undefined)).toBe('')
    expect(normalizeLiderSectionKeyStrong('')).toBe('')
  })

  it('lowercases, strips accents, collapses spaces', () => {
    expect(normalizeLiderSectionKeyStrong('  Bebidas y Licores  ')).toBe('bebidas y licores')
  })

  it('replaces commas with spaces', () => {
    expect(normalizeLiderSectionKeyStrong('Frutas,Verduras')).toBe('frutas verduras')
  })

  it('strips diacritics including ñ', () => {
    expect(normalizeLiderSectionKeyStrong('Panadería')).toBe('panaderia')
  })
})

/* ------------------------------------------------------------------ */
/*  normalizeLiderCategoryKeyStrong                                   */
/* ------------------------------------------------------------------ */
describe('normalizeLiderCategoryKeyStrong', () => {
  it('is an alias for normalizeLiderSectionKeyStrong', () => {
    expect(normalizeLiderCategoryKeyStrong('Lácteos')).toBe(
      normalizeLiderSectionKeyStrong('Lácteos')
    )
  })
})

/* ------------------------------------------------------------------ */
/*  liderTaxonomyDisplayContainsNumericCharacter                      */
/* ------------------------------------------------------------------ */
describe('liderTaxonomyDisplayContainsNumericCharacter', () => {
  it('returns false for null/undefined/empty', () => {
    expect(liderTaxonomyDisplayContainsNumericCharacter(null)).toBe(false)
    expect(liderTaxonomyDisplayContainsNumericCharacter('')).toBe(false)
  })

  it('returns true when text contains digits', () => {
    expect(liderTaxonomyDisplayContainsNumericCharacter('3x')).toBe(true)
    expect(liderTaxonomyDisplayContainsNumericCharacter('abc123')).toBe(true)
  })

  it('returns false for pure text', () => {
    expect(liderTaxonomyDisplayContainsNumericCharacter('Bebidas')).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/*  shouldDiscardLiderSectionLabel                                    */
/* ------------------------------------------------------------------ */
describe('shouldDiscardLiderSectionLabel', () => {
  it('discards short labels (< 2 chars)', () => {
    expect(shouldDiscardLiderSectionLabel('a')).toBe(true)
    expect(shouldDiscardLiderSectionLabel('')).toBe(true)
  })

  it('discards labels with digits', () => {
    expect(shouldDiscardLiderSectionLabel('3x')).toBe(true)
  })

  it('discards pure numeric strings', () => {
    expect(shouldDiscardLiderSectionLabel('12345')).toBe(true)
  })

  it('discards UUID-like strings', () => {
    expect(shouldDiscardLiderSectionLabel('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true)
  })

  it('discards promo/tech keywords', () => {
    expect(shouldDiscardLiderSectionLabel('Cyber Monday')).toBe(true)
    expect(shouldDiscardLiderSectionLabel('Black Friday')).toBe(true)
    expect(shouldDiscardLiderSectionLabel('oferta especial')).toBe(true)
    expect(shouldDiscardLiderSectionLabel('checkout')).toBe(true)
    expect(shouldDiscardLiderSectionLabel('sitemap')).toBe(true)
  })

  it('keeps valid section labels', () => {
    expect(shouldDiscardLiderSectionLabel('Bebidas y Licores')).toBe(false)
    expect(shouldDiscardLiderSectionLabel('Lácteos')).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/*  shouldDiscardLiderCategoryLabel                                   */
/* ------------------------------------------------------------------ */
describe('shouldDiscardLiderCategoryLabel', () => {
  it('discards what sections discard', () => {
    expect(shouldDiscardLiderCategoryLabel('a')).toBe(true)
    expect(shouldDiscardLiderCategoryLabel('Cyber')).toBe(true)
  })

  it('discards numeric tail patterns (underscore-separated IDs)', () => {
    expect(shouldDiscardLiderCategoryLabel('60338008_85836428_40470033')).toBe(true)
  })

  it('discards labels with too many digits relative to letters', () => {
    expect(shouldDiscardLiderCategoryLabel('ab1234')).toBe(true)
  })

  it('keeps valid category labels', () => {
    expect(shouldDiscardLiderCategoryLabel('Limpieza Hogar')).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/*  isProtectedCommercialLiderSection                                 */
/* ------------------------------------------------------------------ */
describe('isProtectedCommercialLiderSection', () => {
  it('protects La Boti', () => {
    expect(isProtectedCommercialLiderSection('La Boti')).toBe(true)
  })

  it('does not protect random names', () => {
    expect(isProtectedCommercialLiderSection('Bebidas')).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/*  isLiderRetailContentHubStrongKey                                  */
/* ------------------------------------------------------------------ */
describe('isLiderRetailContentHubStrongKey', () => {
  it('recognizes known hubs', () => {
    expect(isLiderRetailContentHubStrongKey('La Boti')).toBe(true)
    expect(isLiderRetailContentHubStrongKey('Marcas Propias')).toBe(true)
    expect(isLiderRetailContentHubStrongKey('Soy Pyme')).toBe(true)
  })

  it('rejects unknown labels', () => {
    expect(isLiderRetailContentHubStrongKey('Alimentos')).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/*  normalizeLiderSectionDisplay                                      */
/* ------------------------------------------------------------------ */
describe('normalizeLiderSectionDisplay', () => {
  it('returns null for empty input', () => {
    expect(normalizeLiderSectionDisplay('')).toBeNull()
    expect(normalizeLiderSectionDisplay('   ')).toBeNull()
  })

  it('returns null for discardable labels', () => {
    expect(normalizeLiderSectionDisplay('12345')).toBeNull()
    expect(normalizeLiderSectionDisplay('checkout')).toBeNull()
  })

  it('returns display + normalized for valid labels', () => {
    const result = normalizeLiderSectionDisplay('Bebidas y Licores')
    expect(result).toEqual({
      display: 'Bebidas y Licores',
      normalized: 'bebidas y licores',
    })
  })

  it('preserves La Boti even though it has short words', () => {
    const result = normalizeLiderSectionDisplay('La Boti')
    expect(result).not.toBeNull()
    expect(result!.normalized).toContain('boti')
  })
})

/* ------------------------------------------------------------------ */
/*  LIDER_CATALOG_SECTION_STRONG_KEY                                  */
/* ------------------------------------------------------------------ */
describe('LIDER_CATALOG_SECTION_STRONG_KEY', () => {
  it('is normalized "catalogo lider"', () => {
    expect(LIDER_CATALOG_SECTION_STRONG_KEY).toBe('catalogo lider')
  })
})
