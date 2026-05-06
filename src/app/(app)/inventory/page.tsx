import { PAGE_LEADS } from '@/lib/domain'
import { getProfileContext } from '@/lib/profile/context'
import { InventoryView } from './InventoryView'
import { createClient } from '@/lib/supabase/server'
import { buildInventoryRows } from './inventory-rows'

type SearchParams = {
  page?: string
  q?: string
  section?: string
  category?: string
  status?: string
  inactive?: string
}

const PAGE_SIZE = 100

export default async function InventoryPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>
}) {
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

  const sp = (await searchParams) ?? {}
  const page = Math.max(1, Number(sp.page ?? 1) || 1)
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1
  const q = (sp.q ?? '').trim()
  const sectionFilter = (sp.section ?? 'all').trim()
  const categoryFilter = (sp.category ?? 'all').trim()
  const statusFilter = (sp.status ?? 'all').trim()
  const showInactive = sp.inactive === '1'

  const supabase = await createClient()

  const productsQuery = supabase
    .from('products')
    .select(
      'id, name, stock_current, stock_min, reference_price, category_id, section_id, active, catalog_product_id',
      { count: 'exact' }
    )
    .eq('profile_id', activeProfileId)
    .order('name')

  if (!showInactive) {
    productsQuery.eq('active', true)
  }
  if (sectionFilter !== 'all') {
    productsQuery.eq('section_id', sectionFilter)
  }
  if (categoryFilter !== 'all') {
    productsQuery.eq('category_id', categoryFilter)
  }

  // Búsqueda server-side: no es 100% “google-like” (acentos/orden), pero evita traer todo.
  // La búsqueda tolerante se aplica en el cliente dentro de la página.
  if (q.length >= 2) {
    productsQuery.ilike('name', `%${q}%`)
  }

  productsQuery.range(from, to)

  const [{ data: products, error: productsError, count }, { data: categories }, { data: sections }] =
    await Promise.all([
      productsQuery,
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
      query={{
        page,
        pageSize: PAGE_SIZE,
        total: count ?? null,
        q,
        section: sectionFilter,
        category: categoryFilter,
        status: statusFilter,
        inactive: showInactive,
      }}
    />
  )
}
