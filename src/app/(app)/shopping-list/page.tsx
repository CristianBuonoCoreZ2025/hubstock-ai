import { createClient } from '@/lib/supabase/server'
import { getProfileContext } from '@/lib/profile/context'
import { ShoppingListClient } from './ShoppingListClient'

export default async function ShoppingListPage() {
  const { activeProfileId, profiles } = await getProfileContext()

  if (!activeProfileId || profiles.length === 0) {
    return (
      <div className="app-page">
        <header className="app-page-header">
          <h1 className="app-page-title">Lista de compras</h1>
          <p className="app-page-lead">Selecciona un perfil activo para planificar compras.</p>
        </header>
      </div>
    )
  }

  const supabase = await createClient()

  const { data: trip } = await supabase
    .from('shopping_trips')
    .select('id, notes')
    .eq('profile_id', activeProfileId)
    .is('completed_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const tripId = trip?.id ?? null

  const [{ data: items }, { data: products }] = await Promise.all([
    tripId
      ? supabase
          .from('shopping_trip_items')
          .select(
            `
            id,
            quantity_planned,
            product_id,
            products ( name, sections ( name ) )
          `
          )
          .eq('trip_id', tripId)
          .order('sort_order', { ascending: true })
      : Promise.resolve({ data: [] as never[] }),
    supabase
      .from('products')
      .select('id, name')
      .eq('profile_id', activeProfileId)
      .eq('active', true)
      .order('name')
      .limit(500),
  ])

  return (
    <ShoppingListClient
      tripId={tripId}
      phaseNotes={trip?.notes ?? null}
      items={(items ?? []) as never}
      products={products ?? []}
    />
  )
}
