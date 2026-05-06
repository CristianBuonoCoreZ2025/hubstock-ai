import { createClient } from '@/lib/supabase/server'

import { getProfileContext } from '@/lib/profile/context'

import {

  CatalogTabs,

  type CategoryRow,

  type SectionRow,

} from './CatalogTabs'



export default async function CatalogPage() {

  const { activeProfileId, profiles } = await getProfileContext()



  if (!activeProfileId || profiles.length === 0) {

    return (

      <div className="app-page">

        <header className="app-page-header">

          <h1 className="app-page-title">Catálogo</h1>

          <p className="app-page-lead">

            Necesitas un perfil activo para usar el catálogo.

          </p>

        </header>

      </div>

    )

  }



  const supabase = await createClient()



  const [{ data: sections, error: sectionsError }, { data: categories }, { count: linkedCount, error: countError }] =

    await Promise.all([

      supabase.from('sections').select('id, name, sort_order').order('sort_order'),

      supabase.from('categories').select('id, name, section_id, sort_order').order('sort_order'),

      supabase

        .from('products')

        .select('id', { count: 'exact', head: true })

        .eq('profile_id', activeProfileId)

        .not('catalog_product_id', 'is', null),

    ])



  return (

    <div className="app-page">

      {sectionsError ? (

        <p className="mb-4 text-sm text-destructive">

          No se pudo cargar la taxonomía del catálogo. Intenta nuevamente más tarde.

        </p>

      ) : null}

      <CatalogTabs

        profileId={activeProfileId}

        sections={(sections ?? []) as SectionRow[]}

        categories={(categories ?? []) as CategoryRow[]}

        linkedCatalogCount={linkedCount ?? 0}

        countError={countError != null}

      />

    </div>

  )

}


