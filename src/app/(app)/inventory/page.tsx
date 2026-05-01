import { createClient } from '@/lib/supabase/server'
import { getProfileContext } from '@/lib/profile/context'

export default async function InventoryPage() {
  const { activeProfileId, profiles } = await getProfileContext()

  if (!activeProfileId || profiles.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">Inventario</h1>
        <p className="text-sm text-muted-foreground">
          Necesitas un perfil activo para ver productos.
        </p>
      </div>
    )
  }

  const supabase = await createClient()

  const [{ data: products, error: productsError }, { data: categories }] =
    await Promise.all([
      supabase
        .from('products')
        .select(
          'id, name, stock_current, reference_price, category_id, active'
        )
        .eq('profile_id', activeProfileId)
        .eq('active', true)
        .order('name')
        .limit(200),
      supabase.from('categories').select('id, name'),
    ])

  const categoryById = new Map(
    (categories ?? []).map((c) => [c.id, c.name])
  )

  const rows =
    products?.map((p) => ({
      id: p.id,
      name: p.name,
      categoryLabel: categoryById.get(p.category_id) ?? '—',
      quantity: Number(p.stock_current),
      price: p.reference_price != null ? Number(p.reference_price) : null,
    })) ?? []

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Inventario</h1>
      {productsError != null ? (
        <p className="text-sm text-destructive">
          Error al cargar productos: {productsError.message}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay productos activos en este perfil.
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left">
              <th className="p-3 font-medium">Nombre</th>
              <th className="p-3 font-medium">Categoría</th>
              <th className="p-3 font-medium">Cantidad</th>
              <th className="p-3 font-medium">Precio ref.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((product) => (
              <tr key={product.id} className="border-b border-border last:border-0">
                <td className="p-3">{product.name}</td>
                <td className="p-3">{product.categoryLabel}</td>
                <td className="p-3">{product.quantity}</td>
                <td className="p-3">
                  {product.price != null ? `$${product.price.toFixed(2)}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
