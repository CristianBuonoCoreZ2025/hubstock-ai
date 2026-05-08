import { getStockMovements } from '@/app/actions/history'
import {
  HistoryMovementsTable,
  type MovementRow,
} from '@/app/(app)/history/HistoryMovementsTable'
import { PAGE_LEADS } from '@/lib/domain'

export default async function HistoryPage() {
  const { data: moves, error } = await getStockMovements(200)

  const normalizedMoves: MovementRow[] = ((moves ?? []) as unknown[]).map((m: any) => {
    const productsRaw = m?.products ?? null
    const products =
      Array.isArray(productsRaw) ? (productsRaw[0] ?? null) : (productsRaw ?? null)

    return {
      id: String(m.id),
      created_at: String(m.created_at),
      delta: Number(m.delta ?? 0),
      movement_type: String(m.movement_type ?? ''),
      note: m.note ?? null,
      products: products && typeof products === 'object' ? { name: String(products.name ?? '') } : null,
    }
  })

  return (
    <div className="app-page">
      <header className="app-page-header">
        <h1 className="app-page-title">Historial de stock</h1>
        <p className="app-page-lead">{PAGE_LEADS.history}</p>
      </header>

      <HistoryMovementsTable moves={normalizedMoves} error={error} />
    </div>
  )
}
