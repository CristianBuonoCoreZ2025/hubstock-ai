'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  confirmScrappingSimilarityLinkAction,
  getScrappingSimilarityCandidatesAction,
  listScrappingSimilarityReviewPageAction,
  rejectScrappingSimilarityToPendingNewAction,
} from '@/app/actions/retail-scrapping'
import { GridPagingRow } from '@/components/grid/grid-paging-row'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ScrappingProductRow } from '@/server/retail/scrapping/lider-scrapping-service'
import type { ScrappingSimilarityManualCandidate } from '@/server/retail/scrapping/scrapping-similarity-manual'

const ROW_ACTION_BTN = 'h-9 min-w-[148px] shrink-0'

export type ScrappingSimilarityReviewModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  homologacionBloqueada: boolean
  onApplied: () => Promise<void>
}

export function ScrappingSimilarityReviewModal({
  open,
  onOpenChange,
  homologacionBloqueada,
  onApplied,
}: ScrappingSimilarityReviewModalProps) {
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<ScrappingProductRow[]>([])
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(100)
  const [gridBusy, setGridBusy] = useState(false)
  const [candidatesByRow, setCandidatesByRow] = useState<Record<string, ScrappingSimilarityManualCandidate[]>>({})
  const [candBusyByRow, setCandBusyByRow] = useState<Record<string, boolean>>({})
  const [selectionByRow, setSelectionByRow] = useState<Record<string, string>>({})
  const [rowActionBusy, setRowActionBusy] = useState<string | null>(null)

  const loadPage = useCallback(async (pageIndex: number) => {
    setGridBusy(true)
    try {
      const r = await listScrappingSimilarityReviewPageAction({ page: pageIndex })
      if (!r.ok) {
        toast.error(r.error)
        setRows([])
        setTotal(0)
        return
      }
      setRows(r.rows)
      setTotal(r.total)
      setPageSize(r.pageSize)
      setPage(pageIndex)
      setCandidatesByRow({})
      setCandBusyByRow({})
      setSelectionByRow({})
    } finally {
      setGridBusy(false)
    }
  }, [])

  useEffect(() => {
    if (!open || homologacionBloqueada) return
    void loadPage(0)
  }, [open, homologacionBloqueada, loadPage])

  const loadCandidatesForRow = useCallback(async (scrappingId: string) => {
    setCandBusyByRow((m) => ({ ...m, [scrappingId]: true }))
    try {
      const r = await getScrappingSimilarityCandidatesAction({ scrappingId })
      if (!r.ok) {
        toast.error(r.error)
        setCandidatesByRow((m) => ({ ...m, [scrappingId]: [] }))
        return
      }
      setCandidatesByRow((m) => ({ ...m, [scrappingId]: r.candidates }))
      if (r.candidates.length > 0) {
        const first = r.candidates[0]!.catalogProductId
        setSelectionByRow((m) => ({ ...m, [scrappingId]: m[scrappingId] ?? first }))
      }
    } finally {
      setCandBusyByRow((m) => ({ ...m, [scrappingId]: false }))
    }
  }, [])

  async function onConfirmLink(row: ScrappingProductRow) {
    const cand = candidatesByRow[row.id] ?? []
    const sel = selectionByRow[row.id] ?? cand[0]?.catalogProductId
    if (!sel) {
      toast.error('No hay maestro seleccionable. Cargá candidatos o usá «No / nuevo».')
      return
    }
    setRowActionBusy(row.id)
    try {
      const r = await confirmScrappingSimilarityLinkAction({
        scrappingId: row.id,
        catalogProductId: sel,
      })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success('Vínculo guardado y fila quitada de scrapping.')
      await loadPage(page)
      await onApplied()
    } finally {
      setRowActionBusy(null)
    }
  }

  async function onRejectNew(row: ScrappingProductRow) {
    setRowActionBusy(row.id)
    try {
      const r = await rejectScrappingSimilarityToPendingNewAction({ scrappingId: row.id })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.message('Marcado como producto nuevo (pendiente paso 3).')
      await loadPage(page)
      await onApplied()
    } finally {
      setRowActionBusy(null)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  const metaSuffix =
    total > 0 ?
      <>
        {' '}
        · {total.toLocaleString('es-CL')} fila(s) <span className="font-mono">pending</span>
      </>
    : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Paso 2 · Similitud (revisión manual)</DialogTitle>
          <DialogDescription>
            Candidatos filtrados por marca coherente, nombre (sugerencias del catálogo) y precio de referencia del
            maestro dentro de ±3000 CLP respecto al precio capturado (configurable con{' '}
            <span className="font-mono">SCRAPPING_SIMILARITY_PRICE_BAND_CLP</span>). Si no hay candidatos, podés
            marcar «No / nuevo». Abrí el combo para cargar candidatos.
          </DialogDescription>
        </DialogHeader>

        {homologacionBloqueada ?
          <p className="text-sm text-muted-foreground">
            No se puede revisar mientras haya scrapping en curso o barrido activo en esta vista.
          </p>
        : (
          <>
            <GridPagingRow
              pageIndex={page}
              pageSize={pageSize}
              disablePrev={gridBusy || page <= 0}
              disableNext={gridBusy || page + 1 >= totalPages}
              onPrev={() => void loadPage(page - 1)}
              onNext={() => void loadPage(page + 1)}
              metaSuffix={metaSuffix}
              className="mb-2 flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground"
            />

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                    <th className="px-2 py-2">Producto (scrapping)</th>
                    <th className="px-2 py-2">Marca</th>
                    <th className="px-2 py-2 tabular-nums">Precio</th>
                    <th className="min-w-[280px] px-2 py-2">Maestro sugerido</th>
                    <th className="px-2 py-2">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {gridBusy ?
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                        <Loader2 className="mx-auto mb-2 size-6 animate-spin" aria-hidden />
                        Cargando…
                      </td>
                    </tr>
                  : rows.length === 0 ?
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                        No hay filas pending para revisar en esta página.
                      </td>
                    </tr>
                  : (
                    rows.map((row) => {
                      const price =
                        typeof row.price === 'string' ? Number(row.price) : Number(row.price)
                      const priceTxt = Number.isFinite(price) ? `$${Math.round(price).toLocaleString('es-CL')}` : '—'
                      const cand = candidatesByRow[row.id]
                      const candBusy = candBusyByRow[row.id]
                      const effectiveSel = selectionByRow[row.id] ?? cand?.[0]?.catalogProductId
                      const rowBusy = rowActionBusy === row.id
                      const hasCand = cand !== undefined && cand.length > 0
                      const noCandLoaded = cand !== undefined && cand.length === 0

                      return (
                        <tr key={row.id} className="border-b border-border last:border-b-0">
                          <td className="max-w-[220px] px-2 py-2 align-top text-foreground">
                            <span className="line-clamp-3">{row.product_name}</span>
                          </td>
                          <td className="px-2 py-2 align-top text-muted-foreground">{row.brand?.trim() || '—'}</td>
                          <td className="px-2 py-2 align-top tabular-nums text-foreground">{priceTxt}</td>
                          <td className="px-2 py-2 align-top">
                            <Select
                              value={
                                hasCand && effectiveSel ? effectiveSel : undefined
                              }
                              onValueChange={(v) => {
                                setSelectionByRow((m) => ({ ...m, [row.id]: v }))
                              }}
                              onOpenChange={(isOpen) => {
                                if (isOpen && cand === undefined) void loadCandidatesForRow(row.id)
                              }}
                              disabled={rowBusy}
                            >
                              <SelectTrigger
                                size="sm"
                                className="h-9 w-full min-w-[240px] max-w-[420px] justify-between"
                                aria-label="Elegir maestro del catálogo"
                              >
                                <SelectValue
                                  placeholder={
                                    candBusy ? 'Cargando…'
                                    : noCandLoaded ? 'Sin candidatos en rango'
                                    : 'Abrir para cargar candidatos'
                                  }
                                />
                              </SelectTrigger>
                              <SelectContent position="popper" className="max-w-[min(90vw,480px)]">
                                {candBusy || cand === undefined ?
                                  <SelectItem value="__loading__" disabled>
                                    {candBusy ? 'Cargando…' : '…'}
                                  </SelectItem>
                                : cand.length === 0 ?
                                  <SelectItem value="__empty__" disabled>
                                    Sin candidatos (marca + nombre + ±3000 CLP)
                                  </SelectItem>
                                : (
                                  cand.map((c) => (
                                    <SelectItem key={c.catalogProductId} value={c.catalogProductId}>
                                      <span className="line-clamp-2">{c.label}</span>
                                    </SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-2 align-top">
                            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                              <Button
                                type="button"
                                size="sm"
                                className={ROW_ACTION_BTN}
                                disabled={rowBusy || candBusy || !hasCand || !effectiveSel}
                                onClick={() => void onConfirmLink(row)}
                              >
                                {rowBusy ?
                                  <Loader2 className="size-4 animate-spin" aria-hidden />
                                : null}
                                Vincular
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className={ROW_ACTION_BTN}
                                disabled={rowBusy}
                                onClick={() => void onRejectNew(row)}
                              >
                                No / nuevo
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            <GridPagingRow
              pageIndex={page}
              pageSize={pageSize}
              disablePrev={gridBusy || page <= 0}
              disableNext={gridBusy || page + 1 >= totalPages}
              onPrev={() => void loadPage(page - 1)}
              onNext={() => void loadPage(page + 1)}
              metaSuffix={metaSuffix}
              className="mt-3 flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground"
            />
          </>
        )}

        <DialogFooter className="gap-2 sm:justify-end">
          <Button type="button" variant="secondary" className="h-9 min-w-[120px]" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
