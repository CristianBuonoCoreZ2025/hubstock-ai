import { NextResponse } from 'next/server'
import { listRetailTargetsAction } from '@/app/actions/retail-scrapping'

export async function GET() {
  try {
    const result = await listRetailTargetsAction()
    return NextResponse.json(result)
  } catch (e) {
    console.error('[api/retail-scrapping/retails]', e)
    return NextResponse.json({ ok: false as const, error: 'No logramos completar la acción. Intenta nuevamente.' })
  }
}
