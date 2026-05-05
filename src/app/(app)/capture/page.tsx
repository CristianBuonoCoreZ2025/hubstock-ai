import { createClient } from '@/lib/supabase/server'
import { PAGE_LEADS } from '@/lib/domain'
import { getProfileContext } from '@/lib/profile/context'
import { CaptureView } from './CaptureView'

export default async function CapturePage() {
  const { activeProfileId, profiles } = await getProfileContext()

  if (!activeProfileId || profiles.length === 0) {
    return (
      <div className="app-page">
        <header className="app-page-header">
          <h1 className="app-page-title">Captura de productos</h1>
          <p className="app-page-lead">
            Necesitas un perfil activo para usar esta función.
          </p>
        </header>
      </div>
    )
  }

  const supabase = await createClient()
  const [{ data: categories }, { data: sections }] = await Promise.all([
    supabase.from('categories').select('id, name, section_id, sort_order').order('sort_order'),
    supabase.from('sections').select('id, name, sort_order').order('sort_order'),
  ])

  return (
    <div className="app-page">
      <header className="app-page-header">
        <h1 className="app-page-title">Captura de productos</h1>
        <p className="app-page-lead">{PAGE_LEADS.capture}</p>
      </header>

      <CaptureView
        profileId={activeProfileId}
        categories={categories ?? []}
        sections={sections ?? []}
      />
    </div>
  )
}
