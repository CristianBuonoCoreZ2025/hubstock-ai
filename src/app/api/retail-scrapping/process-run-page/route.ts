import { NextResponse } from 'next/server'
import { processLiderScrappingRunPageAction } from '@/app/actions/retail-scrapping'

/**
 * Procesa una página de la cola Lider. Expuesto como Route Handler para que varios workers
 * puedan ejecutarse en paralelo: las server actions invocadas desde el cliente se encolan en
 * serie en Next.js (p. ej. quedarían bloqueadas detrás de `discoverPhase2AppendAndSeal…`).
 */
export const maxDuration = 900

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false as const, error: 'Solicitud inválida.' }, { status: 400 })
  }

  const runId =
    typeof body === 'object' && body !== null && 'runId' in body ?
      String((body as { runId?: unknown }).runId ?? '').trim()
    : ''

  if (!runId) {
    return NextResponse.json(
      { ok: false as const, error: 'Falta el identificador de la ejecución.' },
      { status: 400 },
    )
  }

  try {
    const result = await processLiderScrappingRunPageAction({ runId })
    return NextResponse.json(result)
  } catch (e) {
    console.error('[api/retail-scrapping/process-run-page]', e)
    return NextResponse.json(
      { ok: false as const, error: 'No logramos completar la acción. Intenta nuevamente.' },
      { status: 500 },
    )
  }
}
