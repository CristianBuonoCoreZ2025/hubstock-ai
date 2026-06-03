import { NextResponse } from 'next/server'
import { getLiderScrappingBarridoContextAction } from '@/app/actions/retail-scrapping'
import { apiError, apiCatchError } from '@/lib/api-route-helpers'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const retailId = url.searchParams.get('retailId')?.trim() ?? ''
  if (!retailId) return apiError('Falta el retail.', 400)

  try {
    const result = await getLiderScrappingBarridoContextAction({ retailId })
    return NextResponse.json(result)
  } catch (e) {
    return apiCatchError('api/retail-scrapping/barrido-context', e)
  }
}
