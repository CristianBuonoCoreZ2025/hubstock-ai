import { describe, it, expect } from 'vitest'
import { navLinkIsActive } from '@/lib/navigation'

describe('navLinkIsActive', () => {
  it('matches simple path', () => {
    expect(navLinkIsActive('/dashboard', '', '/dashboard')).toBe(true)
  })

  it('does not match different path', () => {
    expect(navLinkIsActive('/settings', '', '/dashboard')).toBe(false)
  })

  it('matches hash link when hash is present', () => {
    expect(
      navLinkIsActive('/stock-checks', '#stock-check-nuevo', '/stock-checks#stock-check-nuevo')
    ).toBe(true)
  })

  it('does not match hash link with wrong hash', () => {
    expect(
      navLinkIsActive('/stock-checks', '#other', '/stock-checks#stock-check-nuevo')
    ).toBe(false)
  })

  it('matches query param link', () => {
    expect(
      navLinkIsActive('/catalog', '', '/catalog?tab=marcas', 'tab=marcas')
    ).toBe(true)
  })

  it('does not match wrong query param', () => {
    expect(
      navLinkIsActive('/catalog', '', '/catalog?tab=marcas', 'tab=categorias')
    ).toBe(false)
  })

  it('treats /catalog with no tab as ?tab=productos', () => {
    expect(
      navLinkIsActive('/catalog', '', '/catalog?tab=productos', '')
    ).toBe(true)
  })

  it('matches /catalog?tab=productos with explicit tab=productos', () => {
    expect(
      navLinkIsActive('/catalog', '', '/catalog?tab=productos', 'tab=productos')
    ).toBe(true)
  })
})
