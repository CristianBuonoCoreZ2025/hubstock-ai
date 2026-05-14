import { NextResponse } from 'next/server'
import { stopLiderScrappingAction } from '@/app/actions/retail-scrapping'

export async function POST() {
  try {
    const result = await stopLiderScrappingAction()
    return NextResponse.json(result)
  } catch (e) {
    console.error('[api/retail-scrapping/stop]', e)
    return NextResponse.json({ ok: false as const, error: 'No logramos completar la acción. Intenta nuevamente.' })
  }
}
