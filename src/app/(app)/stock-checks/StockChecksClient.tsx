'use client'

import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import type { ProductPickerRow } from '@/app/actions/receipts'
import {
  getStockCheckDetail,
  saveProfileBrand,
  saveProfilePresentation,
  saveProfileProductType,
  saveStockCheckFromAnalysis,
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StockCheckAiPanel } from '@/components/stock-check-ai-panel'
import { StockCheckReviewDialog } from '@/components/stock-check-review-dialog'
import { StockCheckScanEditTable } from '@/components/stock-check-scan-edit-table'
import { VisionAnalysisNote } from '@/components/vision-analysis-note'
import { messageFromAiApiError } from '@/lib/ai-api-error'
import { fileToBase64, resolveApiImageMimeType } from '@/lib/ai-mime'
import {
  analysisToScanRows,
  scanRowsToAnalysisJson,
  type StockCheckScanRow,
} from '@/lib/stock-check-scan-rows'
import type { Json, StockCheckStatus } from '@/types/database'
import type { OpenRouterStockCheckTier } from '@/types/open-router-stock-check-tier'
import { parseStockCheckAiMeta } from '@/types/stock-check-ai-meta'
import type { StockCheckAiMeta } from '@/types/stock-check-ai-meta'
import type { VisionAnalysisMeta } from '@/types/vision-meta'

type CheckRow = {
  id: string
  zone: string
  status: StockCheckStatus
  created_at: string
  ai_meta: Json | null
}

const ZONES: { value: string; label: string }[] = [
  { value: 'alacena', label: 'Alacena' },
  { value: 'refrigerador', label: 'Refrigerador' },
  { value: 'congelador', label: 'Congelador' },
  { value: 'bano', label: 'Baño / aseo' },
  { value: 'bodega', label: 'Bodega' },
  { value: 'otro', label: 'Otro' },
]

function statusLabel(s: StockCheckStatus): string {
  switch (s) {
    case 'draft':
      return 'Borrador'
    case 'processing':
      return 'Procesando'
    case 'awaiting_confirmation':
      return 'Pendiente confirmación'
    case 'completed':
      return 'Completado'
    default:
      return s
  }
}

function zoneLabel(z: string): string {
  return ZONES.find((x) => x.value === z)?.label ?? z
}

interface StockChecksClientProps {
  profileId: string
  initialChecks: CheckRow[]
  products: ProductPickerRow[]
  brands: ProfileBrandRow[]
  measureUnits: MeasureUnitRow[]
  netContentOptions: NetContentOptionRow[]
  productTypes: ProfileCatalogRow[]
  presentations: ProfileCatalogRow[]
  listError: string | null
}

export function StockChecksClient({
  profileId,
  initialChecks,
  products,
  brands,
  measureUnits,
  netContentOptions,
  productTypes,
  presentations,
  listError,
}: StockChecksClientProps) {
  const router = useRouter()
  const [zone, setZone] = useState(ZONES[0]?.value ?? 'alacena')
  const [openRouterTier, setOpenRouterTier] =
    useState<OpenRouterStockCheckTier>('free_first')
  const [file, setFile] = useState<File | null>(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [analysisJson, setAnalysisJson] = useState<string | null>(null)
  const [previewScanRows, setPreviewScanRows] = useState<StockCheckScanRow[]>(
    []
  )
  const [checkVision, setCheckVision] = useState<VisionAnalysisMeta | null>(
    null
  )

  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const [reviewModalOpen, setReviewModalOpen] = useState(false)
  const [detailCheckId, setDetailCheckId] = useState<string | null>(null)
  const [detailCheck, setDetailCheck] = useState<StockCheckDetailHeader | null>(
    null
  )
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailAiMeta, setDetailAiMeta] = useState<StockCheckAiMeta | null>(
    null
  )
  const [detailItems, setDetailItems] = useState<StockCheckDetailItem[]>([])

  function handleScanRowsChange(next: StockCheckScanRow[]) {
    setPreviewScanRows(next)
    setAnalysisJson(scanRowsToAnalysisJson(next))
  }

  async function persistScanBrand(name: string): Promise<boolean> {
    const r = await saveProfileBrand(name)
    if (!r.ok) {
      toast.error(r.error ?? 'No se pudo guardar la marca')
      return false
    }
    toast.success('Marca guardada')
    router.refresh()
    return true
  }

  async function persistScanProductType(name: string): Promise<boolean> {
    const r = await saveProfileProductType(name)
    if (!r.ok) {
      toast.error(r.error ?? 'No se pudo guardar el tipo')
      return false
    }
    toast.success('Tipo guardado')
    router.refresh()
    return true
  }

  async function persistScanPresentation(name: string): Promise<boolean> {
    const r = await saveProfilePresentation(name)
    if (!r.ok) {
      toast.error(r.error ?? 'No se pudo guardar la presentación')
      return false
    }
    toast.success('Presentación guardada')
    router.refresh()
    return true
  }

  async function loadDetail(checkId: string) {
    setDetailLoading(true)
    try {
      const d = await getStockCheckDetail(checkId)
      if (d.error || !d.check) {
        toast.error(d.error ?? 'No se pudo cargar el chequeo')
        setDetailCheckId(null)
        setDetailCheck(null)
        setDetailItems([])
        setDetailAiMeta(null)
        setReviewModalOpen(false)
        return
      }
      setDetailCheck(d.check)
      setDetailAiMeta(parseStockCheckAiMeta(d.check.ai_meta))
      setDetailItems(d.items)
    } finally {
      setDetailLoading(false)
    }
  }

  async function openReview(checkId: string) {
    setDetailCheck(null)
    setDetailItems([])
    setDetailAiMeta(null)
    setDetailCheckId(checkId)
    setReviewModalOpen(true)
    setHistoryModalOpen(false)
    await loadDetail(checkId)
  }

  function closeReview() {
    setReviewModalOpen(false)
    setDetailCheckId(null)
    setDetailCheck(null)
    setDetailItems([])
    setDetailAiMeta(null)
    setDetailLoading(false)
  }

  function clearScanDraft() {
    setAnalysisJson(null)
    setPreviewScanRows([])
    setCheckVision(null)
  }

  async function analyze() {
    if (!file) {
      toast.error('Selecciona una foto de la zona')
      return
    }
    clearScanDraft()
    setAnalyzing(true)
    try {
      const mimeType = resolveApiImageMimeType(file)
      const imageBase64 = await fileToBase64(file)
      const res = await fetch('/api/ai/stock-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId,
          imageBase64,
          mimeType,
          zone,
          openRouterTier,
        }),
      })
      const json = (await res.json()) as {
        error?: string
        hint?: string
        analysis?: unknown
        vision?: VisionAnalysisMeta
      }
      if (!res.ok) {
        toast.error(messageFromAiApiError(json))
        return
      }
      setCheckVision(json.vision ?? null)
      const raw = json.analysis as { detected?: unknown[] }
      const rows = analysisToScanRows({ detected: raw.detected ?? [] })
      handleScanRowsChange(rows)
      toast.success(
        'Lectura lista: revisa y corrige la tabla antes de guardar el chequeo.'
      )
    } catch {
      toast.error('Error de red')
    } finally {
      setAnalyzing(false)
    }
  }

  async function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!analysisJson) {
      toast.error('Primero analiza la imagen')
      return
    }
    const cleaned = previewScanRows.filter((r) => r.nameGuess.trim().length > 0)
    if (cleaned.length === 0) {
      toast.error(
        'Añade al menos una línea con nombre de producto o corrige las filas vacías.'
      )
      return
    }
    const payloadJson = scanRowsToAnalysisJson(cleaned)

    setSaving(true)
    try {
      const fd = new FormData()
      fd.set('zone', zone)
      fd.set('analysis_json', payloadJson)
      if (checkVision) {
        fd.set('vision_json', JSON.stringify(checkVision))
      }
      if (file) fd.set('image', file)

      const result = await saveStockCheckFromAnalysis(fd)
      if (!result.ok) {
        toast.error(result.error ?? 'No se pudo guardar')
        return
      }
      toast.success('Chequeo registrado')
      setFile(null)
      setFileInputKey((k) => k + 1)
      clearScanDraft()
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  const canSave =
    !!analysisJson &&
    previewScanRows.some((r) => r.nameGuess.trim().length > 0) &&
    !saving &&
    !analyzing

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-1">
          <p className="text-[13px] text-muted-foreground">
            <strong>Chequeo de stock</strong> es este flujo: foto por zona →
            lectura con IA → <strong>corriges la tabla aquí mismo</strong> (sin
            guardar aún) → guardar → luego puedes abrir el chequeo en el
            historial para vincular productos y aplicar al inventario.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          onClick={() => setHistoryModalOpen(true)}
        >
          Historial de chequeos
          {initialChecks.length > 0 ? ` (${initialChecks.length})` : ''}
        </Button>
      </div>

      <div className="app-panel space-y-4">
        <h2 className="text-sm font-semibold text-foreground">
          Nuevo chequeo (captura y lectura)
        </h2>
        <p className="app-page-lead">
          OpenRouter analiza la foto y rellena la tabla. Puedes editar cada
          celda antes de guardar si la lectura no es exacta.
        </p>

        <div className="space-y-1.5">
          <span className="app-field-label">Modelos OpenRouter</span>
          <Select
            value={openRouterTier}
            onValueChange={(v) => {
              setOpenRouterTier(v as OpenRouterStockCheckTier)
              clearScanDraft()
            }}
          >
            <SelectTrigger className="app-input w-full border-input">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="free_first">
                Gratis primero, luego de pago (recomendado)
              </SelectItem>
              <SelectItem value="free_only">Solo modelos gratuitos</SelectItem>
              <SelectItem value="paid_only">
                Solo modelo de pago (saldo)
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[12px] text-muted-foreground">
            Prioridad de modelos en{' '}
            <code className="rounded bg-muted px-1 text-[11px]">
              OPENROUTER_VISION_MODEL
            </code>
            .
          </p>
        </div>

        <div className="space-y-1.5">
          <span className="app-field-label">Zona</span>
          <Select
            value={zone}
            onValueChange={(v) => {
              setZone(v)
              clearScanDraft()
            }}
          >
            <SelectTrigger className="app-input w-full border-input">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ZONES.map((z) => (
                <SelectItem key={z.value} value={z.value}>
                  {z.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="photo" className="app-field-label">
            Foto
          </Label>
          <Input
            key={fileInputKey}
            id="photo"
            type="file"
            accept="image/*"
            className="app-input cursor-pointer"
            onChange={(ev) => {
              const next = ev.target.files?.[0] ?? null
              setFile(next)
              clearScanDraft()
            }}
          />
        </div>

        <Button
          type="button"
          variant="secondary"
          onClick={() => void analyze()}
          disabled={!file || analyzing || saving}
        >
          {analyzing ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Leyendo imagen…
            </span>
          ) : (
            'Analizar foto'
          )}
        </Button>

        {(analyzing || saving) && (
          <div
            className="space-y-2 rounded-xl border border-border bg-muted/25 px-4 py-3"
            aria-busy="true"
            aria-live="polite"
          >
            <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
              {analyzing
                ? 'La IA está leyendo la foto (puede tardar un poco).'
                : 'Guardando el chequeo en el servidor…'}
            </div>
            <div className="app-progress-indeterminate w-full max-w-md" />
          </div>
        )}

        <VisionAnalysisNote vision={checkVision} />

        {previewScanRows.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">
              Lectura (editable antes de guardar)
            </p>
            <StockCheckScanEditTable
              rows={previewScanRows}
              onRowsChange={handleScanRowsChange}
              products={products}
              brands={brands}
              productTypes={productTypes}
              presentations={presentations}
              measureUnits={measureUnits}
              netContentOptions={netContentOptions}
              onPersistBrand={persistScanBrand}
              onPersistProductType={persistScanProductType}
              onPersistPresentation={persistScanPresentation}
            />
          </div>
        ) : null}

        <form onSubmit={onSave} className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!canSave}>
            {saving ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Guardando…
              </span>
            ) : (
              'Guardar chequeo'
            )}
          </Button>
          {previewScanRows.length > 0 && (
            <span className="text-[12px] text-muted-foreground">
              Solo después de guardar aparecerá en historial para revisión fina
              e inventario.
            </span>
          )}
        </form>
      </div>

      <Dialog open={historyModalOpen} onOpenChange={setHistoryModalOpen}>
        <DialogContent
          className="flex max-h-[min(90vh,calc(100vh-2rem))] w-full max-w-[min(96rem,calc(100vw-1rem))] flex-col gap-4 overflow-hidden p-4 sm:p-6"
          showCloseButton
        >
          <DialogHeader>
            <DialogTitle>Historial de chequeos</DialogTitle>
            <p className="text-[12px] text-muted-foreground">
              Chequeos ya guardados. Abre uno para corregir líneas, marcar
              errores de lectura o aplicar cantidades al inventario.
            </p>
          </DialogHeader>
          {listError ? (
            <p className="text-[13px] text-destructive">{listError}</p>
          ) : null}
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
            <table className="app-data-table w-full min-w-[720px]">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Zona</th>
                  <th>IA / costo</th>
                  <th>Estado</th>
                  <th className="w-[120px]" />
                </tr>
              </thead>
              <tbody>
                {initialChecks.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-muted-foreground">
                      No hay chequeos registrados.
                    </td>
                  </tr>
                ) : (
                  initialChecks.map((c) => (
                    <tr key={c.id}>
                      <td className="whitespace-nowrap text-muted-foreground">
                        {new Date(c.created_at).toLocaleString('es')}
                      </td>
                      <td>{zoneLabel(c.zone)}</td>
                      <td className="align-top">
                        <StockCheckAiPanel
                          meta={parseStockCheckAiMeta(c.ai_meta)}
                          variant="table"
                        />
                      </td>
                      <td>{statusLabel(c.status)}</td>
                      <td>
                        {c.status === 'completed' ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => void openReview(c.id)}
                          >
                            Ver
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void openReview(c.id)}
                          >
                            Revisar
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      <StockCheckReviewDialog
        open={reviewModalOpen}
        onOpenChange={(v) => {
          if (!v) closeReview()
        }}
        check={detailCheck}
        detailAiMeta={detailAiMeta}
        detailLoading={detailLoading}
        detailItems={detailItems}
        products={products}
        brands={brands}
        measureUnits={measureUnits}
        netContentOptions={netContentOptions}
        productTypes={productTypes}
        presentations={presentations}
        onApplySuccess={() => {
          closeReview()
          router.refresh()
        }}
        onReload={() => {
          if (detailCheckId) void loadDetail(detailCheckId)
          router.refresh()
        }}
      />
    </div>
  )
}
