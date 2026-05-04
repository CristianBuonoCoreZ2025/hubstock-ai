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
