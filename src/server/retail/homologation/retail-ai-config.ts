/**
 * Modelos OpenRouter para homologación retail **automática** (sin elección de usuario).
 * Solo modelos gratuitos por defecto; pago solo si `RETAIL_AI_ALLOW_PAID_FALLBACK=1`.
 *
 * No reutiliza `OPENROUTER_DOCUMENT_MODEL*` ni `VISION_CHAIN` para no mezclar con
 * boletas, PDF o flujos manuales de visión.
 */

const DEFAULT_OPENROUTER_RETAIL_FREE_MODELS = ['openrouter/free'] as const

/**
 * Lista ordenada de modelos **gratis** a intentar para IA retail automática.
 * Variable: `OPENROUTER_RETAIL_MODEL_FREE` (uno o varios ids separados por coma).
 * Si no está definida o queda vacía tras parsear, se usa `openrouter/free`.
 */
export function getOpenRouterFreeRetailModels(): string[] {
  const raw = process.env.OPENROUTER_RETAIL_MODEL_FREE?.trim()
  if (!raw) {
    return [...DEFAULT_OPENROUTER_RETAIL_FREE_MODELS]
  }
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return parts.length > 0 ? parts : [...DEFAULT_OPENROUTER_RETAIL_FREE_MODELS]
}

/**
 * Si es true, tras agotar modelos gratis se puede intentar la lista de documento **pago**
 * (`getOpenRouterPaidDocumentModels` en vision-config). Solo activo con `RETAIL_AI_ALLOW_PAID_FALLBACK=1`.
 */
export function retailAiAllowPaidFallback(): boolean {
  return process.env.RETAIL_AI_ALLOW_PAID_FALLBACK?.trim() === '1'
}
