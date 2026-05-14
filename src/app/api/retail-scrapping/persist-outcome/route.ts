import { NextResponse } from 'next/server'
import { persistScrappingRunBarridoOutcomeIfRunningAction } from '@/app/actions/retail-scrapping'

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
  const summary =
    typeof body === 'object' && body !== null && 'summary' in body ?
      String((body as { summary?: unknown }).summary ?? '')
    : ''
  if (!runId) {
    return NextResponse.json({ ok: false as const, error: 'Falta el identificador de la corrida.' }, { status: 400 })
  }
  try {
    const result = await persistScrappingRunBarridoOutcomeIfRunningAction({ runId, summary })
    return NextResponse.json(result)
  } catch (e) {
    console.error('[api/retail-scrapping/persist-outcome]', e)
    return NextResponse.json({ ok: false as const, error: 'No logramos completar la acción. Intenta nuevamente.' })
  }
}
