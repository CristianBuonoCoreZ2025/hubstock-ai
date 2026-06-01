import { NextResponse } from 'next/server'
import { submitLiderPageHtmlAction } from '@/app/actions/retail-scrapping'

/**
 * Recibe HTML de una página Lider capturada desde el navegador del usuario.
 * Evita anti-bot de Akamai porque la petición de fetch la hace el navegador (IP residencial).
 */
export const maxDuration = 60

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false as const, error: 'Solicitud invalida.' }, { status: 400 })
  }

  const payload =
    typeof body === 'object' && body !== null ?
      (body as { runId?: unknown; pageId?: unknown; pageUrl?: unknown; html?: unknown })
    : {}

  const runId = String(payload.runId ?? '').trim()
  const pageId = String(payload.pageId ?? '').trim()
  const pageUrl = String(payload.pageUrl ?? '').trim()
  const html = String(payload.html ?? '')

  if (!runId || !pageId || !pageUrl) {
    return NextResponse.json(
      { ok: false as const, error: 'Faltan parametros requeridos (runId, pageId, pageUrl).' },
      { status: 400 },
    )
  }

  try {
    const result = await submitLiderPageHtmlAction({ runId, pageId, pageUrl, html })
    return NextResponse.json(result)
  } catch (e) {
    console.error('[api/retail-scrapping/submit-page-html]', e)
    return NextResponse.json(
      { ok: false as const, error: 'No logramos completar la accion. Intenta nuevamente.' },
      { status: 500 },
    )
  }
}
