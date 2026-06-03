import { createClient } from '@/lib/supabase/server'
import { getProfileContext } from '@/lib/profile/context'
import { assertProfileMembership } from '@/lib/profile/membership'

type Role = 'viewer' | 'editor' | 'admin'

type ActionContextOk = {
  ok: true
  supabase: Awaited<ReturnType<typeof createClient>>
  activeProfileId: string
}

type ActionContextError = {
  ok: false
  error: string
}

export type ActionContext = ActionContextOk | ActionContextError

type ActionContextWithGateOk = ActionContextOk & { role: Role }

export type ActionContextWithGate = ActionContextWithGateOk | ActionContextError

/**
 * Common preamble for server actions: resolve profile + create Supabase client.
 *
 * Usage (read-only, no role gate):
 * ```ts
 * const ctx = await getActionContext()
 * if (!ctx.ok) return { error: ctx.error }
 * const { supabase, activeProfileId } = ctx
 * ```
 */
export async function getActionContext(): Promise<ActionContext> {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return { ok: false, error: 'Sin perfil activo' }
  }
  const supabase = await createClient()
  return { ok: true, supabase, activeProfileId }
}

/**
 * Common preamble for server actions that require a minimum role.
 *
 * Usage:
 * ```ts
 * const ctx = await getActionContextWithGate('editor')
 * if (!ctx.ok) return { error: ctx.error }
 * const { supabase, activeProfileId, role } = ctx
 * ```
 */
export async function getActionContextWithGate(
  minRole: Role,
): Promise<ActionContextWithGate> {
  const base = await getActionContext()
  if (!base.ok) return base
  const gate = await assertProfileMembership(base.supabase, base.activeProfileId, { minRole })
  if (!gate.ok) return { ok: false, error: gate.reason }
  return { ...base, role: gate.role }
}
