'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getProfileContext } from '@/lib/profile/context'
import { assertProfileMembership } from '@/lib/profile/membership'
import type { ProfileMemberRole } from '@/types/database'

export async function getTeamData() {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return { members: [], invitations: [], error: null as string | null, isAdmin: false }
  }

  const supabase = await createClient()
  const adminGate = await assertProfileMembership(supabase, activeProfileId, {
    minRole: 'admin',
  })

  const { data: members, error: me } = await supabase
    .from('profile_members')
    .select('id, user_id, role, status')
    .eq('profile_id', activeProfileId)
    .order('created_at', { ascending: true })

  let invitations: {
    id: string
    email: string
    role: ProfileMemberRole
    status: string
    expires_at: string
  }[] = []

  if (adminGate.ok) {
    const { data: inv, error: ie } = await supabase
      .from('invitations')
      .select('id, email, role, status, expires_at')
      .eq('profile_id', activeProfileId)
      .order('created_at', { ascending: false })

    if (!ie && inv) invitations = inv as typeof invitations
  }

  return {
    members: members ?? [],
    invitations,
    error: me?.message ?? null,
    isAdmin: adminGate.ok,
  }
}

export async function createInvitation(formData: FormData) {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()
  const role = String(formData.get('role') ?? 'viewer') as ProfileMemberRole

  if (!email || !email.includes('@')) {
    return { error: 'Correo inválido' }
  }

  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) return { error: 'No active profile' }

  const supabase = await createClient()
  const gate = await assertProfileMembership(supabase, activeProfileId, { minRole: 'admin' })
  if (!gate.ok) return { error: 'Solo administradores' }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase.from('invitations').insert({
    profile_id: activeProfileId,
    email,
    role: ['admin', 'editor', 'viewer'].includes(role) ? role : 'viewer',
    token: crypto.randomUUID(),
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    invited_by: user.id,
    status: 'pending',
  })

  if (error) return { error: error.message }
  revalidatePath('/users')
  return { success: true }
}

export async function updateMemberRole(memberRowId: string, role: ProfileMemberRole) {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) return { error: 'No active profile' }

  const supabase = await createClient()
  const gate = await assertProfileMembership(supabase, activeProfileId, { minRole: 'admin' })
  if (!gate.ok) return { error: 'Solo administradores' }

  const r = ['admin', 'editor', 'viewer'].includes(role) ? role : 'viewer'

  const { error } = await supabase
    .from('profile_members')
    .update({ role: r })
    .eq('id', memberRowId)
    .eq('profile_id', activeProfileId)

  if (error) return { error: error.message }
  revalidatePath('/users')
  revalidatePath('/', 'layout')
  return { success: true }
}

export async function deactivateMember(memberRowId: string) {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) return { error: 'No active profile' }

  const supabase = await createClient()
  const gate = await assertProfileMembership(supabase, activeProfileId, { minRole: 'admin' })
  if (!gate.ok) return { error: 'Solo administradores' }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: row } = await supabase
    .from('profile_members')
    .select('user_id')
    .eq('id', memberRowId)
    .eq('profile_id', activeProfileId)
    .single()

  if (row?.user_id === user.id) {
    return { error: 'No puedes desactivarte a ti mismo' }
  }

  const { error } = await supabase
    .from('profile_members')
    .update({ status: 'inactive' })
    .eq('id', memberRowId)
    .eq('profile_id', activeProfileId)

  if (error) return { error: error.message }
  revalidatePath('/users')
  revalidatePath('/', 'layout')
  return { success: true }
}
