import StatCard from '@/components/dashboard/StatCard'
import QuickActionCard from '@/components/dashboard/QuickActionCard'
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
          Crea un perfil para ver métricas de inventario filtradas por hogar.
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
      <h1 className="text-2xl font-bold">Dashboard</h1>
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
          title="Supermercado"
          value="—"
          description="Viajes en el historial (pendiente de vistas)"
          icon={Store}
        />
        <StatCard
          title="Boletas"
          value="—"
          description="Importadas y revisadas"
          icon={FileText}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <QuickActionCard
          title="Agregar producto"
          description="Ir al inventario y registrar ítems"
          icon={Plus}
          actionText="Abrir inventario"
          href="/inventory"
        />
        <QuickActionCard
          title="Lista de compras"
          description="Generación automática según mínimos e ideal"
          icon={ShoppingCart}
          actionText="Ver lista"
          href="/shopping-list"
        />
      </div>
    </div>
  )
}
