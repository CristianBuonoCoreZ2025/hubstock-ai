import { describe, it, expect } from 'vitest'
import { movementTypeLabel } from '@/lib/domain'

describe('movementTypeLabel', () => {
  it('returns label for known types', () => {
    expect(movementTypeLabel('consumption')).toBe('Consumo')
    expect(movementTypeLabel('purchase')).toBe('Compra / ingreso')
    expect(movementTypeLabel('adjustment')).toBe('Ajuste manual')
    expect(movementTypeLabel('import')).toBe('Alta / importación inicial')
    expect(movementTypeLabel('inventory_count')).toBe('Conteo de inventario')
  })

  it('returns raw value for unknown types', () => {
    expect(movementTypeLabel('transfer')).toBe('transfer')
  })

  it('returns dash for null/undefined/empty', () => {
    expect(movementTypeLabel(null)).toBe('—')
    expect(movementTypeLabel(undefined)).toBe('—')
    expect(movementTypeLabel('')).toBe('—')
  })
})
