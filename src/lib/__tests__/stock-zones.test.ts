import { describe, it, expect } from 'vitest'
import { stockZoneLabel, STOCK_ZONE_OPTIONS } from '@/lib/stock-zones'

describe('STOCK_ZONE_OPTIONS', () => {
  it('has 6 zones', () => {
    expect(STOCK_ZONE_OPTIONS).toHaveLength(6)
  })

  it('each option has value and label', () => {
    for (const opt of STOCK_ZONE_OPTIONS) {
      expect(opt.value).toBeTruthy()
      expect(opt.label).toBeTruthy()
    }
  })
})

describe('stockZoneLabel', () => {
  it('returns label for known zones', () => {
    expect(stockZoneLabel('alacena')).toBe('Alacena')
    expect(stockZoneLabel('refrigerador')).toBe('Refrigerador')
    expect(stockZoneLabel('congelador')).toBe('Congelador')
    expect(stockZoneLabel('bano')).toBe('Baño / aseo')
    expect(stockZoneLabel('bodega')).toBe('Bodega')
    expect(stockZoneLabel('otro')).toBe('Otro')
  })

  it('returns raw value for unknown zones', () => {
    expect(stockZoneLabel('garage')).toBe('garage')
    expect(stockZoneLabel('patio')).toBe('patio')
  })
})
