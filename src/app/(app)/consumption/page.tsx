import { createClient } from '@/lib/supabase/server'
import { PAGE_LEADS } from '@/lib/domain'
import { getProfileContext } from '@/lib/profile/context'
import { ConsumptionView } from './ConsumptionView'

export default async function ConsumptionPage() {
  const { activeProfileId, profiles } = await getProfileContext()

  if (!activeProfileId || profiles.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Registrar consumo</h1>
        <p className="text-sm text-muted-foreground">
          Necesitas un perfil activo para registrar consumo.
        </p>
      </div>
    )
  }

  const supabase = await createClient()
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, stock_current')
    .eq('profile_id', activeProfileId)
    .eq('active', true)
    .order('name')
    .limit(400)

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Registrar consumo</h1>
        <p className="text-sm text-destructive">{error.message}</p>
      </div>
    )
  }

  const list =
    products?.map((p) => ({
      id: p.id,
      name: p.name,
      stock_current: Number(p.stock_current),
    })) ?? []

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Registrar consumo</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{PAGE_LEADS.consumption}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Movimiento registrado como{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">consumption</code> en{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">stock_movements</code>.
        </p>
      </div>
      <ConsumptionView products={list} />
    </div>
  )
}
