import { getStockMovements } from '@/app/actions/history'
import { movementTypeLabel, PAGE_LEADS } from '@/lib/domain'

export default async function HistoryPage() {
  const { data: moves, error } = await getStockMovements(200)

  return (
    <div className="app-page">
      <header className="app-page-header">
        <h1 className="app-page-title">Historial de stock</h1>
        <p className="app-page-lead">{PAGE_LEADS.history}</p>
      </header>

      {error ? (
        <p className="app-page-lead text-destructive">{error}</p>
      ) : null}

      <div className="app-data-table-wrap">
        <table className="app-data-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Producto</th>
              <th>Tipo</th>
              <th className="text-right">Delta</th>
              <th>Nota</th>
            </tr>
          </thead>
          <tbody>
            {!moves || moves.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-muted-foreground">
                  Aún no hay movimientos registrados.
                </td>
              </tr>
            ) : (
              moves.map((m) => {
                const product = m.products as unknown as { name: string } | null
                return (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap text-[13px] text-muted-foreground">
                      {new Date(m.created_at).toLocaleString('es')}
                    </td>
                    <td className="font-medium">{product?.name ?? '—'}</td>
                    <td>
                      <span className="text-[13px] font-medium">{movementTypeLabel(m.movement_type)}</span>
                    </td>
                    <td className="text-right tabular-nums">
                      {m.delta > 0 ? `+${m.delta}` : m.delta}
                    </td>
                    <td className="max-w-xs truncate text-muted-foreground text-xs">
                      {m.note ?? '—'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
