import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getProfileContext } from '@/lib/profile/context'
import { assertProfileMembership } from '@/lib/profile/membership'
import { ProfileForm } from './ProfileForm'
import { SignOutPanel } from './SignOutPanel'

export default async function SettingsPage() {
  const { activeProfileId } = await getProfileContext()
  const supabase = await createClient()

  let name = ''
  let description: string | null = null
  let canEdit = false

  if (activeProfileId) {
    const adminGate = await assertProfileMembership(supabase, activeProfileId, {
      minRole: 'admin',
    })
    canEdit = adminGate.ok

    const { data: profile } = await supabase
      .from('profiles')
      .select('name, description')
      .eq('id', activeProfileId)
      .single()

    if (profile) {
      name = profile.name
      description = profile.description
    }
  }

  return (
    <div className="app-page">
      <header className="app-page-header">
        <h1 className="app-page-title">Configuración</h1>
        <p className="app-page-lead">Datos del hogar y sesión.</p>
      </header>

      <ProfileForm name={name} description={description} canEdit={canEdit} />

      <SignOutPanel />

      <p className="text-sm text-muted-foreground">
        <Link href="/menu" className="font-medium text-primary underline-offset-4 hover:underline">
          Volver al menú
        </Link>
      </p>
    </div>
  )
}
