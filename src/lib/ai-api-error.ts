export type AiApiJsonReadResult<T extends Record<string, unknown>> =
  | { kind: 'ok'; json: T }
  | { kind: 'empty' }
  | { kind: 'invalid_json' }

/**
 * Lee el cuerpo como texto y parsea JSON sin lanzar si viene vacío o truncado
 * (evita SyntaxError en `response.json()` con respuestas vacías de proxy o 502).
 */
export async function readAiApiJsonBody<
  T extends Record<string, unknown>,
>(res: Response): Promise<AiApiJsonReadResult<T>> {
  const text = await res.text()
  const trimmed = text.trim()
  if (!trimmed) {
    return { kind: 'empty' }
  }
  try {
    return { kind: 'ok', json: JSON.parse(trimmed) as T }
  } catch {
    return { kind: 'invalid_json' }
  }
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
  if (
    json.error === 'vision_quota' ||
    json.error === 'gemini_quota' ||
    json.error === 'vision_payment'
  ) {
    return 'Problema de cuota o saldo con el proveedor de IA. Revisa VISION_PROVIDER, OPENROUTER_* o GEMINI_* en .env.local.'
  }
  return typeof json.error === 'string' && json.error.length > 0
    ? json.error
    : 'Error de análisis con IA'
}
