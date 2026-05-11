/**
 * Logs del barrido VTEX → snapshots. Buscar en hosting: [retail-catalog-sweep]
 * Activá barro detallado con RETAIL_SWEEP_LOG=1 (cualquier entorno).
 */

const PREFIX = '[retail-catalog-sweep]'

function verbose(): boolean {
  return process.env.RETAIL_SWEEP_LOG === '1'
}

export function retailSweepLogInfo(msg: string, data?: Record<string, unknown>): void {
  if (process.env.NODE_ENV !== 'development' && !verbose()) return
  if (data && Object.keys(data).length > 0) {
    console.log(PREFIX, msg, data)
  } else {
    console.log(PREFIX, msg)
  }
}

/** Siempre registra (errors del proceso y pasos críticos en producción). */
export function retailSweepLogWarn(msg: string, data?: Record<string, unknown>): void {
  if (data && Object.keys(data).length > 0) {
    console.warn(PREFIX, msg, data)
  } else {
    console.warn(PREFIX, msg)
  }
}

export function retailSweepLogError(msg: string, data?: Record<string, unknown>): void {
  if (data && Object.keys(data).length > 0) {
    console.error(PREFIX, msg, data)
  } else {
    console.error(PREFIX, msg)
  }
}

export function retailSweepProgressEvery(
  pagesFetched: number,
  message: string,
  data: Record<string, unknown>,
): void {
  const step = verbose() ? 25 : 100
  if (pagesFetched === 1 || pagesFetched % step === 0) {
    retailSweepLogInfo(message, data)
  }
}
