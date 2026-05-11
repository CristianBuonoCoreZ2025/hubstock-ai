import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getProfileContext } from '@/lib/profile/context'
import { RetailPricingTab } from '@/app/(app)/catalog/RetailPricingTab'
import type { CategoryRow, SectionRow } from '@/app/(app)/catalog/CatalogTabs'

/** Barridos largos: máximo tiempo de función serverless (ajustar según plan del hosting). */
export const maxDuration = 300

export default async function PreciosCadenasPage() {
  const { activeProfileId, profiles } = await getProfileContext()

  if (!activeProfileId || profiles.length === 0) {
    return (
      <div className="app-page">
        <header className="app-page-header">
          <h1 className="app-page-title">Precios por cadena</h1>
          <p className="app-page-lead">Necesitas un perfil activo para usar esta herramienta.</p>
        </header>
      </div>
    )
  }

  const supabase = await createClient()
  const [{ data: sections, error: sectionsError }, { data: categories }] = await Promise.all([
    supabase.from('sections').select('id, name, sort_order').order('sort_order'),
    supabase.from('categories').select('id, name, section_id, sort_order').order('sort_order'),
  ])

  return (
    <div className="app-page">
      {sectionsError ?
        <p className="mb-4 text-sm text-destructive">
          No se pudo cargar la taxonomía del catálogo. Intenta nuevamente más tarde.
        </p>
      : null}

      <p className="mb-6 text-[13px] text-muted-foreground">
        Herramienta de administración para nutrir precios desde tiendas y homologarlos al{' '}
        <Link href="/catalog" className="text-primary underline underline-offset-2">
          catálogo maestro
        </Link>
        .
      </p>

      <RetailPricingTab
        sections={(sections ?? []) as SectionRow[]}
        categories={(categories ?? []) as CategoryRow[]}
      />
    </div>
  )
}
