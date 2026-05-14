import { NextResponse } from 'next/server'
import { prepareLiderScrappingRunAction } from '@/app/actions/retail-scrapping'

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false as const, error: 'Solicitud inválida.' }, { status: 400 })
  }
  const retailId =
    typeof body === 'object' && body !== null && 'retailId' in body ?
      String((body as { retailId?: unknown }).retailId ?? '').trim()
    : ''
  if (!retailId) {
    return NextResponse.json({ ok: false as const, error: 'Falta el retail.' }, { status: 400 })
  }
  try {
    const result = await prepareLiderScrappingRunAction({ retailId })
    return NextResponse.json(result)
  } catch (e) {
    console.error('[api/retail-scrapping/prepare-run]', e)
    return NextResponse.json({ ok: false as const, error: 'No logramos completar la acción. Intenta nuevamente.' })
  }
}
