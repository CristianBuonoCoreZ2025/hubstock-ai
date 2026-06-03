import { NextResponse } from 'next/server'
import { resumeLiderScrappingBarridoAction } from '@/app/actions/retail-scrapping'
import { parseJsonBody, extractBodyString, apiError, apiCatchError } from '@/lib/api-route-helpers'

export async function POST(request: Request) {
  const body = await parseJsonBody(request)
  if (body === null) return apiError('Solicitud inválida.', 400)

  const runId = extractBodyString(body, 'runId')
  const retailId = extractBodyString(body, 'retailId')
  if (!runId || !retailId) {
    return apiError('Faltan el identificador de la ejecución o del retail.', 400)
  }

  try {
    const result = await resumeLiderScrappingBarridoAction({ runId, retailId })
    return NextResponse.json(result)
  } catch (e) {
    return apiCatchError('api/retail-scrapping/resume-barrido', e)
  }
}
