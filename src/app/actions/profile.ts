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

  // Insert con sesión del usuario: el trigger handle_new_profile usa auth.uid()
  // y crea la fila en profile_members (admin). Un segundo insert manual chocaba
  // con UNIQUE (profile_id, user_id) y hacía fallar toda la creación.
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
    console.error('Error creando perfil:', profileError)
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
    const { createServiceRoleClient } = await import('@/server/supabase-admin')
    const adminSupabase = createServiceRoleClient()
    const { error: memberError } = await adminSupabase
      .from('profile_members')
      .insert({
        profile_id: profileId,
        user_id: user.id,
        role: 'admin',
        status: 'active',
      } as never)
    if (memberError) {
      console.error('Error creando membresía (sin trigger en BD):', memberError)
      redirect('/profiles/new?error=insert_failed')
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

export async function updateActiveProfileSettings(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()

  if (name.length < 2) {
    return
  }

  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return
  }

  const supabase = await createClient()
  const { assertProfileMembership } = await import('@/lib/profile/membership')
  const gate = await assertProfileMembership(supabase, activeProfileId, { minRole: 'admin' })
  if (!gate.ok) {
    return
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      name,
      description: description.length > 0 ? description : null,
    })
    .eq('id', activeProfileId)

  if (error) {
    return
  }

  revalidatePath('/settings')
  revalidatePath('/', 'layout')
}
