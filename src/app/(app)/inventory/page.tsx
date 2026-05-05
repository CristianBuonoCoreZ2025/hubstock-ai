import { createClient } from '@/lib/supabase/server'
import { PAGE_LEADS } from '@/lib/domain'
import { getProfileContext } from '@/lib/profile/context'
import { InventoryView } from './InventoryView'
import { buildInventoryRows } from './inventory-rows'

export default async function InventoryPage() {
  const { activeProfileId, profiles } = await getProfileContext()

  if (!activeProfileId || profiles.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Inventario</h1>
        <p className="text-sm text-muted-foreground">
          Necesitas un perfil activo para ver productos.
        </p>
      </div>
    )
  }

  const supabase = await createClient()

  const [
    { data: products, error: productsError },
    { data: categories },
    { data: sections },
  ] = await Promise.all([
    supabase
      .from('products')
      .select(
        'id, name, stock_current, stock_min, reference_price, category_id, section_id, active'
      )
      .eq('profile_id', activeProfileId)
      .eq('active', true)
      .order('name')
      .limit(500),
    supabase.from('categories').select('id, name, section_id, sort_order').order('sort_order'),
    supabase.from('sections').select('id, name, sort_order').order('sort_order'),
  ])

  if (productsError) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Inventario</h1>
        <p className="text-sm text-destructive">
          Error al cargar productos: {productsError.message}
        </p>
      </div>
    )
  }

  const categoryById = new Map((categories ?? []).map((c) => [c.id, c.name]))
  const sectionById = new Map((sections ?? []).map((s) => [s.id, s.name]))
  const rows = buildInventoryRows(products ?? [], categoryById, sectionById)

  return (
    <InventoryView
      lead={PAGE_LEADS.inventory}
      categories={categories ?? []}
      sections={sections ?? []}
      rows={rows}
    />
  )
}
