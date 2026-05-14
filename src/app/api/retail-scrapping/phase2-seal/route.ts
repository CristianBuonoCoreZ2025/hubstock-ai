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
  if (!runId || !retailId) {
    return NextResponse.json(
      { ok: false as const, error: 'Faltan el identificador de la ejecución o del retail.' },
      { status: 400 },
    )
  }
  try {
    const result = await discoverPhase2AppendAndSealLiderScrappingPagesAction({ runId, retailId })
    return NextResponse.json(result)
  } catch (e) {
    console.error('[api/retail-scrapping/phase2-seal]', e)
    return NextResponse.json({ ok: false as const, error: 'No logramos completar la acción. Intenta nuevamente.' })
  }
}
