/**
 * Logger persistente en base de datos.
 * Guarda errores técnicos para auditoría y debugging.
 * NUNCA mostrar estos logs al usuario final.
 * BEVECOHO: La base guarda TODO.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

export type DbLogEntry = {
  level: LogLevel
  module: string
  message: string
  context?: Record<string, unknown>
  screen?: string
  sessionId?: string
}

/**
 * Escribe un log técnico a la tabla app_logs.
 * Silencioso: si falla, no lanza error (para no romper el flujo principal).
 */
export async function writeDbLog(
  admin: SupabaseClient,
  entry: DbLogEntry,
): Promise<void> {
  try {
    const { error } = await admin.from('app_logs').insert({
      level: entry.level,
      module: entry.module,
      message: entry.message,
      context: entry.context ?? null,
      screen: entry.screen ?? null,
      session_id: entry.sessionId ?? null,
    } as never)
    if (error) {
      console.error('[db-logger] falló escritura a app_logs:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        entry,
      })
    }
  } catch (e) {
    console.error('[db-logger] excepción inesperada escribiendo app_logs:', {
      exception: e instanceof Error ? e.message : String(e),
      entry,
    })
  }
}

/**
 * Helper para loggear errores técnicos con contexto.
 * Uso: await logError(admin, { module: '[create-new]', message: '...', context: { rowId, code } })
 */
export async function logError(
  admin: SupabaseClient,
  entry: Omit<DbLogEntry, 'level'>,
): Promise<void> {
  return writeDbLog(admin, { ...entry, level: 'error' })
}

export async function logWarn(
  admin: SupabaseClient,
  entry: Omit<DbLogEntry, 'level'>,
): Promise<void> {
  return writeDbLog(admin, { ...entry, level: 'warn' })
}

export async function logInfo(
  admin: SupabaseClient,
  entry: Omit<DbLogEntry, 'level'>,
): Promise<void> {
  return writeDbLog(admin, { ...entry, level: 'info' })
}
