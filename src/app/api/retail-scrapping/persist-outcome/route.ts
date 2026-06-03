import { NextResponse } from 'next/server'
import { persistScrappingRunBarridoOutcomeIfRunningAction } from '@/app/actions/retail-scrapping'
import { parseJsonBody, extractBodyString, apiError, apiCatchError } from '@/lib/api-route-helpers'

export async function POST(request: Request) {
  const body = await parseJsonBody(request)
  if (body === null) return apiError('Solicitud inválida.', 400)

  const runId = extractBodyString(body, 'runId')
  const summary = extractBodyString(body, 'summary')
  if (!runId) return apiError('Falta el identificador de la corrida.', 400)

  try {
    const result = await persistScrappingRunBarridoOutcomeIfRunningAction({ runId, summary })
    return NextResponse.json(result)
  } catch (e) {
    return apiCatchError('api/retail-scrapping/persist-outcome', e)
  }
}
