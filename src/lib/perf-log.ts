type PerfLogMeta = Record<string, unknown>

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

export function isPerfLogEnabled(): boolean {
  const v =
    process.env.PERF_LOG_QUERIES ??
    process.env.PERF_LOG ??
    process.env.NEXT_PUBLIC_PERF_LOG
  if (!v) return false
  const s = String(v).trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes' || s === 'on'
}

export function perfLog(event: string, meta: PerfLogMeta = {}) {
  if (!isPerfLogEnabled()) return
  const payload = {
    ts: new Date().toISOString(),
    event,
    ...meta,
  }
  // Log estructurado (una línea) para poder filtrar/parsear fácil.
  console.info('[perf]', JSON.stringify(payload))
}

export async function withPerfTiming<T>(
  event: string,
  meta: PerfLogMeta,
  fn: () => PromiseLike<T>
): Promise<T> {
  const t0 = nowMs()
  try {
    const result = await fn()
    const ms = Math.max(0, nowMs() - t0)
    perfLog(event, { ...meta, ms, ok: true })
    return result
  } catch (err) {
    const ms = Math.max(0, nowMs() - t0)
    perfLog(event, {
      ...meta,
      ms,
      ok: false,
      errorName: err instanceof Error ? err.name : undefined,
    })
    throw err
  }
}

