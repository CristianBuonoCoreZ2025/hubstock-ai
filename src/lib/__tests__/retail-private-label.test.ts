import { describe, it, expect } from 'vitest'
import {
  isPrivateLabelBrandText,
  foldPrivateLabelBrand,
} from '@/lib/retail-private-label'

/* ------------------------------------------------------------------ */
/*  isPrivateLabelBrandText                                           */
/* ------------------------------------------------------------------ */
describe('isPrivateLabelBrandText', () => {
  it('returns false for null/undefined/empty', () => {
    expect(isPrivateLabelBrandText(null)).toBe(false)
    expect(isPrivateLabelBrandText(undefined)).toBe(false)
    expect(isPrivateLabelBrandText('')).toBe(false)
    expect(isPrivateLabelBrandText('   ')).toBe(false)
  })

  it('detects "líder"', () => {
    expect(isPrivateLabelBrandText('líder')).toBe(true)
    expect(isPrivateLabelBrandText('Líder')).toBe(true)
  })

  it('detects "lider" without accent', () => {
    expect(isPrivateLabelBrandText('lider')).toBe(true)
  })

  it('detects "jumbo"', () => {
    expect(isPrivateLabelBrandText('jumbo')).toBe(true)
    expect(isPrivateLabelBrandText('Jumbo')).toBe(true)
  })

  it('detects "marca líder" / "marca jumbo"', () => {
    expect(isPrivateLabelBrandText('marca líder')).toBe(true)
    expect(isPrivateLabelBrandText('marca jumbo')).toBe(true)
  })

  it('detects central mayorista', () => {
    expect(isPrivateLabelBrandText('central mayorista')).toBe(true)
    expect(isPrivateLabelBrandText('Central Mayorista')).toBe(true)
  })

  it('returns false for non-private brands', () => {
    expect(isPrivateLabelBrandText("Hellmann's")).toBe(false)
    expect(isPrivateLabelBrandText('Colgate')).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/*  foldPrivateLabelBrand                                             */
/* ------------------------------------------------------------------ */
describe('foldPrivateLabelBrand', () => {
  it('returns original brand when not a private label', () => {
    const result = foldPrivateLabelBrand("Hellmann's", 'Mayonesa', 'Condimentos')
    expect(result).toEqual({ brand: "Hellmann's", usedGeneric: false })
  })

  it('returns original brand when private label but not fresh/bakery context', () => {
    const result = foldPrivateLabelBrand('líder', 'Detergente', 'Limpieza')
    expect(result).toEqual({ brand: 'líder', usedGeneric: false })
  })

  it('folds to generic brand for fresh produce with private label', () => {
    const result = foldPrivateLabelBrand('líder', 'Tomate cherry', 'Verduras frescas')
    expect(result).toEqual({ brand: 'Marca genérica', usedGeneric: true })
  })

  it('folds to generic brand for bakery with private label', () => {
    const result = foldPrivateLabelBrand('jumbo', 'Marraqueta', 'Panadería')
    expect(result).toEqual({ brand: 'Marca genérica', usedGeneric: true })
  })

  it('returns null brand when rawBrand is null and not private label', () => {
    const result = foldPrivateLabelBrand(null, 'Algo', 'Algo')
    expect(result).toEqual({ brand: null, usedGeneric: false })
  })
})
