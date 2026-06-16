import { describe, it, expect } from 'vitest'
import {
  normalizeSearchText,
  normalizeSearchLoose,
  searchTermsFromQuery,
  looseSearchTermsFromQuery,
  getSearchTermPairs,
  matchesSearch,
  filterBySearch,
  rankCatalogProductRelevance,
  type CatalogProductRankInput,
} from '@/lib/search'

/* ------------------------------------------------------------------ */
/*  normalizeSearchText                                               */
/* ------------------------------------------------------------------ */
describe('normalizeSearchText', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(normalizeSearchText(null)).toBe('')
    expect(normalizeSearchText(undefined)).toBe('')
    expect(normalizeSearchText('')).toBe('')
  })

  it('lowercases and trims', () => {
    expect(normalizeSearchText('  Mayonesa  ')).toBe('mayonesa')
  })

  it('strips diacritics', () => {
    expect(normalizeSearchText('Mayó')).toBe('mayo')
    expect(normalizeSearchText('jalapeño')).toBe('jalapeno')
  })

  it('removes non-letter/non-number characters', () => {
    expect(normalizeSearchText("Hellmann's")).toBe('hellmanns')
  })

  it('collapses multiple spaces', () => {
    expect(normalizeSearchText('hola   mundo')).toBe('hola mundo')
  })
})

/* ------------------------------------------------------------------ */
/*  normalizeSearchLoose                                              */
/* ------------------------------------------------------------------ */
describe('normalizeSearchLoose', () => {
  it('returns empty for null/undefined/empty', () => {
    expect(normalizeSearchLoose(null)).toBe('')
    expect(normalizeSearchLoose(undefined)).toBe('')
    expect(normalizeSearchLoose('')).toBe('')
  })

  it('collapses repeated letters per word', () => {
    expect(normalizeSearchLoose('hellmanns')).toBe('helmans')
    expect(normalizeSearchLoose('hellmans')).toBe('helmans')
    expect(normalizeSearchLoose('helmans')).toBe('helmans')
  })

  it('handles multiple words', () => {
    expect(normalizeSearchLoose('aabbcc ddee')).toBe('abc de')
  })
})

/* ------------------------------------------------------------------ */
/*  searchTermsFromQuery                                              */
/* ------------------------------------------------------------------ */
describe('searchTermsFromQuery', () => {
  it('returns [] for null/undefined/empty', () => {
    expect(searchTermsFromQuery(null)).toEqual([])
    expect(searchTermsFromQuery('')).toEqual([])
  })

  it('splits normalized text into words', () => {
    expect(searchTermsFromQuery('  Hell  Mayo  ')).toEqual(['hell', 'mayo'])
  })
})

/* ------------------------------------------------------------------ */
/*  looseSearchTermsFromQuery                                         */
/* ------------------------------------------------------------------ */
describe('looseSearchTermsFromQuery', () => {
  it('returns loose terms', () => {
    expect(looseSearchTermsFromQuery('hellmanns mayo')).toEqual(['helmans', 'mayo'])
  })
})

/* ------------------------------------------------------------------ */
/*  getSearchTermPairs                                                */
/* ------------------------------------------------------------------ */
describe('getSearchTermPairs', () => {
  it('returns aligned strict/loose pairs', () => {
    const pairs = getSearchTermPairs('hellmanns')
    expect(pairs.strict).toEqual(['hellmanns'])
    expect(pairs.loose).toEqual(['helmans'])
  })

  it('returns empty arrays for empty query', () => {
    const pairs = getSearchTermPairs('')
    expect(pairs.strict).toEqual([])
    expect(pairs.loose).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/*  matchesSearch                                                     */
/* ------------------------------------------------------------------ */
describe('matchesSearch', () => {
  it('returns true when query is empty', () => {
    expect(matchesSearch('anything', '')).toBe(true)
    expect(matchesSearch('anything', null)).toBe(true)
  })

  it('matches prefix substring', () => {
    expect(matchesSearch('Mayonesa', 'mayo')).toBe(true)
  })

  it('matches with accent in query', () => {
    expect(matchesSearch('Mayonesa', 'mayó')).toBe(true)
  })

  it('matches loose: hellmanns against Hellmann\'s', () => {
    expect(matchesSearch("Hellmann's", 'hellmanns')).toBe(true)
  })

  it('matches loose: hellmans against Hellmann\'s', () => {
    expect(matchesSearch("Hellmann's", 'hellmans')).toBe(true)
  })

  it('matches loose: helmans against Hellmann\'s', () => {
    expect(matchesSearch("Hellmann's", 'helmans')).toBe(true)
  })

  it('multi-word: hell mayo matches Mayonesa Hellmann\'s', () => {
    expect(matchesSearch("Mayonesa Hellmann's", 'hell mayo')).toBe(true)
  })

  it('returns false when no terms match', () => {
    expect(matchesSearch('Ketchup', 'mayo')).toBe(false)
  })

  it('works with array of texts', () => {
    expect(matchesSearch(['Coca', 'Cola'], 'cola')).toBe(true)
  })

  it('returns true for null/undefined texts when query is empty', () => {
    expect(matchesSearch(null, '')).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/*  filterBySearch                                                    */
/* ------------------------------------------------------------------ */
describe('filterBySearch', () => {
  const items = [
    { id: 1, name: 'Mayonesa' },
    { id: 2, name: 'Ketchup' },
    { id: 3, name: 'Mostaza' },
  ]

  it('returns all items when query is empty', () => {
    expect(filterBySearch(items, '', (i) => i.name)).toHaveLength(3)
  })

  it('filters matching items', () => {
    const result = filterBySearch(items, 'mayo', (i) => i.name)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(1)
  })

  it('returns empty when nothing matches', () => {
    expect(filterBySearch(items, 'azúcar', (i) => i.name)).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ */
/*  rankCatalogProductRelevance                                       */
/* ------------------------------------------------------------------ */
describe('rankCatalogProductRelevance', () => {
  const base: CatalogProductRankInput = {
    productName: 'Mayonesa',
    brandCanonical: "Hellmann's",
    brandText: "Hellmann's",
    categoryName: 'Condimentos',
    sectionName: 'Alimentos',
    presentation: '500g',
    aliasTexts: ['mayo'],
  }

  it('returns 0 for empty query', () => {
    expect(rankCatalogProductRelevance('', base)).toBe(0)
  })

  it('returns 0 for exact name match', () => {
    expect(rankCatalogProductRelevance('mayonesa', base)).toBe(0)
  })

  it('returns 2 for prefix match', () => {
    expect(rankCatalogProductRelevance('mayo', base)).toBe(2)
  })

  it('returns 40 for brand match', () => {
    expect(rankCatalogProductRelevance('hellmanns', base)).toBe(40)
  })

  it('returns 55 for category match', () => {
    expect(rankCatalogProductRelevance('condimentos', base)).toBe(55)
  })

  it('returns 70 for section match', () => {
    expect(rankCatalogProductRelevance('alimentos', base)).toBe(70)
  })

  it('returns 200 when nothing matches', () => {
    expect(rankCatalogProductRelevance('xyz', base)).toBe(200)
  })
})
