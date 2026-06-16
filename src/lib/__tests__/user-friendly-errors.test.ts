import { describe, it, expect } from 'vitest'
import {
  isUniqueViolation,
  isRequiredFieldError,
  isForeignKeyError,
  isCheckConstraintError,
  isPermissionError,
  isPostgrestUnknownColumnError,
  getUserFriendlyErrorMessage,
} from '@/lib/user-friendly-errors'

/* ------------------------------------------------------------------ */
/*  Error classifiers                                                 */
/* ------------------------------------------------------------------ */
describe('isUniqueViolation', () => {
  it('returns true for code 23505', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true)
  })
  it('returns false for other codes', () => {
    expect(isUniqueViolation({ code: '23502' })).toBe(false)
  })
  it('returns false for null/undefined', () => {
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation(undefined)).toBe(false)
  })
})

describe('isRequiredFieldError', () => {
  it('returns true for code 23502', () => {
    expect(isRequiredFieldError({ code: '23502' })).toBe(true)
  })
  it('returns false for other codes', () => {
    expect(isRequiredFieldError({ code: '23505' })).toBe(false)
  })
})

describe('isForeignKeyError', () => {
  it('returns true for code 23503', () => {
    expect(isForeignKeyError({ code: '23503' })).toBe(true)
  })
})

describe('isCheckConstraintError', () => {
  it('returns true for code 23514', () => {
    expect(isCheckConstraintError({ code: '23514' })).toBe(true)
  })
})

describe('isPermissionError', () => {
  it('returns true for code 42501', () => {
    expect(isPermissionError({ code: '42501' })).toBe(true)
  })
  it('detects row-level security message', () => {
    expect(isPermissionError({ message: 'violates row-level security policy' })).toBe(true)
  })
  it('detects RLS keyword', () => {
    expect(isPermissionError({ message: 'RLS violation' })).toBe(true)
  })
  it('detects permission keyword', () => {
    expect(isPermissionError({ message: 'permission denied for table' })).toBe(true)
  })
  it('returns false for unrelated errors', () => {
    expect(isPermissionError({ code: '23505', message: 'duplicate key' })).toBe(false)
  })
})

describe('isPostgrestUnknownColumnError', () => {
  it('returns true for PGRST204', () => {
    expect(isPostgrestUnknownColumnError({ code: 'PGRST204' })).toBe(true)
  })
  it('returns true for 42703', () => {
    expect(isPostgrestUnknownColumnError({ code: '42703' })).toBe(true)
  })
  it('detects schema cache + column message', () => {
    expect(
      isPostgrestUnknownColumnError({ message: 'schema cache lookup failed for column foo' })
    ).toBe(true)
  })
  it('detects column does not exist message', () => {
    expect(
      isPostgrestUnknownColumnError({ message: 'column "bar" does not exist' })
    ).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/*  getUserFriendlyErrorMessage                                       */
/* ------------------------------------------------------------------ */
describe('getUserFriendlyErrorMessage', () => {
  it('returns permission message for 42501', () => {
    expect(getUserFriendlyErrorMessage({ code: '42501' })).toBe(
      'No tienes permisos para realizar esta acción.'
    )
  })

  it('returns required field message for 23502', () => {
    expect(getUserFriendlyErrorMessage({ code: '23502' })).toBe(
      'Completa los campos obligatorios antes de guardar.'
    )
  })

  it('returns foreign key message for 23503', () => {
    expect(getUserFriendlyErrorMessage({ code: '23503' })).toBe(
      'No se pudo guardar porque falta una relación requerida.'
    )
  })

  it('returns check constraint message for 23514', () => {
    expect(getUserFriendlyErrorMessage({ code: '23514' })).toBe(
      'No se pudo guardar porque no cumple una regla de validación.'
    )
  })

  it('returns brand-specific unique violation message', () => {
    expect(getUserFriendlyErrorMessage({ code: '23505' }, 'brand')).toBe(
      'Ya existe una marca con ese nombre. Revisa la marca existente o usa otro nombre.'
    )
  })

  it('returns product-specific unique violation message', () => {
    expect(getUserFriendlyErrorMessage({ code: '23505' }, 'product')).toBe(
      'Ya existe un producto similar en el catálogo. Revisa el producto existente antes de crear uno nuevo.'
    )
  })

  it('returns generic unique violation for generic context', () => {
    expect(getUserFriendlyErrorMessage({ code: '23505' }, 'generic')).toBe(
      'Ya existe un registro con ese nombre. Revisa el existente o usa otro nombre.'
    )
  })

  it('returns column-missing message for PGRST204', () => {
    expect(getUserFriendlyErrorMessage({ code: 'PGRST204' })).toContain(
      'falta una columna esperada'
    )
  })

  it('returns fallback for unknown errors', () => {
    expect(getUserFriendlyErrorMessage({ code: '99999' })).toBe(
      'No se pudo completar la acción. Intenta nuevamente.'
    )
  })

  it('returns fallback for null error', () => {
    expect(getUserFriendlyErrorMessage(null)).toBe(
      'No se pudo completar la acción. Intenta nuevamente.'
    )
  })
})
