/**
 * Normaliza errores de Gemini u OpenRouter para respuestas HTTP legibles.
 */

export type VisionRouteFailure = {
  status: number
  payload: {
    error: string
    code?: 'vision_quota' | 'vision_payment' | 'vision_error'
    hint?: string
  }
}

const QUOTA_HINT =
  'Límite de uso o cuota de IA alcanzada (429). Si usas Google Gemini directo: revisa https://aistudio.google.com/ y GEMINI_MODEL. Si usas OpenRouter: revisa saldo en https://openrouter.ai/ o prueba otro modelo en OPENROUTER_VISION_MODEL (incluidos modelos gratuitos con sufijo :free cuando existan en el catálogo). Espera unos minutos y reintenta.'

const PAYMENT_HINT =
  'OpenRouter reportó falta de saldo o método de pago (402). Recarga en https://openrouter.ai/ o define OPENROUTER_VISION_MODEL con un modelo más económico o gratuito según el catálogo actual.'

export function mapVisionFailure(error: unknown): VisionRouteFailure {
  const raw =
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

  const quotaHit =
    /429|RESOURCE_EXHAUSTED|Quota exceeded|quota exceeded|rate.?limit|RATE_LIMIT|too many requests/i.test(
      raw
    )

  if (quotaHit) {
    return {
      status: 429,
      payload: {
        error: 'vision_quota',
        code: 'vision_quota',
        hint: QUOTA_HINT,
      },
    }
  }

  const paymentHit =
    /402|PAYMENT_REQUIRED|payment required|Insufficient credits|insufficient balance|insufficient_quota/i.test(
      raw
    )

  if (paymentHit) {
    return {
      status: 402,
      payload: {
        error: 'vision_payment',
        code: 'vision_payment',
        hint: PAYMENT_HINT,
      },
    }
  }

  const trimmed =
    raw.length > 800 ? `${raw.slice(0, 800)}…` : raw || 'vision_error'
  return {
    status: 502,
    payload: {
      error: trimmed,
      code: 'vision_error',
    },
  }
}

/** @deprecated Usar mapVisionFailure */
export const mapGeminiFailure = mapVisionFailure
