import { NextResponse } from 'next/server'
import { discoverPhase1EnqueueLiderScrappingPagesAction } from '@/app/actions/retail-scrapping'

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
    const result = await discoverPhase1EnqueueLiderScrappingPagesAction({ runId, retailId })
    return NextResponse.json(result)
  } catch (e) {
    console.error('[api/retail-scrapping/phase1-enqueue]', e)
    return NextResponse.json({ ok: false as const, error: 'No logramos completar la acción. Intenta nuevamente.' })
  }
}
