/*
 * Ruta: /app/(app)/precios-cadenas
 * Nombre de la página: PreciosCadenasPage
 */

import { redirect } from 'next/navigation'
import { RetailPricingTab } from '@/app/(app)/catalog/RetailPricingTab'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'Precios Cadenas | HubStock AI',
}

type SectionRow = {
  id: string
  name: string
  sort_order: number
}

type CategoryRow = {
  id: string
  name: string
  section_id: string
}

export default async function PreciosCadenasPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const [{ data: sections, error: sectionsError }, { data: categories, error: categoriesError }] =
    await Promise.all([
      supabase
        .from('sections')
        .select('id, name, sort_order')
        .order('sort_order', { ascending: true }),

      supabase
        .from('categories')
        .select('id, name, section_id')
        .order('name', { ascending: true }),
    ])

  const safeSections: SectionRow[] = (sections ?? []).map((section) => ({
    id: String(section.id),
    name: String(section.name),
    sort_order: Number(section.sort_order ?? 0),
  }))

  const safeCategories: CategoryRow[] = (categories ?? []).map((category) => ({
    id: String(category.id),
    name: String(category.name),
    section_id: String(category.section_id),
  }))

  return (
    <div className="app-page">
      <header className="app-page-header">
        <h1 className="app-page-title">Precios cadenas</h1>

        <p className="app-page-lead max-w-prose">
          Captura y homologa precios de retail contra el catálogo maestro.
          Primero resuelve la taxonomía, después captura productos vieja.
        </p>
      </header>

      {sectionsError ? (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          No se pudieron cargar las secciones del catálogo maestro.
        </div>
      ) : null}

      {categoriesError ? (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          No se pudieron cargar las categorías del catálogo maestro.
        </div>
      ) : null}

      <RetailPricingTab
        sections={safeSections}
        categories={safeCategories}
      />
    </div>
  )
}