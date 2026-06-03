import { NextRequest, NextResponse } from 'next/server'
import { getScrappingInitAction } from '@/app/actions/retail-scrapping'

export async function GET(request: NextRequest) {
  const diagEnabled = process.env.NODE_ENV !== 'production' && request.headers.get('x-app-diagnostic-log') === '1'
  const start = Date.now()
  try {
    const result = await getScrappingInitAction()
    if (diagEnabled) {
      (result as any).__diagnostic = { durationMs: Date.now() - start, operation: 'getScrappingInitAction' }
    }
    return NextResponse.json(result)
  } catch (e) {
    console.error('[api/retail-scrapping/init]', e)
    return NextResponse.json({ ok: false as const, error: 'No logramos completar la acción. Intenta nuevamente.' })
  }
}
