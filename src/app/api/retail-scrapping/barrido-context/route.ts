import { NextResponse } from 'next/server'
import { getLiderScrappingBarridoContextAction } from '@/app/actions/retail-scrapping'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const retailId = url.searchParams.get('retailId')?.trim() ?? ''
  if (!retailId) {
    return NextResponse.json({ ok: false as const, error: 'Falta el retail.' }, { status: 400 })
  }
  try {
    const result = await getLiderScrappingBarridoContextAction({ retailId })
    return NextResponse.json(result)
  } catch (e) {
    console.error('[api/retail-scrapping/barrido-context]', e)
    return NextResponse.json({ ok: false as const, error: 'No logramos completar la acción. Intenta nuevamente.' })
  }
}
