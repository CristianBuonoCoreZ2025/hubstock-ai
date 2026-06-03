import { NextResponse } from 'next/server'
import { submitLiderPageHtmlAction } from '@/app/actions/retail-scrapping'
import { parseJsonBody, extractBodyString, apiError, apiCatchError } from '@/lib/api-route-helpers'

/**
 * Recibe HTML de una página Lider capturada desde el navegador del usuario.
 * Evita anti-bot de Akamai porque la petición de fetch la hace el navegador (IP residencial).
 */
export const maxDuration = 60

export async function POST(request: Request) {
  const body = await parseJsonBody(request)
  if (body === null) return apiError('Solicitud invalida.', 400)

  const runId = extractBodyString(body, 'runId')
  const pageId = extractBodyString(body, 'pageId')
  const pageUrl = extractBodyString(body, 'pageUrl')
  const html =
    typeof body === 'object' && body !== null
      ? String((body as Record<string, unknown>).html ?? '')
      : ''

  if (!runId || !pageId || !pageUrl) {
    return apiError('Faltan parametros requeridos (runId, pageId, pageUrl).', 400)
  }

  try {
    const result = await submitLiderPageHtmlAction({ runId, pageId, pageUrl, html })
    return NextResponse.json(result)
  } catch (e) {
    return apiCatchError('api/retail-scrapping/submit-page-html', e, 500)
  }
}
