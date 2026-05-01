'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
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

  const { data, error } = await supabase
    .from('profiles')
    .insert({
      name,
      description: description.length > 0 ? description : null,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !data) {
    redirect('/profiles/new?error=insert_failed')
  }

  await setActiveProfileId(data.id)
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
