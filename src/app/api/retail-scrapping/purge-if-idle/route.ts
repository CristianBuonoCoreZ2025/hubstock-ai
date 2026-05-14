import { NextResponse } from 'next/server'
import { purgeScrappingTablesIfIdleAction } from '@/app/actions/retail-scrapping'

export async function POST() {
  try {
    const result = await purgeScrappingTablesIfIdleAction()
    return NextResponse.json(result)
  } catch (e) {
    console.error('[api/retail-scrapping/purge-if-idle]', e)
    return NextResponse.json({ ok: false as const, error: 'No logramos completar la acción. Intenta nuevamente.' })
  }
}
