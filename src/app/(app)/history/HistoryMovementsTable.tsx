'use client'

import { useMemo, useState } from 'react'
import { AppSearchBox } from '@/components/search/app-search-box'
import { movementTypeLabel } from '@/lib/domain'
import { filterBySearch, normalizeSearchText } from '@/lib/search'

export type MovementRow = {
  id: string
  created_at: string
  delta: number
  movement_type: string
  note: string | null
  products: { name: string } | null
}

export function HistoryMovementsTable(props: {
  moves: MovementRow[]
  error: string | null
}) {
  const [qDraft, setQDraft] = useState('')
  const [qSubmitted, setQSubmitted] = useState('')

  const filtered = useMemo(() => {
    const rows = props.moves ?? []
    if (!normalizeSearchText(qSubmitted)) return rows
    return filterBySearch(rows, qSubmitted, (m) => {
      const product = m.products?.name ?? ''
      const tipo = movementTypeLabel(m.movement_type)
      const note = m.note ?? ''
      const delta = String(m.delta)
      return `${product} ${tipo} ${note} ${delta}`
    })
  }, [props.moves, qSubmitted])

  return (
    <>
      {props.error ? (
        <p className="app-page-lead text-destructive">{props.error}</p>
      ) : null}

      <div className="mb-4 max-w-md space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">Buscar en esta página</span>
        <AppSearchBox
          ariaLabel="Buscar en historial"
          placeholder="Producto, tipo, nota… (Enter o lupa)"
          value={qDraft}
          onChange={setQDraft}
          onSubmit={() => setQSubmitted(qDraft.trim())}
        />
      </div>

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
            {!filtered || filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-muted-foreground">
                  {props.moves?.length === 0
                    ? 'Aún no hay movimientos registrados.'
                    : 'No hay movimientos que coincidan con la búsqueda.'}
                </td>
              </tr>
            ) : (
              filtered.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap text-[13px] text-muted-foreground">
                    {new Date(m.created_at).toLocaleString('es')}
                  </td>
                  <td className="font-medium">{m.products?.name ?? '—'}</td>
                  <td>
                    <span className="text-[13px] font-medium">
                      {movementTypeLabel(m.movement_type)}
                    </span>
                  </td>
                  <td className="text-right tabular-nums">
                    {m.delta > 0 ? `+${m.delta}` : m.delta}
                  </td>
                  <td className="max-w-xs truncate text-muted-foreground text-xs">{m.note ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
