import StatCard from '@/components/dashboard/StatCard'
import QuickActionCard from '@/components/dashboard/QuickActionCard'
import { PAGE_LEADS } from '@/lib/domain'
import {
  FileText,
  Package,
  Plus,
  ShoppingCart,
  Store,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getProfileContext } from '@/lib/profile/context'

export default async function DashboardPage() {
  const { profiles, activeProfileId } = await getProfileContext()

  if (!activeProfileId || profiles.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Crea un perfil para ver el resumen ejecutivo filtrado por hogar.
        </p>
      </div>
    )
  }

  const supabase = await createClient()

  const { count: productCount, error: productsError } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('profile_id', activeProfileId)

  const inventoryDisplay =
    productsError != null ? '—' : String(productCount ?? 0)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{PAGE_LEADS.dashboard}</p>
      </div>
      {productsError != null ? (
        <p className="text-sm text-amber-800 dark:text-amber-200">
          No se pudo cargar el conteo de productos: revisa RLS y la tabla{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">products</code>.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Productos"
          value={inventoryDisplay}
          description="En el perfil activo"
          icon={Package}
        />
        <StatCard
          title="Bajo mínimo"
          value="—"
          description="Se calculará con vista SQL (stock vs mínimo)"
          icon={ShoppingCart}
        />
        <StatCard
          title="Compras (viajes)"
          value="—"
          description="Módulo Compras / Tiendas — métricas pendientes"
          icon={Store}
        />
        <StatCard
          title="Boletas"
          value="—"
          description="Compras / historial de tickets — métricas pendientes"
          icon={FileText}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <QuickActionCard
          title="Inventario · carga manual"
          description="Ver inventario y registrar o editar ítems"
          icon={Plus}
          actionText="Abrir inventario"
          href="/inventory"
        />
        <QuickActionCard
          title="Compras"
          description="Planifica la lista y compra en cualquier tienda"
          icon={ShoppingCart}
          actionText="Abrir compras"
          href="/shopping-list"
        />
      </div>
    </div>
  )
}
