/**
 * Si el primer proveedor de visión falla por cuota, JSON inválido o error de red,
 * se puede intentar el siguiente (ej. Gemini gratis → OpenRouter con saldo).
 */
export function shouldRetryVisionError(error: unknown): boolean {
  if (error instanceof SyntaxError) {
    return true
  }
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : (() => {
            try {
              return JSON.stringify(error)
            } catch {
              return ''
            }
          })()

  if (!msg || msg.length === 0) {
    return true
  }

  return (
    /429|402|401|503|502|504|RESOURCE_EXHAUSTED|Quota exceeded|quota|rate|limit|timeout|ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|network|openrouter_empty|empty_response|gemini_error|ollama/i.test(
      msg
    ) || /status":4\d\d/.test(msg)
  )
}
