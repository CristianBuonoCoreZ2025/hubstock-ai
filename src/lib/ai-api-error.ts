export type AiApiJsonReadResult<T extends Record<string, unknown>> =
  | { kind: 'ok'; json: T }
  | { kind: 'empty' }
  | { kind: 'invalid_json'; rawPreview: string }

/**
 * Lee el cuerpo como texto y parsea JSON sin lanzar si viene vacío o truncado
 * (evita SyntaxError en `response.json()` con respuestas vacías de proxy o 502).
 */
export async function readAiApiJsonBody<
  T extends Record<string, unknown>,
>(res: Response): Promise<AiApiJsonReadResult<T>> {
  const text = await res.text()
  const trimmed = text.trim().replace(/^\uFEFF/, '')
  if (!trimmed) {
    return { kind: 'empty' }
  }
  try {
    return { kind: 'ok', json: JSON.parse(trimmed) as T }
  } catch {
    return {
      kind: 'invalid_json',
      rawPreview: trimmed.slice(0, 400),
    }
  }
}

/**
 * Mensaje cuando el servidor devolvió algo que no es JSON (típico: HTML de error de Next).
 */
export function messageWhenAiApiBodyNotJson(rawPreview: string): string {
  const p = rawPreview.trim()
  if (
    p.startsWith('<!DOCTYPE') ||
    /^<html[\s>]/i.test(p.slice(0, 400)) ||
    /Internal Server Error/i.test(p.slice(0, 800))
  ) {
    return 'El servidor devolvió una página HTML de error en lugar de JSON. Revisa la terminal donde corre `next dev` para ver la excepción.'
  }
  if (
    p.startsWith('<') &&
    (/next/i.test(p.slice(0, 600)) || /<body/i.test(p.slice(0, 600)))
  ) {
    return 'El servidor devolvió HTML (posible pantalla de error). Abre la terminal del servidor y revisa el stack trace.'
  }
  if (p.length > 0 && p.length < 400 && !/[{\[]/.test(p)) {
    const oneLine = p.replace(/\s+/g, ' ').slice(0, 180)
    return `Respuesta no reconocida del servidor: ${oneLine}${p.length > 180 ? '…' : ''}`
  }
  return 'La respuesta del servidor no es JSON válido. Si enviaste una foto o PDF muy grande, prueba un archivo más pequeño.'
}

/**
 * Mensaje listo para mostrar al usuario a partir de la respuesta de `/api/ai/*`.
 */
export function messageFromAiApiError(json: {
  error?: string
  hint?: string
}): string {
  if (typeof json.hint === 'string' && json.hint.length > 0) {
    return json.hint
  }
  if (json.error === 'vision_quota' || json.error === 'gemini_quota') {
    return 'Límite temporal en OpenRouter (429). Suele ser ritmo de solicitudes o límites del modelo; prueba otro OPENROUTER_VISION_MODEL o espera un minuto. Revisa también OPENROUTER_API_KEY si el fallo persiste.'
  }
  if (json.error === 'vision_payment') {
    return 'Problema de saldo o pago en OpenRouter (402). Revisa tu cuenta en https://openrouter.ai/ y OPENROUTER_VISION_MODEL.'
  }
  return typeof json.error === 'string' && json.error.length > 0
    ? json.error
    : 'Error de análisis con IA'
}
