import { describe, it, expect } from 'vitest'
import { deriveSectionCategoryFromListingUrl } from '@/lib/retail-listing-url-path'

describe('deriveSectionCategoryFromListingUrl', () => {
  const config = {
    listingPathSegmentIndices: { section: 1, category: 2 },
  }

  it('extracts section and category from Lider-style URL', () => {
    const url = 'https://super.lider.cl/browse/marcas-propias/limpieza-hogar/69507955_15116335'
    const result = deriveSectionCategoryFromListingUrl(url, config)
    expect(result).toEqual({
      sections: 'marcas-propias',
      categories: 'limpieza-hogar',
    })
  })

  it('returns nulls when config is null', () => {
    expect(deriveSectionCategoryFromListingUrl('https://example.com/a/b/c', null)).toEqual({
      sections: null,
      categories: null,
    })
  })

  it('returns nulls when config has no indices', () => {
    expect(deriveSectionCategoryFromListingUrl('https://example.com/a/b/c', {})).toEqual({
      sections: null,
      categories: null,
    })
  })

  it('returns nulls for indices with non-integer values', () => {
    const bad = { listingPathSegmentIndices: { section: 1.5, category: 2 } }
    expect(deriveSectionCategoryFromListingUrl('https://example.com/a/b/c', bad)).toEqual({
      sections: null,
      categories: null,
    })
  })

  it('returns nulls for negative indices', () => {
    const bad = { listingPathSegmentIndices: { section: -1, category: 2 } }
    expect(deriveSectionCategoryFromListingUrl('https://example.com/a/b/c', bad)).toEqual({
      sections: null,
      categories: null,
    })
  })

  it('returns null for out-of-range indices', () => {
    const result = deriveSectionCategoryFromListingUrl(
      'https://example.com/only-one',
      { listingPathSegmentIndices: { section: 5, category: 6 } }
    )
    expect(result).toEqual({ sections: null, categories: null })
  })

  it('handles invalid URLs gracefully', () => {
    const result = deriveSectionCategoryFromListingUrl('not-a-url', config)
    expect(result).toEqual({ sections: null, categories: null })
  })

  it('trims whitespace from URL', () => {
    const url = '  https://super.lider.cl/browse/sec/cat  '
    const result = deriveSectionCategoryFromListingUrl(url, config)
    expect(result).toEqual({ sections: 'sec', categories: 'cat' })
  })
})
