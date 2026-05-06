export type UserFriendlyErrorContext =
  | 'brand'
  | 'category'
  | 'section'
  | 'product'
  | 'alias'
  | 'generic'

type AnyDbError = {
  code?: string
  message?: string
  details?: string
  hint?: string
}

function asDbError(err: unknown): AnyDbError | null {
  if (!err || typeof err !== 'object') return null
  return err as AnyDbError
}

export function isUniqueViolation(err: unknown): boolean {
  return asDbError(err)?.code === '23505'
}

export function isRequiredFieldError(err: unknown): boolean {
  return asDbError(err)?.code === '23502'
}

export function isForeignKeyError(err: unknown): boolean {
  return asDbError(err)?.code === '23503'
}

export function isCheckConstraintError(err: unknown): boolean {
  return asDbError(err)?.code === '23514'
}

export function isPermissionError(err: unknown): boolean {
  const code = asDbError(err)?.code
  if (code === '42501') return true
  const msg = (asDbError(err)?.message ?? '').toLowerCase()
  return msg.includes('row-level security') || msg.includes('rls') || msg.includes('permission')
}

function uniqueMessageForContext(ctx: UserFriendlyErrorContext): string {
  switch (ctx) {
    case 'brand':
      return 'Ya existe una marca con ese nombre. Revisa la marca existente o usa otro nombre.'
    case 'category':
      return 'Ya existe una categoría con ese nombre en esta sección.'
    case 'section':
      return 'Ya existe una sección con ese nombre.'
    case 'product':
      return 'Ya existe un producto similar en el catálogo. Revisa el producto existente antes de crear uno nuevo.'
    default:
      return 'Ya existe un registro con ese nombre. Revisa el existente o usa otro nombre.'
  }
}

/**
 * Traduce errores técnicos (Supabase/Postgres) a mensajes profesionales.
 * Nunca devuelve mensajes crudos con detalles técnicos.
 */
export function getUserFriendlyErrorMessage(
  err: unknown,
  ctx: UserFriendlyErrorContext = 'generic'
): string {
  if (isPermissionError(err)) return 'No tienes permisos para realizar esta acción.'
  if (isRequiredFieldError(err)) return 'Completa los campos obligatorios antes de guardar.'
  if (isForeignKeyError(err)) return 'No se pudo guardar porque falta una relación requerida.'
  if (isCheckConstraintError(err)) return 'No se pudo guardar porque no cumple una regla de validación.'
  if (isUniqueViolation(err)) return uniqueMessageForContext(ctx)
  return 'No se pudo completar la acción. Intenta nuevamente.'
}

