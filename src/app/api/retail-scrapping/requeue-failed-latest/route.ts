import { NextResponse } from 'next/server'
import { requeueFailedPagesOnLatestRunForRetailAction } from '@/app/actions/retail-scrapping'
import { parseJsonBody, extractBodyString, apiError, apiCatchError } from '@/lib/api-route-helpers'

export async function POST(request: Request) {
  const body = await parseJsonBody(request)
  if (body === null) return apiError('Solicitud inválida.', 400)

  const retailId = extractBodyString(body, 'retailId')
  if (!retailId) return apiError('Falta el retail.', 400)

  try {
    const result = await requeueFailedPagesOnLatestRunForRetailAction({ retailId })
    return NextResponse.json(result)
  } catch (e) {
    return apiCatchError('api/retail-scrapping/requeue-failed-latest', e)
  }
}
