import { NextResponse } from 'next/server'
import { discoverPhase2AppendAndSealLiderScrappingPagesAction } from '@/app/actions/retail-scrapping'
import { parseJsonBody, extractBodyString, apiError, apiCatchError } from '@/lib/api-route-helpers'

/** Descubrimiento completo del catálogo; puede tardar varios minutos. */
export const maxDuration = 3600

export async function POST(request: Request) {
  const body = await parseJsonBody(request)
  if (body === null) return apiError('Solicitud inválida.', 400)

  const runId = extractBodyString(body, 'runId')
  const retailId = extractBodyString(body, 'retailId')
  const maxPagesRaw =
    typeof body === 'object' && body !== null && 'maxPages' in body
      ? Number((body as Record<string, unknown>).maxPages ?? 0)
      : 0
  if (!runId || !retailId) {
    return apiError('Faltan el identificador de la ejecución o del retail.', 400)
  }

  try {
    const abortSignal = request.signal
    const result = await discoverPhase2AppendAndSealLiderScrappingPagesAction({
      runId,
      retailId,
      abortSignal,
      maxPages: maxPagesRaw > 0 ? maxPagesRaw : undefined,
    })
    return NextResponse.json(result)
  } catch (e) {
    return apiCatchError('api/retail-scrapping/phase2-seal', e)
  }
}
