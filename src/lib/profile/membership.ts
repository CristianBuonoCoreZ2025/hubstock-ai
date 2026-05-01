import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const roleOrder = { viewer: 0, editor: 1, admin: 2 } as const

type Role = keyof typeof roleOrder

export async function assertProfileMembership(
  supabase: SupabaseClient<Database>,
  profileId: string,
  options?: { minRole?: Role }
): Promise<{ ok: true; role: Role } | { ok: false; reason: string }> {
  const minRole: Role = options?.minRole ?? 'viewer'
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) {
    return { ok: false, reason: 'no_session' }
  }

  const { data, error } = await supabase
    .from('profile_members')
    .select('role, status')
    .eq('profile_id', profileId)
    .eq('user_id', userData.user.id)
    .maybeSingle()

  if (error) {
    return { ok: false, reason: error.message }
  }

  type MemberRow = Pick<
    Database['public']['Tables']['profile_members']['Row'],
    'role' | 'status'
  >
  const row = data as MemberRow | null

  if (!row || row.status !== 'active') {
    return { ok: false, reason: 'not_member' }
  }

  const role = row.role as Role
  if (roleOrder[role] < roleOrder[minRole]) {
    return { ok: false, reason: 'insufficient_role' }
  }

  return { ok: true, role }
}
