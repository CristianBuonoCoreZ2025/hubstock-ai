import { processLiderScrappingRunPageAction } from '@/app/actions/retail-scrapping'
import { parseJsonBody, extractBodyString, apiError, apiCatchError, apiOkWithDiagnostic } from '@/lib/api-route-helpers'

/**
 * Procesa una página de la cola Lider. Expuesto como Route Handler para que varios workers
 * puedan ejecutarse en paralelo: las server actions invocadas desde el cliente se encolan en
 * serie en Next.js (p. ej. quedarían bloqueadas detrás de `discoverPhase2AppendAndSeal…`).
 */
export const maxDuration = 900

export async function POST(request: Request) {
  const body = await parseJsonBody(request)
  if (body === null) return apiError('Solicitud inválida.', 400)

  const runId = extractBodyString(body, 'runId')
  if (!runId) return apiError('Falta el identificador de la ejecución.', 400)

  const abortSignal = request.signal
  const start = Date.now()

  try {
    const result = await processLiderScrappingRunPageAction({ runId, abortSignal })
    return apiOkWithDiagnostic(request, result, 'processLiderScrappingRunPageAction', start, { runId })
  } catch (e) {
    if (abortSignal?.aborted) {
      return apiError('Proceso cancelado por el cliente.', 499)
    }
    return apiCatchError('api/retail-scrapping/process-run-page', e, 500)
  }
}
