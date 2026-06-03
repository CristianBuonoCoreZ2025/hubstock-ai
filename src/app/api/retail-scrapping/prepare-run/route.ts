import { NextResponse } from 'next/server'
import { prepareLiderScrappingRunAction } from '@/app/actions/retail-scrapping'
import { parseJsonBody, extractBodyString, apiError, apiCatchError } from '@/lib/api-route-helpers'

export async function POST(request: Request) {
  const body = await parseJsonBody(request)
  if (body === null) return apiError('Solicitud inválida.', 400)

  const retailId = extractBodyString(body, 'retailId')
  if (!retailId) return apiError('Falta el retail.', 400)

  try {
    const result = await prepareLiderScrappingRunAction({ retailId })
    return NextResponse.json(result)
  } catch (e) {
    return apiCatchError('api/retail-scrapping/prepare-run', e)
  }
}
