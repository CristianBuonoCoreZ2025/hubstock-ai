import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getProfileContext } from '@/lib/profile/context'
import { TRIP_PHASE_SHOPPING } from '@/lib/shopping-phase'
import { SupermarketClient, type SupermarketRow } from './SupermarketClient'

export default async function SupermarketPage() {
  const { activeProfileId, profiles } = await getProfileContext()

  if (!activeProfileId || profiles.length === 0) {
    return (
      <div className="app-page">
        <header className="app-page-header">
          <h1 className="app-page-title">Supermercado</h1>
          <p className="app-page-lead">Necesitas un perfil activo.</p>
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
    .maybeSingle()

  if (!trip || trip.notes !== TRIP_PHASE_SHOPPING) {
    return (
      <div className="app-page">
        <header className="app-page-header">
          <h1 className="app-page-title">Supermercado</h1>
          <p className="app-page-lead">
            Inicia el modo supermercado desde la lista de compras para ver ítems agrupados por pasillo.
          </p>
        </header>
        <Link href="/shopping-list" className="text-primary underline-offset-4 hover:underline">
          Ir a lista de compras
        </Link>
      </div>
    )
  }

  const { data: rawItems } = await supabase
    .from('shopping_trip_items')
    .select(
      `
      id,
      quantity_planned,
      quantity_bought,
      unit_price_paid,
      is_checked,
      products ( name, sections ( name ) )
    `
    )
    .eq('trip_id', trip.id)
    .order('sort_order', { ascending: true })

  const rows = (rawItems ?? []) as unknown as SupermarketRow[]

  const map = new Map<string, SupermarketRow[]>()
  for (const row of rows) {
    const sec = row.products?.sections?.name ?? 'Sin pasillo'
    if (!map.has(sec)) map.set(sec, [])
    map.get(sec)!.push(row)
  }

  const grouped = Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sectionName, r]) => ({ sectionName, rows: r }))

  return <SupermarketClient tripId={trip.id} grouped={grouped} />
}
