import { z } from 'zod'

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  /** Solo rutas /api/ai — opcional en build local hasta configurar Gemini */
  GEMINI_API_KEY: z.string().min(1).optional(),
  /** Ej.: gemini-1.5-flash si gemini-2.0-flash devuelve 429 por cuota */
  GEMINI_MODEL: z.string().min(1).optional(),
  /** gemini | openrouter | auto — ver `src/server/vision-config.ts` */
  VISION_PROVIDER: z
    .enum(['gemini', 'openrouter', 'auto', 'ollama'])
    .optional(),
  /** Orden de intentos separado por comas, ej. gemini,openrouter */
  VISION_CHAIN: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_VISION_MODEL: z.string().min(1).optional(),
  /** Modelos gratuitos OpenRouter (coma = orden de intento), ej. a:free,b:free */
  OPENROUTER_VISION_MODEL_FREE: z.string().min(1).optional(),
  /** Modelos solo texto para boletas por PDF/texto (coma); si no hay, se usan los de visión */
  OPENROUTER_DOCUMENT_MODEL: z.string().min(1).optional(),
  OPENROUTER_DOCUMENT_MODEL_FREE: z.string().min(1).optional(),
  OPENROUTER_HTTP_REFERER: z.string().url().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  /** API local Ollama (visión), sin clave; ej. http://127.0.0.1:11434 */
  OLLAMA_BASE_URL: z.string().url().optional(),
  /** Modelo multimodal instalado en Ollama, ej. llava */
  OLLAMA_VISION_MODEL: z.string().min(1).optional(),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

let cached: ServerEnv | null = null

/** Variables solo servidor (Route Handlers, Server Actions). No exponer al cliente. */
export function getServerEnv(): ServerEnv {
  if (cached) return cached
  const parsed = serverEnvSchema.safeParse(process.env)
  if (!parsed.success) {
    throw new Error(
      `Variables de entorno inválidas: ${parsed.error.flatten().fieldErrors}`
    )
  }
  cached = parsed.data
  return parsed.data
}
