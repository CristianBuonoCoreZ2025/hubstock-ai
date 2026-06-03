'use server'

import { revalidatePath } from 'next/cache'
import { getActionContext, getActionContextWithGate } from '@/lib/action-context'
import { createClient } from '@/lib/supabase/server'
import { assertProfileMembership } from '@/lib/profile/membership'
import type { ProfileMemberRole } from '@/types/database'

export type TeamInvitationRow = {
  id: string
  profile_id: string
  email: string
  role: ProfileMemberRole
  status: string
  expires_at: string
  invitation_targets?: { profile_id: string }[] | null
}

export async function getTeamData() {
  const ctx = await getActionContext()
  if (!ctx.ok) {
    return {
      members: [],
      invitations: [] as TeamInvitationRow[],
      adminProfileIds: [] as string[],
      error: null as string | null,
      isAdmin: false,
    }
  }
  const { supabase, activeProfileId } = ctx
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const adminGate = await assertProfileMembership(supabase, activeProfileId, {
    minRole: 'admin',
  })

  let adminProfileIds: string[] = []
  if (user) {
    const { data: admins } = await supabase
      .from('profile_members')
      .select('profile_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .eq('role', 'admin')

    adminProfileIds = [...new Set((admins ?? []).map((r) => r.profile_id).filter(Boolean))]
  }

  const { data: members, error: me } = await supabase
    .from('profile_members')
    .select('id, user_id, role, status')
    .eq('profile_id', activeProfileId)
    .order('created_at', { ascending: true })

  let invitations: TeamInvitationRow[] = []

  if (adminGate.ok) {
    const { data: inv, error: ie } = await supabase
      .from('invitations')
      .select(
        `
        id,
        profile_id,
        email,
        role,
        status,
        expires_at,
        invitation_targets ( profile_id )
      `
      )
      .eq('profile_id', activeProfileId)
      .eq('status', 'pending')
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })

    if (!ie && inv) invitations = inv as TeamInvitationRow[]
  }

  return {
    members: members ?? [],
    invitations,
    adminProfileIds,
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

  const ctx = await getActionContextWithGate('admin')
  if (!ctx.ok) return { error: ctx.error }
  const { supabase, activeProfileId } = ctx

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Sesión inválida' }

  const normalizedRole: ProfileMemberRole = ['admin', 'editor', 'viewer'].includes(role) ? role : 'viewer'
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const { error } = await supabase.from('invitations').insert({
    profile_id: activeProfileId,
    email,
    role: normalizedRole,
    token: crypto.randomUUID(),
    expires_at: expiresAt,
    invited_by: user.id,
    status: 'pending',
  })
  if (error) return { error: error.message }

  revalidatePath('/users')
  return { success: true as const, inserted: 1 }
}

/** Hogares adicionales (además del ancla invitations.profile_id). */
export async function syncInvitationExtraProfiles(invitationId: string, extraProfileIds: string[]) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Sesión inválida' }

  const { data: inv, error: invErr } = await supabase
    .from('invitations')
    .select('id, profile_id, status, expires_at')
    .eq('id', invitationId)
    .maybeSingle()

  if (invErr || !inv) return { error: 'Invitación no encontrada' }
  if (inv.status !== 'pending') return { error: 'La invitación ya no está pendiente' }
  if (new Date(inv.expires_at) <= new Date()) return { error: 'La invitación expiró' }

  const anchorGate = await assertProfileMembership(supabase, inv.profile_id, {
    minRole: 'admin',
  })
  if (!anchorGate.ok) return { error: 'Sin permiso sobre esta invitación' }

  const extras = [...new Set(extraProfileIds.filter(Boolean))].filter((id) => id !== inv.profile_id)

  for (const pid of extras) {
    const g = await assertProfileMembership(supabase, pid, { minRole: 'admin' })
    if (!g.ok) return { error: 'Solo puedes enlazar hogares donde eres administrador' }
  }

  const { error: delErr } = await supabase
    .from('invitation_targets')
    .delete()
    .eq('invitation_id', invitationId)
  if (delErr) return { error: delErr.message }

  if (extras.length > 0) {
    const { error: insErr } = await supabase.from('invitation_targets').insert(
      extras.map((profile_id) => ({
        invitation_id: invitationId,
        profile_id,
      }))
    )
    if (insErr) return { error: insErr.message }
  }

  revalidatePath('/users')
  return { success: true as const }
}

export async function revokeInvitation(invitationId: string) {
  const supabase = await createClient()

  const { data: inv } = await supabase
    .from('invitations')
    .select('id, profile_id, status')
    .eq('id', invitationId)
    .maybeSingle()

  if (!inv || inv.status !== 'pending') return { error: 'Invitación no disponible' }

  const anchorGate = await assertProfileMembership(supabase, inv.profile_id, {
    minRole: 'admin',
  })
  if (!anchorGate.ok) return { error: 'Sin permiso' }

  const { error } = await supabase
    .from('invitations')
    .update({ status: 'revoked' })
    .eq('id', invitationId)
    .eq('status', 'pending')

  if (error) return { error: error.message }

  revalidatePath('/users')
  return { success: true as const }
}

export async function updateMemberRole(memberRowId: string, role: ProfileMemberRole) {
  const ctx = await getActionContextWithGate('admin')
  if (!ctx.ok) return { error: ctx.error }
  const { supabase, activeProfileId } = ctx

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
  const ctx = await getActionContextWithGate('admin')
  if (!ctx.ok) return { error: ctx.error }
  const { supabase, activeProfileId } = ctx

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
