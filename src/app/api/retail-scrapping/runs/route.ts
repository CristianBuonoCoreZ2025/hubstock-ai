import { NextResponse } from 'next/server'
import { listScrappingRunsAction } from '@/app/actions/retail-scrapping'

export async function GET() {
  try {
    const result = await listScrappingRunsAction()
    return NextResponse.json(result)
  } catch (e) {
    console.error('[api/retail-scrapping/runs]', e)
    return NextResponse.json({ ok: false as const, error: 'No logramos completar la acción. Intenta nuevamente.' })
  }
}
