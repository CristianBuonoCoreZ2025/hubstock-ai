'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Play, PlusCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
  fetchScrappingRowsPageAction,
  listScrappingRunsAction,
  processLiderScrappingRunPageAction,
  startLiderScrappingRunAction,
} from '@/app/actions/retail-scrapping'
import type { ScrappingProductRow, ScrappingRunRow } from '@/server/retail/scrapping/lider-scrapping-service'
import { Button } from '@/components/ui/button'
import { GridPagingRow } from '@/components/grid/grid-paging-row'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const TOOLBAR_BTN = 'h-9 min-w-[190px] shrink-0'

function formatMoneyCl(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(n)
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-CL', {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

function shortenUrl(u: string, max = 56): string {
  if (u.length <= max) return u
  return `${u.slice(0, max - 1)}…`
}

export function CapturaCadenas2Client() {
  const [runs, setRuns] = useState<ScrappingRunRow[]>([])
  const [runsBusy, setRunsBusy] = useState(true)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)

  const [startBusy, setStartBusy] = useState(false)
  const [processBusy, setProcessBusy] = useState(false)

  const [rows, setRows] = useState<ScrappingProductRow[]>([])
  const [gridPage, setGridPage] = useState(0)
  const [gridTotal, setGridTotal] = useState(0)
  const [gridPageSize, setGridPageSize] = useState(100)
  const [gridBusy, setGridBusy] = useState(false)

  const effectiveRunId = useMemo(() => {
    if (activeRunId && runs.some((r) => r.id === activeRunId)) return activeRunId
    return runs[0]?.id ?? null
  }, [activeRunId, runs])

  const activeRun = useMemo(
    () => (effectiveRunId ? runs.find((r) => r.id === effectiveRunId) ?? null : null),
    [runs, effectiveRunId],
  )

  const reloadRuns = useCallback(async () => {
    setRunsBusy(true)
    const res = await listScrappingRunsAction()
    setRunsBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setRuns(res.runs)
    setActiveRunId((prev) => {
      if (prev && res.runs.some((r) => r.id === prev)) return prev
      return res.runs[0]?.id ?? null
    })
  }, [])

  useEffect(() => {
    void reloadRuns()
  }, [reloadRuns])

  const loadGrid = useCallback(async () => {
    if (!effectiveRunId) {
      setRows([])
      setGridTotal(0)
      return
    }
    setGridBusy(true)
    const res = await fetchScrappingRowsPageAction({ runId: effectiveRunId, page: gridPage })
    setGridBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      setRows([])
      setGridTotal(0)
      return
    }
    setRows(res.rows)
    setGridTotal(res.total)
    setGridPageSize(res.pageSize)
  }, [effectiveRunId, gridPage])

  useEffect(() => {
    void loadGrid()
  }, [loadGrid])

  async function onStartFull() {
    if (startBusy || processBusy) return
    setStartBusy(true)
    const res = await startLiderScrappingRunAction()
    setStartBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(`Ejecución creada. Cola inicial: ${res.totalPages} URL(s) de listado.`)
    setActiveRunId(res.runId)
    setGridPage(0)
    await reloadRuns()
  }

  async function onProcessOnce() {
    if (!effectiveRunId || processBusy) return
    setProcessBusy(true)
    const res = await processLiderScrappingRunPageAction({ runId: effectiveRunId })
    setProcessBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    if (res.error) {
      toast.error(res.error)
    } else if (res.done) {
      toast.message('Cola de páginas terminada para esta ejecución.')
    } else {
      toast.message(
        `Página ${res.pageIndex + 1}: ${res.productsThisPage} vistos · ${res.rowsWritten} filas limpias guardadas.`,
      )
    }
    await reloadRuns()
    await loadGrid()
  }

  async function onProcessTen() {
    if (!effectiveRunId || processBusy) return
    setProcessBusy(true)
    try {
      for (let i = 0; i < 10; i += 1) {
        const res = await processLiderScrappingRunPageAction({ runId: effectiveRunId })
        if (!res.ok) {
          toast.error(res.error)
          break
        }
        if (res.error) {
          toast.error(res.error)
          break
        }
        if (res.done) {
          toast.message('Cola de páginas terminada.')
          break
        }
      }
    } finally {
      setProcessBusy(false)
      await reloadRuns()
      await loadGrid()
    }
  }

  const totalGridPages = Math.max(1, Math.ceil(gridTotal / Math.max(1, gridPageSize)))
  const disablePrev = gridPage <= 0
  const disableNext = gridPage + 1 >= totalGridPages || gridTotal === 0

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <p className="text-sm font-medium text-foreground">Ejecución</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada ejecución es un barrido completo desde cero: cola de listados Lider → tabla{' '}
          <code className="rounded bg-muted px-1">scrapping</code> con URL de producto, nombre, marca, precio,
          cadena y fecha de extracción. El análisis es aparte; aquí solo acumulamos datos.
        </p>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="min-w-[240px] flex-1">
            {runs.length === 0 && !runsBusy ? (
              <p className="text-sm text-muted-foreground">Aún no hay ejecuciones. Creá una con el botón de la derecha.</p>
            ) : (
              <Select
                value={effectiveRunId ?? ''}
                onValueChange={(v) => {
                  setActiveRunId(v)
                  setGridPage(0)
                }}
                disabled={runsBusy || runs.length === 0}
              >
                <SelectTrigger aria-label="Elegir ejecución de scrapping">
                  <SelectValue placeholder={runsBusy ? 'Cargando…' : 'Elegir ejecución'} />
                </SelectTrigger>
                <SelectContent>
                  {runs.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {formatWhen(r.started_at)} · {r.status} · págs. {r.pages_done}/
                      {r.total_pages ?? '—'} · filas ~{Number(r.rows_inserted ?? 0)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <Button
            type="button"
            className={TOOLBAR_BTN}
            onClick={() => void onStartFull()}
            disabled={startBusy || processBusy}
          >
            {startBusy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <PlusCircle className="mr-2 h-4 w-4" aria-hidden />
            )}
            Nueva ejecución full Lider
          </Button>

          <Button
            type="button"
            variant="outline"
            className={TOOLBAR_BTN}
            onClick={() => void onProcessOnce()}
            disabled={!effectiveRunId || processBusy || startBusy}
          >
            {processBusy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Play className="mr-2 h-4 w-4" aria-hidden />
            )}
            Procesar 1 página
          </Button>

          <Button
            type="button"
            variant="outline"
            className={TOOLBAR_BTN}
            onClick={() => void onProcessTen()}
            disabled={!effectiveRunId || processBusy || startBusy}
          >
            Procesar 10 páginas
          </Button>
        </div>

        {activeRun ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Estado: {activeRun.status}. Último mensaje servidor:{' '}
            {activeRun.error_message ? (
              <span className="text-amber-700">{activeRun.error_message}</span>
            ) : (
              '—'
            )}
          </p>
        ) : null}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Filas en scrapping</h2>
          <span className="text-xs text-muted-foreground">
            Total: {gridTotal} · Página datos {gridPage + 1}/{totalGridPages}
          </span>
        </div>

        <GridPagingRow
          disablePrev={disablePrev || gridBusy}
          disableNext={disableNext || gridBusy}
          onPrev={() => setGridPage((p) => Math.max(0, p - 1))}
          onNext={() => setGridPage((p) => p + 1)}
          pageIndex={gridPage}
          pageSize={gridPageSize}
          metaSuffix={
            gridTotal ? (
              <>
                {' '}
                · Total filas {gridTotal}
              </>
            ) : null
          }
        />

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="app-data-table w-full min-w-[960px] text-sm">
            <thead>
              <tr>
                <th className="text-left">Producto</th>
                <th className="text-left">Marca</th>
                <th className="text-left">Precio</th>
                <th className="text-left">Cadena</th>
                <th className="text-left">Extracción</th>
                <th className="text-left">URL producto</th>
                <th className="text-left">URL listado</th>
              </tr>
            </thead>
            <tbody>
              {gridBusy ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin" aria-hidden />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    {effectiveRunId ?
                      'No hay filas aún. Procesá páginas de la cola o iniciá una ejecución nueva.'
                    : 'Iniciá una ejecución o elegí una existente.'}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td className="max-w-[220px] align-top">{row.product_name}</td>
                    <td className="align-top">{row.brand ?? '—'}</td>
                    <td className="align-top tabular-nums">{formatMoneyCl(Number(row.price))}</td>
                    <td className="align-top">{row.source_chain}</td>
                    <td className="align-top text-xs text-muted-foreground">
                      {formatWhen(row.extracted_at)}
                    </td>
                    <td className="max-w-[200px] align-top font-mono text-[11px]">
                      <span title={row.product_url}>{shortenUrl(row.product_url)}</span>
                    </td>
                    <td className="max-w-[200px] align-top font-mono text-[11px]">
                      <span title={row.listing_url}>{shortenUrl(row.listing_url)}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <GridPagingRow
          disablePrev={disablePrev || gridBusy}
          disableNext={disableNext || gridBusy}
          onPrev={() => setGridPage((p) => Math.max(0, p - 1))}
          onNext={() => setGridPage((p) => p + 1)}
          pageIndex={gridPage}
          pageSize={gridPageSize}
          metaSuffix={
            gridTotal ? (
              <>
                {' '}
                · Total filas {gridTotal}
              </>
            ) : null
          }
        />
      </div>
    </div>
  )
}
