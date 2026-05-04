import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

export type ProfileOption = { id: string; name: string }

export async function getProfileContext(): Promise<{
  profiles: ProfileOption[]
  activeProfileId: string | null
}> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { profiles: [], activeProfileId: null }
  }

  // Unir perfiles invitados (RPC SECURITY DEFINER; migración 20260509100000)
  const { error: inviteRpcError } = await supabase.rpc(
    'accept_pending_invitations_for_current_user'
  )
  if (
    inviteRpcError &&
    !/function .* does not exist|schema cache/i.test(inviteRpcError.message ?? '')
  ) {
    console.warn('accept_pending_invitations_for_current_user:', inviteRpcError.message)
  }

  const { data: members } = await supabase
    .from('profile_members')
    .select('profile_id')
    .eq('user_id', user.id)
    .eq('status', 'active')

  const ids = members?.map((m) => m.profile_id) ?? []
  if (ids.length === 0) {
    return { profiles: [], activeProfileId: null }
  }

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, name')
    .in('id', ids)
    .order('name')

  const cookieStore = await cookies()
  const cookiePid = cookieStore.get('stockcasa_profile_id')?.value

  let activeProfileId: string | null = null
  if (cookiePid && ids.includes(cookiePid)) {
    activeProfileId = cookiePid
  } else {
    activeProfileId = ids[0] ?? null
  }

  return {
    profiles: (profiles ?? []).map((p) => ({ id: p.id, name: p.name })),
    activeProfileId,
  }
}
