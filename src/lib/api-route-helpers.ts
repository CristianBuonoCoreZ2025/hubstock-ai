import { NextResponse } from 'next/server'

/**
 * Standard error shape used by all retail-scrapping and internal API routes.
 */
export type ApiErrorBody = { ok: false; error: string }

const GENERIC_ERROR_MSG = 'No logramos completar la acción. Intenta nuevamente.'

/**
 * Parse the JSON body from a Request, returning `null` on failure.
 */
export async function parseJsonBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

/**
 * Safely extract a trimmed string field from a parsed JSON body.
 * Returns `''` when the field is missing or the body is not an object.
 */
export function extractBodyString(body: unknown, key: string): string {
  if (typeof body !== 'object' || body === null || !(key in body)) return ''
  return String((body as Record<string, unknown>)[key] ?? '').trim()
}

/**
 * Build a standard `{ ok: false, error }` JSON response.
 */
export function apiError(message: string, status = 500): NextResponse<ApiErrorBody> {
  return NextResponse.json({ ok: false as const, error: message }, { status })
}

/**
 * Standard catch handler for route endpoints.
 * Logs the error with a tag and returns the generic user-facing error.
 */
export function apiCatchError(routeTag: string, error: unknown, status = 500): NextResponse<ApiErrorBody> {
  console.error(`[${routeTag}]`, error)
  return NextResponse.json({ ok: false as const, error: GENERIC_ERROR_MSG }, { status })
}

/**
 * Attach `__diagnostic` metadata to a result when the client sent the
 * `x-app-diagnostic-log: 1` header. Returns the (possibly augmented) result
 * as a NextResponse.
 */
export function apiOkWithDiagnostic<T>(
  request: Request,
  result: T,
  operation: string,
  startMs: number,
  extra?: Record<string, unknown>,
): NextResponse<T> {
  const diagEnabled = process.env.NODE_ENV !== 'production' && request.headers.get('x-app-diagnostic-log') === '1'
  if (diagEnabled) {
    const diag: Record<string, unknown> = { durationMs: Date.now() - startMs, operation, ...extra }
    const prev = (result as Record<string, unknown>).__diagnostic
    if (prev) {
      diag.captureDiagnostic = prev
    }
    ;(result as Record<string, unknown>).__diagnostic = diag
  }
  return NextResponse.json(result)
}
