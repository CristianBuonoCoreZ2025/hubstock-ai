import { getOllamaBaseUrl, getOllamaVisionModel } from '@/server/vision-config'

type OllamaChatResponse = {
  message?: { content?: string }
  error?: string
}

/**
 * Visión vía Ollama en la máquina local (sin API key de terceros).
 * Requiere Ollama en marcha y un modelo multimodal (ej. `llava`, `llava-phi3`).
 */
export async function ollamaVisionText(params: {
  prompt: string
  imageBase64: string
  mimeType: string
  model?: string
}): Promise<string> {
  const base = getOllamaBaseUrl().replace(/\/$/, '')
  const model = params.model ?? getOllamaVisionModel()
  const url = `${base}/api/chat`

  const body = {
    model,
    messages: [
      {
        role: 'user' as const,
        content: params.prompt,
        images: [params.imageBase64],
      },
    ],
    stream: false,
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const json = (await res.json()) as OllamaChatResponse

  if (!res.ok) {
    const msg = json.error ?? `HTTP ${res.status}`
    throw new Error(
      JSON.stringify({ ollama: true, status: res.status, message: msg })
    )
  }

  const content = json.message?.content?.trim()
  if (!content) {
    throw new Error(
      JSON.stringify({
        ollama: true,
        message: 'empty_response',
      })
    )
  }

  return content
}
