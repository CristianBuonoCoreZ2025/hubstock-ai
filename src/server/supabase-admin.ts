import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { getServerEnv } from '@/server/env'

/** Cliente con service_role: solo tareas administrativas en servidor (nunca importar en cliente). */
export function createServiceRoleClient() {
  const env = getServerEnv()
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY no está configurada')
  }
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  )
}
