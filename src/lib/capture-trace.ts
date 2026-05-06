/**
 * Trazas de depuración para flujo Inventario · Cargar por fotos.
 * En producción no escribe en consola (evita ruido); activar con NEXT_PUBLIC_CAPTURE_TRACE=1 si hace falta.
 */

function captureTraceEnabled(): boolean {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') {
    return true
  }
  if (
    typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_CAPTURE_TRACE === '1'
  ) {
    return true
  }
  return false
}

export function captureTrace(
  event: string,
  data?: Record<string, unknown>
): void {
  if (!captureTraceEnabled()) return
  console.info('[capture]', event, { ...data, at: new Date().toISOString() })
}
