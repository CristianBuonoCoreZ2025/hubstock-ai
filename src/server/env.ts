import { z } from 'zod'

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  /** Solo rutas /api/ai — opcional en build local hasta configurar Gemini */
  GEMINI_API_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
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
