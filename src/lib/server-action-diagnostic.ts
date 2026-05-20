/**
 * Helper server-side para incluir metadata de diagnostico en respuestas
 * cuando el cliente activo el log (header x-app-diagnostic-log).
 *
 * Uso:
 *   return withServerActionDiagnostic(result, { operation: 'miAction', durationMs: Date.now() - start })
 *
 * No expone secrets, SQL ni datos sensibles.
 */

export interface ServerActionDiagnosticMeta {
  operation: string
  durationMs: number
  /** Opcional: tipo de operacion DB masiva detectada */
  dbOperation?: 'select' | 'insert' | 'update' | 'upsert' | 'delete' | 'rpc'
  /** Opcional: tabla afectada */
  table?: string
  /** Opcional: cantidad estimada de registros */
  rowCount?: number
  /** Opcional: si fue operacion masiva */
  bulk?: boolean
}

export function withServerActionDiagnostic<T extends Record<string, unknown>>(
  result: T,
  meta: ServerActionDiagnosticMeta,
): T & { __diagnostic?: ServerActionDiagnosticMeta } {
  return {
    ...result,
    __diagnostic: meta,
  }
}
