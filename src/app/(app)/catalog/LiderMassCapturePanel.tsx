'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, Link2, Loader2, Lock, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import {
  approveLiderReviewGroupLinkAction,
  closeRetailCaptureBatchAction,
  discardLiderReviewGroupAction,
  fetchRetailLiderGroupDetailRowsAction,
  fetchRetailLiderReviewGroupsAction,
  markLiderReviewGroupDuplicateAction,
  type RetailCaptureBatchRow,
  type RetailLiderReviewGroupSummary,
  type RetailReviewQueueRow,
} from '@/app/actions/catalog-retail'
import { GridRowIconButton } from '@/components/grid/grid-row-icon-button'
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
  isRetailLiderReviewTray,
  retailLiderSuggestedBulkAction,
  retailLiderTrayLabel,
  type RetailLiderReviewTray,
} from '@/lib/retail-lider-review-tray'

const TOOLBAR_BTN = 'h-9 min-w-[200px] shrink-0'
const GROUP_ACTION_BTN = 'h-9 min-w-[200px] shrink-0'

function batchStatusLabel(s: string): string {
  switch (s) {
    case 'running':
      return 'En ejecución'
    case 'completed':
      return 'Completado'
    case 'cancelled':
      return 'Cancelado'
    default:
      return s
  }
}

function formatAvgScore(v: number | null): string {
  if (v == null || Number.isNaN(v)) return '—'
  return v.toFixed(2)
}

const TRAYS_CREATE_NEW: RetailLiderReviewTray[] = ['new_master_candidate']
const TRAYS_MANUAL: RetailLiderReviewTray[] = [
  'duplicate_risk',
  'format_conflict',
  'category_uncertain',
  'low_confidence',
]
const TRAYS_DISCARD: RetailLiderReviewTray[] = ['discarded_candidate']

type Props = {
  batch: RetailCaptureBatchRow | null
  batchActionBusy: boolean
  /** Solo bandejas de decisión (vista principal). */
  showDecisionTrays?: boolean
  /** Controles de un paso para depuración (herramientas avanzadas). */
  showDebugToolbar?: boolean
  refreshToken: number
  onContinueBatch: () => Promise<void>
  onHomologate: () => Promise<void>
  onRefreshAll: () => Promise<void>
  onBatchChanged: () => void | Promise<void>
  onOpenHomolog: (row: RetailReviewQueueRow) => void
}

export function LiderMassCapturePanel(props: Props) {
  const {
    batch,
    batchActionBusy,
    showDecisionTrays = true,
    showDebugToolbar = false,
    refreshToken,
    onContinueBatch,
    onHomologate,
    onRefreshAll,
    onBatchChanged,
    onOpenHomolog,
  } = props

  const [groups, setGroups] = useState<RetailLiderReviewGroupSummary[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [activeGroup, setActiveGroup] = useState<RetailLiderReviewGroupSummary | null>(null)
  const [detailRows, setDetailRows] = useState<RetailReviewQueueRow[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [groupActionBusy, setGroupActionBusy] = useState(false)
  const [closeBatchBusy, setCloseBatchBusy] = useState(false)

  const loadGroups = useCallback(async () => {
    if (!batch?.id) {
      setGroups([])
      return
    }
    setGroupsLoading(true)
    const res = await fetchRetailLiderReviewGroupsAction({ batchId: batch.id })
    setGroupsLoading(false)
    if (!res.ok) {
      toast.error(res.error)
      setGroups([])
      return
    }
    setGroups(res.groups)
  }, [batch?.id])

  useEffect(() => {
    void loadGroups()
  }, [loadGroups, refreshToken])

  const groupsByMeta = useMemo(() => {
    const create: RetailLiderReviewGroupSummary[] = []
    const manual: RetailLiderReviewGroupSummary[] = []
    const discard: RetailLiderReviewGroupSummary[] = []
    for (const g of groups) {
      const t = g.review_tray
      if (TRAYS_CREATE_NEW.includes(t as RetailLiderReviewTray)) create.push(g)
      else if (TRAYS_MANUAL.includes(t as RetailLiderReviewTray)) manual.push(g)
      else if (TRAYS_DISCARD.includes(t as RetailLiderReviewTray)) discard.push(g)
    }
    return { create, manual, discard }
  }, [groups])

  const phase = batch?.pipeline_phase
  const closed = phase === 'closed'

  async function openGroupDetail(g: RetailLiderReviewGroupSummary) {
    if (!batch?.id) return
    setActiveGroup(g)
    setGroupDialogOpen(true)
    setDetailLoading(true)
    setDetailRows([])
    const res = await fetchRetailLiderGroupDetailRowsAction({
      batchId: batch.id,
      groupKey: g.group_key,
      limit: 100,
    })
    setDetailLoading(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setDetailRows(res.rows)
  }

  async function runGroupApprove() {
    if (!batch?.id || !activeGroup) return
    setGroupActionBusy(true)
    const res = await approveLiderReviewGroupLinkAction({
      batchId: batch.id,
      groupKey: activeGroup.group_key,
    })
    setGroupActionBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(`Vínculos aplicados: ${res.linked}.`)
    setGroupDialogOpen(false)
    await onBatchChanged()
  }

  async function runGroupDiscard() {
    if (!batch?.id || !activeGroup) return
    setGroupActionBusy(true)
    const res = await discardLiderReviewGroupAction({
      batchId: batch.id,
      groupKey: activeGroup.group_key,
    })
    setGroupActionBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(`Ítems actualizados: ${res.updated}.`)
    setGroupDialogOpen(false)
    await onBatchChanged()
  }

  async function runGroupMarkDuplicate() {
    if (!batch?.id || !activeGroup) return
    setGroupActionBusy(true)
    const res = await markLiderReviewGroupDuplicateAction({
      batchId: batch.id,
      groupKey: activeGroup.group_key,
    })
    setGroupActionBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(`Ítems marcados: ${res.updated}.`)
    setGroupDialogOpen(false)
    await onBatchChanged()
  }

  async function runCloseBatch() {
    if (!batch?.id) return
    setCloseBatchBusy(true)
    const res = await closeRetailCaptureBatchAction({ batchId: batch.id })
    setCloseBatchBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Lote cerrado.')
    await onBatchChanged()
  }

  function notImplementedMassAction(label: string) {
    toast.message(`${label}: acción en desarrollo.`)
  }

  function renderTraySection(
    title: string,
    description: string,
    trayGroups: RetailLiderReviewGroupSummary[],
  ) {
    return (
      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
          <span className="text-[12px] text-muted-foreground">
            {trayGroups.length} grupo{trayGroups.length === 1 ? '' : 's'} ·{' '}
            {trayGroups.reduce((a, g) => a + g.product_count, 0)} productos
          </span>
        </div>
        <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{description}</p>

        {trayGroups.length === 0 ?
          <p className="mt-3 text-[12px] text-muted-foreground">Nada pendiente en esta bandeja.</p>
        : <ul className="mt-3 space-y-2">
            {trayGroups.map((g) => {
              const trayKey: RetailLiderReviewTray = isRetailLiderReviewTray(g.review_tray) ? g.review_tray : 'low_confidence'
              return (
                <li key={g.group_key} className="rounded-md border border-border bg-muted/15 px-3 py-2 text-[12px]">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-[11px] font-medium text-muted-foreground">{retailLiderTrayLabel(trayKey)}</p>
                      <p className="font-medium tabular-nums text-foreground">
                        {g.product_count} productos · score medio {formatAvgScore(g.avg_confidence)}
                      </p>
                      <p className="text-muted-foreground">
                        Candidato:{' '}
                        <span className="text-foreground">
                          {g.suggested_master_name ?? g.suggested_master_id ?? '—'}
                        </span>
                      </p>
                      <p className="line-clamp-2 text-muted-foreground">
                        {(g.sample_titles ?? []).slice(0, 4).join(' · ') || '—'}
                      </p>
                      <p className="text-[11px] italic text-muted-foreground">
                        {retailLiderSuggestedBulkAction(trayKey)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className={GROUP_ACTION_BTN}
                      disabled={closed}
                      onClick={() => void openGroupDetail(g)}
                    >
                      Abrir detalle
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        }
      </section>
    )
  }

  return (
    <>
      {showDebugToolbar ?
        <div className="rounded-lg border border-border border-dashed bg-muted/20 p-4">
          <p className="mb-2 text-[12px] font-medium text-muted-foreground">Depuración (un paso)</p>
          <p className="mb-3 text-[12px] leading-snug text-muted-foreground">
            Solo para soporte. El flujo normal es el botón «Crear productos y actualizar precios» arriba (tras resolver taxonomía).
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              className={TOOLBAR_BTN}
              disabled={batchActionBusy || closed}
              onClick={() => void onContinueBatch()}
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
              Procesar una página de captura
            </Button>
            <Button
              type="button"
              variant="secondary"
              className={TOOLBAR_BTN}
              disabled={batchActionBusy || closed}
              onClick={() => void onHomologate()}
            >
              <Link2 className="h-4 w-4" aria-hidden />
              Homologar un lote (staging)
            </Button>
            <Button
              type="button"
              variant="outline"
              className={TOOLBAR_BTN}
              disabled={batchActionBusy}
              onClick={() => void onRefreshAll()}
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Actualizar datos
            </Button>
            <Button
              type="button"
              variant="outline"
              className={TOOLBAR_BTN}
              disabled={batchActionBusy || closeBatchBusy || closed || !batch?.id || batch.status !== 'completed'}
              onClick={() => void runCloseBatch()}
            >
              {closeBatchBusy ?
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              : <Lock className="h-4 w-4" aria-hidden />}
              Cerrar lote
            </Button>
          </div>
          {batch ?
            <p className="mt-3 text-[11px] text-muted-foreground">
              Lote <span className="font-mono">{batch.id}</span> · Estado {batchStatusLabel(batch.status)} · Fase{' '}
              {phase ?? '—'}
            </p>
          : null}
        </div>
      : null}

      {showDecisionTrays ?
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[14px] font-semibold text-foreground">Decisiones pendientes</p>
            {groupsLoading ?
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
            : null}
          </div>

          {renderTraySection(
            'A. Crear como nuevos',
            'Ítems que parecen nuevos en tienda y sin candidato claro en catálogo. Revisá duplicados antes de crear maestros.',
            groupsByMeta.create,
          )}
          {renderTraySection(
            'B. Homologar manualmente',
            'Candidatos cercanos o reglas ambiguas: elegí el maestro correcto o marcá duplicado.',
            groupsByMeta.manual,
          )}
          {renderTraySection(
            'C. Descartar',
            'Basura técnica o sin valor operativo: descartá el grupo o revisá la muestra.',
            groupsByMeta.discard,
          )}
        </div>
      : null}

      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="modal-lg">
          <DialogHeader>
            <DialogTitle>Detalle del grupo</DialogTitle>
            <DialogDescription>
              {activeGroup ?
                <>
                  {retailLiderTrayLabel(
                    isRetailLiderReviewTray(activeGroup.review_tray) ? activeGroup.review_tray : 'low_confidence',
                  )}{' '}
                  · {activeGroup.product_count} productos · score medio {formatAvgScore(activeGroup.avg_confidence)}
                </>
              : null}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ?
            <div className="flex justify-center py-8">
              <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
            </div>
          : <div className="relative overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left">
                    <th className="p-2 font-medium">Estado</th>
                    <th className="p-2 font-medium">Ítem</th>
                    <th className="p-2 font-medium">Precio</th>
                    <th className="p-2 font-medium text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {detailRows.length === 0 ?
                    <tr>
                      <td colSpan={4} className="p-4 text-center text-[12px] text-muted-foreground">
                        No hay filas en este grupo.
                      </td>
                    </tr>
                  : detailRows.map((r) => (
                      <tr key={r.id} className="border-b border-border last:border-0">
                        <td className="p-2 text-[12px]">{r.status}</td>
                        <td className="max-w-[280px] p-2 text-[13px] leading-snug">{r.title}</td>
                        <td className="p-2 tabular-nums">${Number(r.price ?? 0).toFixed(0)}</td>
                        <td className="p-2">
                          <div className="flex justify-end">
                            <GridRowIconButton label="Homologar manualmente" onClick={() => onOpenHomolog(r)}>
                              <Link2 />
                            </GridRowIconButton>
                          </div>
                        </td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>
          }

          <p className="text-[11px] text-muted-foreground">Mostrando hasta 100 ítems por grupo.</p>

          <DialogFooter className="flex flex-wrap gap-2 sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              className={GROUP_ACTION_BTN}
              disabled={groupActionBusy || closed}
              onClick={() => notImplementedMassAction('Crear maestros seleccionados')}
            >
              Crear maestros
            </Button>
            <Button
              type="button"
              variant="secondary"
              className={GROUP_ACTION_BTN}
              disabled={groupActionBusy || closed}
              onClick={() => notImplementedMassAction('Asignar categoría al grupo')}
            >
              Asignar categoría
            </Button>
            <Button
              type="button"
              variant="secondary"
              className={GROUP_ACTION_BTN}
              disabled={groupActionBusy || closed}
              onClick={() => void runGroupMarkDuplicate()}
            >
              Marcar como duplicado
            </Button>
            <Button
              type="button"
              variant="destructive"
              className={GROUP_ACTION_BTN}
              disabled={groupActionBusy || closed}
              onClick={() => void runGroupDiscard()}
            >
              Descartar grupo
            </Button>
            <Button
              type="button"
              className={GROUP_ACTION_BTN}
              disabled={groupActionBusy || closed}
              onClick={() => void runGroupApprove()}
            >
              Aprobar vínculo (grupo)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
