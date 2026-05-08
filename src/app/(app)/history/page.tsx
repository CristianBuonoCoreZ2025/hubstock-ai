import { getStockMovements } from '@/app/actions/history'
import {
  HistoryMovementsTable,
  type MovementRow,
} from '@/app/(app)/history/HistoryMovementsTable'
import { PAGE_LEADS } from '@/lib/domain'

export default async function HistoryPage() {
  const { data: moves, error } = await getStockMovements(200)

  return (
    <div className="app-page">
      <header className="app-page-header">
        <h1 className="app-page-title">Historial de stock</h1>
        <p className="app-page-lead">{PAGE_LEADS.history}</p>
      </header>

      <HistoryMovementsTable moves={(moves ?? []) as MovementRow[]} error={error} />
    </div>
  )
}
