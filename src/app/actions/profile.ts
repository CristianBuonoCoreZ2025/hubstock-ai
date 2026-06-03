'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getProfileContext } from '@/lib/profile/context'
import { createClient } from '@/lib/supabase/server'

export async function createProfile(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim()
  if (name.length < 2) {
    redirect('/profiles/new?error=invalid_name')
  }
  const description = String(formData.get('description') ?? '').trim()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login?next=/profiles/new')
  }

  // Insert + .select('id'): RLS debe permitir SELECT al creador (policy profiles_select_creator),
  // porque is_profile_member aún puede ser false hasta que exista profile_members / trigger.
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .insert({
      name,
      description: description.length > 0 ? description : null,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (profileError || !profile) {
    console.error(
      'Error creando perfil:',
      profileError?.code ?? profileError?.message,
      profileError,
    )
    redirect('/profiles/new?error=insert_failed')
  }

  const profileId = profile.id

  const { data: existingMember } = await supabase
    .from('profile_members')
    .select('id')
    .eq('profile_id', profileId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!existingMember) {
    const memberRow = {
      profile_id: profileId,
      user_id: user.id,
      role: 'admin' as const,
      status: 'active' as const,
    }

    // Primero como usuario autenticado (necesita policy creator_bootstrap en BD).
    const { error: selfMemberError } = await supabase.from('profile_members').insert(memberRow)

    if (selfMemberError) {
      try {
        const { createServiceRoleClient } = await import('@/server/supabase-admin')
        const adminSupabase = createServiceRoleClient()
        const { error: memberError } = await adminSupabase
          .from('profile_members')
          .insert(memberRow as never)
        if (memberError) {
          console.error(
            'Error creando membresía (usuario + service_role):',
            selfMemberError,
            memberError,
          )
          redirect('/profiles/new?error=insert_failed')
        }
      } catch (adminErr) {
        console.error(
          'Error creando membresía (sin policy bootstrap y sin service role válido):',
          selfMemberError,
          adminErr,
        )
        redirect('/profiles/new?error=insert_failed')
      }
    }
  }

  await setActiveProfileId(profileId)
  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function setActiveProfileId(profileId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false as const, error: 'no_session' }
  }

  const { data, error } = await supabase
    .from('profile_members')
    .select('id')
    .eq('profile_id', profileId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (error || !data) {
    return { ok: false as const, error: 'not_member' }
  }

  const cookieStore = await cookies()
  cookieStore.set('stockcasa_profile_id', profileId, {
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 400,
  })

  revalidatePath('/', 'layout')
  return { ok: true as const }
}

export async function updateActiveProfileSettings(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()

  if (name.length < 2) {
    return { ok: false, error: 'El nombre debe tener al menos 2 caracteres.' }
  }

  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return { ok: false, error: 'Sin perfil activo.' }
  }

  const supabase = await createClient()
  const { assertProfileMembership } = await import('@/lib/profile/membership')
  const gate = await assertProfileMembership(supabase, activeProfileId, { minRole: 'admin' })
  if (!gate.ok) {
    return { ok: false, error: 'Solo administradores pueden editar el perfil.' }
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      name,
      description: description.length > 0 ? description : null,
    })
    .eq('id', activeProfileId)

  if (error) {
    console.error('Error actualizando perfil:', error)
    return { ok: false, error: 'No se pudo guardar el perfil. Intenta nuevamente.' }
  }

  revalidatePath('/settings')
  revalidatePath('/', 'layout')
  return { ok: true }
}
