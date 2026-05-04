'use client'

import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { ProductPickerRow } from '@/app/actions/receipts'
import {
  applyStockCheckToInventory,
  type MeasureUnitRow,
  type NetContentOptionRow,
  type ProfileBrandRow,
  type ProfileCatalogRow,
  type StockCheckDetailHeader,
  type StockCheckDetailItem,
} from '@/app/actions/stock-checks'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { StockCheckAiPanel } from '@/components/stock-check-ai-panel'
import { StockCheckLineEditDialog } from '@/components/stock-check-line-edit-dialog'
import {
  formatConfidencePct,
  formatNetContent,
} from '@/lib/stock-check-scan-rows'
import type { StockCheckAiMeta } from '@/types/stock-check-ai-meta'

function zoneLabel(z: string): string {
  const m: Record<string, string> = {
    alacena: 'Alacena',
    refrigerador: 'Refrigerador',
    congelador: 'Congelador',
    bano: 'Baño / aseo',
    bodega: 'Bodega',
    otro: 'Otro',
  }
  return m[z] ?? z
}

export function StockCheckReviewDialog({
  open,
  onOpenChange,
  check,
  detailAiMeta,
  detailLoading,
  detailItems,
  products,
  brands,
  measureUnits,
  netContentOptions,
  productTypes,
  presentations,
  onApplySuccess,
  onReload,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  check: StockCheckDetailHeader | null
  detailAiMeta: StockCheckAiMeta | null
  detailLoading: boolean
  detailItems: StockCheckDetailItem[]
  products: ProductPickerRow[]
  brands: ProfileBrandRow[]
  measureUnits: MeasureUnitRow[]
  netContentOptions: NetContentOptionRow[]
  productTypes: ProfileCatalogRow[]
  presentations: ProfileCatalogRow[]
  onApplySuccess: () => void
  onReload: () => void
}) {
  const [applying, setApplying] = useState(false)
  const [lineEditItem, setLineEditItem] =
    useState<StockCheckDetailItem | null>(null)
  const [lineDialogOpen, setLineDialogOpen] = useState(false)

  const isReadOnly = check?.status === 'completed'
  const canApplyToInventory =
    !!check &&
    !isReadOnly &&
    check.status === 'awaiting_confirmation' &&
    !detailLoading

  async function onApply() {
    if (!check || !canApplyToInventory) return
    setApplying(true)
    try {
      const res = await applyStockCheckToInventory(check.id)
      if (!res.ok) {
        toast.error(res.error ?? 'No se pudo aplicar')
        return
      }
      toast.success(`Stock actualizado (${res.rowsApplied ?? 0} ítems)`)
      onApplySuccess()
    } finally {
      setApplying(false)
    }
  }

  function statusBadge(item: StockCheckDetailItem) {
    if (item.marked_invalid === true) {
      return (
        <span className="rounded-md bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
          Error lectura
        </span>
      )
    }
    if (item.accepted === true) {
      return (
        <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
          Aceptado
        </span>
      )
    }
    return (
      <span className="text-[11px] text-muted-foreground">Pendiente</span>
    )
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="flex max-h-[min(92vh,calc(100vh-1rem))] w-full max-w-[min(96rem,calc(100vw-1rem))] flex-col gap-4 p-4 sm:p-6"
          showCloseButton
        >
          <DialogHeader>
            <DialogTitle>
              {isReadOnly ? 'Ver chequeo de stock' : 'Revisar chequeo de stock'}
            </DialogTitle>
            {check && !detailLoading ? (
              <p className="text-[12px] text-muted-foreground">
                {zoneLabel(check.zone)} ·{' '}
                {new Date(check.created_at).toLocaleString('es')}
              </p>
            ) : null}
            {isReadOnly && check && !detailLoading ? (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
                Este chequeo ya se aplicó al inventario. Puedes consultar las
                lecturas, sin editar.
              </p>
            ) : null}
            {!detailLoading && !isReadOnly ? (
              <p className="text-[12px] text-muted-foreground">
                Abre cada fila con <strong>Editar</strong> para corregir datos,
                marcar lectura errónea o eliminar un producto mal leído.
              </p>
            ) : null}
          </DialogHeader>

          {detailLoading ? (
            <div
              className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border bg-muted/20 px-6 py-12"
              aria-busy="true"
              aria-live="polite"
            >
              <Loader2
                className="size-8 animate-spin text-primary"
                aria-hidden
              />
              <div className="w-full max-w-sm space-y-2 text-center">
                <p className="text-sm font-medium text-foreground">
                  Cargando lecturas del chequeo…
                </p>
                <p className="text-[12px] text-muted-foreground">
                  Un momento mientras se obtienen las líneas desde el servidor.
                </p>
                <div className="app-progress-indeterminate w-full pt-1" />
              </div>
            </div>
          ) : null}

          {!detailLoading && check ? (
            <StockCheckAiPanel meta={detailAiMeta} variant="block" />
          ) : null}

          {!detailLoading && check ? (
            <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto rounded-lg border border-border">
              <table className="w-full min-w-[800px] border-collapse text-left text-[12px]">
                <thead>
                  <tr className="sticky top-0 z-1 border-b border-border bg-muted/50">
                    <th className="px-2 py-2 font-semibold">Producto</th>
                    <th className="px-2 py-2 font-semibold">Marca</th>
                    <th className="px-2 py-2 font-semibold">Tipo</th>
                    <th className="px-2 py-2 font-semibold">Contenido neto</th>
                    <th className="px-2 py-2 text-right font-semibold">
                      Ud. vista
                    </th>
                    <th className="px-2 py-2 text-right font-semibold">
                      Conf.
                    </th>
                    <th className="px-2 py-2 font-semibold">Estado</th>
                    <th className="w-[100px] px-2 py-2 font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {detailItems.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-2 py-6 text-muted-foreground"
                      >
                        Sin ítems en este chequeo.
                      </td>
                    </tr>
                  ) : (
                    detailItems.map((item) => (
                      <tr
                        key={item.id}
                        className={
                          item.marked_invalid === true
                            ? 'border-b border-border/60 opacity-60'
                            : 'border-b border-border/80'
                        }
                      >
                        <td
                          className={`max-w-[220px] px-2 py-1.5 align-top font-medium ${
                            item.marked_invalid === true ? 'line-through' : ''
                          }`}
                        >
                          {item.name_guess}
                        </td>
                        <td className="max-w-[120px] px-2 py-1.5 align-top text-muted-foreground">
                          {item.brand_guess ?? '—'}
                        </td>
                        <td className="max-w-[160px] px-2 py-1.5 align-top text-muted-foreground">
                          {item.product_type_guess ?? '—'}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 align-top tabular-nums text-muted-foreground">
                          {formatNetContent(
                            item.net_quantity,
                            item.net_unit
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right align-top tabular-nums text-muted-foreground">
                          {item.quantity_guess != null
                            ? item.quantity_guess
                            : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right align-top tabular-nums text-muted-foreground">
                          {formatConfidencePct(item.confidence)}
                        </td>
                        <td className="px-2 py-1.5 align-top">
                          {statusBadge(item)}
                        </td>
                        <td className="px-2 py-1.5 align-top">
                          {isReadOnly ? (
                            <span className="text-[11px] text-muted-foreground">
                              —
                            </span>
                          ) : (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setLineEditItem(item)
                                setLineDialogOpen(true)
                              }}
                            >
                              Editar
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : null}

          {check && !detailLoading && !isReadOnly && !canApplyToInventory ? (
            <p className="text-[12px] text-muted-foreground">
              Para <strong>aplicar al inventario</strong> el estado del chequeo
              debe ser <strong>Pendiente confirmación</strong>. Aún puedes usar{' '}
              <strong>Editar</strong> en borrador o en procesamiento.
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cerrar
            </Button>
            <Button
              type="button"
              disabled={applying || !canApplyToInventory}
              onClick={() => void onApply()}
            >
              {applying ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Aplicando…
                </span>
              ) : (
                'Aplicar al inventario'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <StockCheckLineEditDialog
        open={lineDialogOpen}
        onOpenChange={(o) => {
          setLineDialogOpen(o)
          if (!o) setLineEditItem(null)
        }}
        item={lineEditItem}
        products={products}
        brands={brands}
        productTypes={productTypes}
        presentations={presentations}
        measureUnits={measureUnits}
        netContentOptions={netContentOptions}
        onSaved={() => {
          void onReload()
        }}
        onDeleted={() => {
          void onReload()
        }}
      />
    </>
  )
}
