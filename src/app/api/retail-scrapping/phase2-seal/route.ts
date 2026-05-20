import { NextResponse } from 'next/server'
import { discoverPhase2AppendAndSealLiderScrappingPagesAction } from '@/app/actions/retail-scrapping'

/** Descubrimiento completo del catálogo; puede tardar varios minutos. */
export const maxDuration = 3600

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
  const retailId =
    typeof body === 'object' && body !== null && 'retailId' in body ?
      String((body as { retailId?: unknown }).retailId ?? '').trim()
    : ''
  const maxPages =
    typeof body === 'object' && body !== null && 'maxPages' in body ?
      Number((body as { maxPages?: unknown }).maxPages ?? 0)
    : 0
  if (!runId || !retailId) {
    return NextResponse.json(
      { ok: false as const, error: 'Faltan el identificador de la ejecución o del retail.' },
      { status: 400 },
    )
  }
  try {
    const abortSignal = request.signal
    const result = await discoverPhase2AppendAndSealLiderScrappingPagesAction({ runId, retailId, abortSignal, maxPages: maxPages > 0 ? maxPages : undefined })
    return NextResponse.json(result)
  } catch (e) {
    console.error('[api/retail-scrapping/phase2-seal]', e)
    return NextResponse.json({ ok: false as const, error: 'No logramos completar la acción. Intenta nuevamente.' })
  }
}
