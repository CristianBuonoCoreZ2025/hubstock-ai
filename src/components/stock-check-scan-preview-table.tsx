import type { StockCheckScanRow } from '@/lib/stock-check-scan-rows'
import {
  formatConfidencePct,
  formatNetContent,
} from '@/lib/stock-check-scan-rows'

/** Tabla previa solo lectura tras analizar (antes de guardar). */
export function StockCheckScanPreviewTable({
  rows,
}: {
  rows: StockCheckScanRow[]
}) {
  if (rows.length === 0) return null
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[720px] border-collapse text-left text-[12px]">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="px-2 py-2 font-semibold">Producto</th>
            <th className="px-2 py-2 font-semibold">Marca</th>
            <th className="px-2 py-2 font-semibold">Tipo</th>
            <th className="px-2 py-2 font-semibold">Presentación</th>
            <th className="px-2 py-2 font-semibold">Contenido neto</th>
            <th className="px-2 py-2 font-semibold">Ud. visibles</th>
            <th className="px-2 py-2 font-semibold">Conf.</th>
            <th className="px-2 py-2 font-semibold">Notas</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/80">
              <td className="max-w-[180px] px-2 py-1.5 align-top font-medium text-foreground">
                {r.nameGuess}
              </td>
              <td className="max-w-[120px] px-2 py-1.5 align-top text-muted-foreground">
                {r.brandGuess ?? '—'}
              </td>
              <td className="max-w-[140px] px-2 py-1.5 align-top text-muted-foreground">
                {r.productType ?? '—'}
              </td>
              <td className="max-w-[120px] px-2 py-1.5 align-top text-muted-foreground">
                {r.presentation ?? '—'}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 align-top tabular-nums text-muted-foreground">
                {formatNetContent(r.netQuantity, r.netUnit)}
              </td>
              <td className="px-2 py-1.5 text-right align-top tabular-nums text-muted-foreground">
                {r.quantityGuess != null ? r.quantityGuess : '—'}
              </td>
              <td className="px-2 py-1.5 text-right align-top tabular-nums text-muted-foreground">
                {formatConfidencePct(r.confidence)}
              </td>
              <td className="max-w-[160px] px-2 py-1.5 align-top text-muted-foreground">
                {r.notes ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
