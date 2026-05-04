import { createClient } from '@/lib/supabase/server'
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
    supabase.from('categories').select('id, name').order('name'),
    supabase.from('sections').select('id, name').order('name'),
  ])

  return (
    <div className="app-page">
      <header className="app-page-header">
        <h1 className="app-page-title">Captura de productos</h1>
        <p className="app-page-lead">
          Foto del producto → análisis con IA → confirmación y alta en el
          inventario del hogar (tras revisar categoría y sección).
        </p>
      </header>

      <CaptureView
        profileId={activeProfileId}
        categories={categories ?? []}
        sections={sections ?? []}
      />
    </div>
  )
}
