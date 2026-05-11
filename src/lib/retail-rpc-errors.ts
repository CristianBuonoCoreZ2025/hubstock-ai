import {
  getUserFriendlyErrorMessage,
  isPermissionError,
} from '@/lib/user-friendly-errors'

/**
 * Mensajes accionables cuando fallan RPC/listados retail (sin exponer SQL crudo).
 */
export function messageForRetailListingRpcFailure(err: unknown): string {
  if (isPermissionError(err)) {
    return 'No tienes permisos para ver esta información.'
  }

  const any = err as { code?: string; message?: string; details?: string }
  const msg = `${any?.message ?? ''} ${any?.details ?? ''}`.toLowerCase()
  const code = String(any?.code ?? '')

  if (
    code === 'PGRST202' ||
    code === '42883' ||
    code === '42P01' ||
    msg.includes('could not find') ||
    msg.includes('does not exist') ||
    msg.includes('no existe la función') ||
    msg.includes('no existe la relación')
  ) {
    return 'No está disponible el módulo de precios por cadena en tu base de datos. Aplicá en Supabase las migraciones del proyecto (retail: funciones catalog_retail_* y tablas asociadas).'
  }

  if (msg.includes('unaccent')) {
    return 'Falta una extensión de PostgreSQL en el proyecto (búsqueda con acentos). Pedí al administrador que habilite la extensión en Supabase.'
  }

  return getUserFriendlyErrorMessage(err, 'generic')
}

/** Errores al insertar filas en catalog_retail_snapshots (barrido masivo). */
export function messageForRetailSnapshotInsertFailure(err: unknown): string {
  if (isPermissionError(err)) {
    return 'No tienes permisos para realizar esta acción.'
  }

  const any = err as { code?: string; message?: string; details?: string }
  const msg = `${any?.message ?? ''} ${any?.details ?? ''}`.toLowerCase()

  if (
    msg.includes('timeout') ||
    msg.includes('canceling statement') ||
    msg.includes('statement timeout')
  ) {
    return 'El guardado tardó demasiado o fue cancelado por volumen. Probá desactivar «Todo el catálogo», bajar el máximo de ítems o repetir en tandas más chicas.'
  }

  if (msg.includes('payload too large') || msg.includes('request entity too large')) {
    return 'El lote superó el tamaño permitido. Probá una tanda más chica (máximo de ítems menor).'
  }

  return getUserFriendlyErrorMessage(err, 'generic')
}

/** Crear lote de captura Lider (`retail_capture_batches`). */
export function messageForRetailCaptureBatchCreateFailure(err: unknown): string {
  if (isPermissionError(err)) {
    return 'No se pudo registrar el lote en la base de datos. Revisa que el servidor use SUPABASE_SERVICE_ROLE_KEY y que existan permisos sobre las tablas retail_capture_batches (migración del proyecto).'
  }

  const any = err as { code?: string; message?: string; details?: string }
  const msg = `${any?.message ?? ''} ${any?.details ?? ''}`.toLowerCase()
  const code = String(any?.code ?? '')

  if (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('no existe la relación') ||
    (msg.includes('schema cache') && msg.includes('retail_capture_batches'))
  ) {
    return 'Falta crear las tablas de captura por lotes en Supabase. Aplica la migración que define retail_capture_batches (carpeta supabase/migrations) y vuelve a intentar.'
  }

  if (msg.includes('jwt') || msg.includes('invalid api key')) {
    return 'La clave del servidor hacia Supabase no es válida. Revisa SUPABASE_SERVICE_ROLE_KEY y NEXT_PUBLIC_SUPABASE_URL.'
  }

  return getUserFriendlyErrorMessage(err, 'generic')
}
