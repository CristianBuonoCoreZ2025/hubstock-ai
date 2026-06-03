import { describe, it, expect } from 'vitest'
import { normalizeCatalogAlias } from '@/lib/catalog-alias'

describe('normalizeCatalogAlias', () => {
  it('trims and lowercases', () => {
    expect(normalizeCatalogAlias('  Mayonesa  ')).toBe('mayonesa')
  })

  it('collapses multiple spaces', () => {
    expect(normalizeCatalogAlias('coca   cola')).toBe('coca cola')
  })

  it('preserves accents', () => {
    expect(normalizeCatalogAlias('Jalapeño')).toBe('jalapeño')
  })

  it('handles single word', () => {
    expect(normalizeCatalogAlias('KETCHUP')).toBe('ketchup')
  })
})
