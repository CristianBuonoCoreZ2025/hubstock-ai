import {
  getOpenRouterHttpReferer,
  getOpenRouterVisionModel,
} from '@/server/vision-config'

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'

type OpenRouterErrorBody = {
  error?: { message?: string; code?: number; metadata?: unknown }
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
  const key = process.env.OPENROUTER_API_KEY?.trim()
  if (!key) {
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
    const msg =
      json.error?.message ??
      (typeof json === 'object' ? JSON.stringify(json) : String(json))
    throw new Error(
      JSON.stringify({
        status: res.status,
        openrouter: true,
        message: msg,
      })
    )
  }

  const content = json.choices?.[0]?.message?.content
  if (typeof content === 'string') {
    return content.trim()
  }
  if (Array.isArray(content)) {
    // Algunos proveedores devuelven fragmentos de texto
    const parts = content
      .map((p: { text?: string }) => (typeof p?.text === 'string' ? p.text : ''))
      .join('')
    return parts.trim()
  }

  throw new Error('openrouter_empty_response')
}
