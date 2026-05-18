import {
  getOpenRouterHttpReferer,
  getOpenRouterVisionModel,
} from '@/server/vision-config'

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'

type OpenRouterErrorBody = {
  error?: { message?: string; code?: number; metadata?: unknown }
}

/* ── Rotación de API keys ── */

let _keyIndex = 0

/**
 * Devuelve todas las API keys configuradas.
 * Soporta: OPENROUTER_API_KEYS (coma) y/o OPENROUTER_API_KEY (singular).
 */
function getAllOpenRouterKeys(): string[] {
  const multi = process.env.OPENROUTER_API_KEYS?.trim()
  const single = process.env.OPENROUTER_API_KEY?.trim()
  const keys: string[] = []
  if (multi) {
    for (const k of multi.split(',')) {
      const t = k.trim()
      if (t) keys.push(t)
    }
  }
  if (single && !keys.includes(single)) {
    keys.push(single)
  }
  return keys
}

/** Round-robin: devuelve la siguiente key disponible. */
function getNextOpenRouterKey(): string {
  const keys = getAllOpenRouterKeys()
  if (keys.length === 0) {
    throw new Error('OPENROUTER_API_KEY no está configurada')
  }
  const key = keys[_keyIndex % keys.length]!
  _keyIndex = (_keyIndex + 1) % keys.length
  return key
}

/** ¿Es un error de rate limit que justifica rotar a otra key? */
function isRateLimitError(status: number, body: OpenRouterErrorBody): boolean {
  if (status === 429) return true
  const msg = (body.error?.message ?? '').toLowerCase()
  return (
    msg.includes('rate limit') ||
    msg.includes('resource_exhausted') ||
    msg.includes('over their global rate limit') ||
    msg.includes('quota exceeded')
  )
}

function parseOpenRouterAssistantContent(
  json: OpenRouterErrorBody & {
    choices?: Array<{ message?: { content?: string | unknown } }>
  }
): string {
  const content = json.choices?.[0]?.message?.content
  if (typeof content === 'string') {
    return content.trim()
  }
  if (Array.isArray(content)) {
    const parts = content
      .map((p: { text?: string }) => (typeof p?.text === 'string' ? p.text : ''))
      .join('')
    return parts.trim()
  }
  throw new Error('openrouter_empty_response')
}

/**
 * Una llamada chat multimodal (texto + imagen base64) y devuelve el texto del asistente.
 */
export async function openRouterVisionText(params: {
  prompt: string
  imageBase64: string
  mimeType: string
  /** Si se omite, usa OPENROUTER_VISION_MODEL o el predeterminado de vision-config */
  model?: string
}): Promise<string> {
  const keys = getAllOpenRouterKeys()
  if (keys.length === 0) {
    throw new Error('OPENROUTER_API_KEY no está configurada')
  }

  const model = params.model ?? getOpenRouterVisionModel()
  const dataUrl = `data:${params.mimeType};base64,${params.imageBase64}`

  const body = {
    model,
    messages: [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: params.prompt },
          {
            type: 'image_url' as const,
            image_url: { url: dataUrl },
          },
        ],
      },
    ],
  }

  let lastError: Error | null = null
  const attempts = Math.min(keys.length, 3)

  for (let i = 0; i < attempts; i++) {
    const key = getNextOpenRouterKey()
    const res = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': getOpenRouterHttpReferer(),
        'X-Title': 'StockCasa AI',
      },
      body: JSON.stringify(body),
    })

    const json = (await res.json()) as OpenRouterErrorBody & {
      choices?: Array<{ message?: { content?: string | unknown } }>
    }

    if (!res.ok) {
      if (isRateLimitError(res.status, json) && i < attempts - 1) {
        continue
      }
      const msg =
        json.error?.message ??
        (typeof json === 'object' ? JSON.stringify(json) : String(json))
      lastError = new Error(
        JSON.stringify({
          status: res.status,
          openrouter: true,
          message: msg,
        })
      )
      continue
    }

    return parseOpenRouterAssistantContent(json)
  }

  throw lastError ?? new Error('Todas las API keys de OpenRouter fallaron')
}

/**
 * Chat solo texto (boletas desde PDF o texto pegado; sin imagen).
 */
export async function openRouterChatText(params: {
  prompt: string
  model?: string
}): Promise<string> {
  const keys = getAllOpenRouterKeys()
  if (keys.length === 0) {
    throw new Error('OPENROUTER_API_KEY no está configurada')
  }

  const model = params.model ?? getOpenRouterVisionModel()
  const body = {
    model,
    messages: [
      {
        role: 'user' as const,
        content: params.prompt,
      },
    ],
  }

  let lastError: Error | null = null
  const attempts = Math.min(keys.length, 3)

  for (let i = 0; i < attempts; i++) {
    const key = getNextOpenRouterKey()
    const res = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': getOpenRouterHttpReferer(),
        'X-Title': 'StockCasa AI',
      },
      body: JSON.stringify(body),
    })

    const json = (await res.json()) as OpenRouterErrorBody & {
      choices?: Array<{ message?: { content?: string | unknown } }>
    }

    if (!res.ok) {
      if (isRateLimitError(res.status, json) && i < attempts - 1) {
        continue
      }
      const msg =
        json.error?.message ??
        (typeof json === 'object' ? JSON.stringify(json) : String(json))
      lastError = new Error(
        JSON.stringify({
          status: res.status,
          openrouter: true,
          message: msg,
        })
      )
      continue
    }

    return parseOpenRouterAssistantContent(json)
  }

  throw lastError ?? new Error('Todas las API keys de OpenRouter fallaron')
}
