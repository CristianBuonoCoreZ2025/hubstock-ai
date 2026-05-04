'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  confirmPurchaseReceipt,
  getReceiptDetail,
  type ReceiptDetailItem,
  savePurchaseReceiptDraft,
  setReceiptLineProduct,
} from '@/app/actions/receipts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { VisionAnalysisNote } from '@/components/vision-analysis-note'
import { messageFromAiApiError } from '@/lib/ai-api-error'
import { fileToBase64, resolveApiImageMimeType } from '@/lib/ai-mime'
import type { VisionAnalysisMeta } from '@/types/vision-meta'
import type { ReceiptStatus } from '@/types/database'

type ReceiptRow = {
  id: string
  store_name: string | null
  purchased_at: string | null
  total: number | null
  status: ReceiptStatus
  created_at: string
}

type ReceiptAnalysis = {
  storeName?: string | null
  purchasedAt?: string | null
  currency?: string
  total?: number | null
  items?: Array<{
    nameRaw: string
    quantity?: number | null
    unitPrice?: number | null
    lineTotal?: number | null
  }>
}

function statusLabel(s: ReceiptStatus): string {
  switch (s) {
    case 'pending_review':
      return 'Pendiente revisión'
    case 'confirmed':
      return 'Confirmada'
    case 'rejected':
      return 'Rechazada'
    default:
      return s
  }
}

type ProductOption = { id: string; name: string }

const NONE = '__none__'

interface ReceiptsClientProps {
  profileId: string
  initialReceipts: ReceiptRow[]
  products: ProductOption[]
  listError: string | null
}

export function ReceiptsClient({
  profileId,
  initialReceipts,
  products,
  listError,
}: ReceiptsClientProps) {
  const router = useRouter()
  const [reviewReceiptId, setReviewReceiptId] = useState<string | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewItems, setReviewItems] = useState<ReceiptDetailItem[]>([])
  const [confirming, setConfirming] = useState(false)

  const [file, setFile] = useState<File | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [analysis, setAnalysis] = useState<ReceiptAnalysis | null>(null)
  const [receiptVision, setReceiptVision] = useState<VisionAnalysisMeta | null>(
    null
  )

  const [storeName, setStoreName] = useState('')
  const [purchasedAt, setPurchasedAt] = useState('')
  const [total, setTotal] = useState('')

  async function analyze() {
    if (!file) {
      toast.error('Selecciona una foto de la boleta')
      return
    }
    setAnalyzing(true)
    try {
      const mimeType = resolveApiImageMimeType(file)
      const imageBase64 = await fileToBase64(file)
      const res = await fetch('/api/ai/analyze-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, imageBase64, mimeType }),
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
      const a = json.analysis as ReceiptAnalysis
      setReceiptVision(json.vision ?? null)
      setAnalysis(a)
      setStoreName(
        typeof a.storeName === 'string' ? a.storeName : ''
      )
      if (a.purchasedAt) {
        try {
          const d = new Date(a.purchasedAt)
          if (!Number.isNaN(d.getTime())) {
            setPurchasedAt(d.toISOString().slice(0, 16))
          }
        } catch {
          /* ignorar */
        }
      }
      setTotal(
        typeof a.total === 'number' && !Number.isNaN(a.total)
          ? String(a.total)
          : ''
      )
      toast.success('Boleta interpretada — revisa y guarda')
    } catch {
      toast.error('Error de red')
    } finally {
      setAnalyzing(false)
    }
  }

  async function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!analysis) {
      toast.error('Primero analiza una imagen')
      return
    }
    setSaving(true)
    try {
      const fd = new FormData()
      fd.set('analysis_json', JSON.stringify(analysis))
      fd.set('store_name', storeName)
      if (purchasedAt) fd.set('purchased_at', new Date(purchasedAt).toISOString())
      if (total.trim() !== '') fd.set('total', total)
      if (file) fd.set('image', file)

      const result = await savePurchaseReceiptDraft(fd)
      if (!result.ok) {
        toast.error(result.error ?? 'No se pudo guardar')
        return
      }
      toast.success('Boleta guardada como borrador')
      setFile(null)
      setReceiptVision(null)
      setAnalysis(null)
      setStoreName('')
      setPurchasedAt('')
      setTotal('')
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function openReview(receiptId: string) {
    setReviewReceiptId(receiptId)
    setReviewLoading(true)
    try {
      const detail = await getReceiptDetail(receiptId)
      if (detail.error || !detail.receipt) {
        toast.error(detail.error ?? 'No se pudo cargar la boleta')
        setReviewReceiptId(null)
        setReviewItems([])
        return
      }
      setReviewItems(detail.items)
    } finally {
      setReviewLoading(false)
    }
  }

  async function onLineProduct(lineId: string, value: string) {
    const productId = value === NONE ? null : value
    const res = await setReceiptLineProduct(lineId, productId)
    if (!res.ok) {
      toast.error(res.error ?? 'No se pudo actualizar')
      return
    }
    if (reviewReceiptId) {
      const detail = await getReceiptDetail(reviewReceiptId)
      if (detail.items) setReviewItems(detail.items)
    }
    router.refresh()
  }

  async function onConfirmReceipt() {
    if (!reviewReceiptId) return
    setConfirming(true)
    try {
      const res = await confirmPurchaseReceipt(reviewReceiptId)
      if (!res.ok) {
        toast.error(res.error ?? 'No se pudo confirmar')
        return
      }
      toast.success(
        `Inventario actualizado (${res.linesApplied ?? 0} líneas)`
      )
      setReviewReceiptId(null)
      setReviewItems([])
      router.refresh()
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-8 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="app-panel space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            Nueva boleta
          </h2>
          <p className="app-page-lead">
            Sube una foto del ticket. La IA extrae ítems y total; guardas un
            borrador para revisar después en tu flujo de compras.
          </p>
          <Input
            type="file"
            accept="image/*"
            className="app-input cursor-pointer"
            onChange={(ev) => {
              setFile(ev.target.files?.[0] ?? null)
              setReceiptVision(null)
            }}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => void analyze()}
            disabled={!file || analyzing}
          >
            {analyzing ? 'Leyendo…' : 'Analizar boleta'}
          </Button>
          <VisionAnalysisNote vision={receiptVision} />

          {analysis ? (
            <form className="space-y-3 pt-2" onSubmit={onSave}>
              <div className="space-y-1.5">
                <Label htmlFor="store_name" className="app-field-label">
                  Comercio
                </Label>
                <Input
                  id="store_name"
                  className="app-input"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="purchased_at" className="app-field-label">
                    Fecha / hora
                  </Label>
                  <Input
                    id="purchased_at"
                    type="datetime-local"
                    className="app-input"
                    value={purchasedAt}
                    onChange={(e) => setPurchasedAt(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="total" className="app-field-label">
                    Total
                  </Label>
                  <Input
                    id="total"
                    type="number"
                    step="0.01"
                    min="0"
                    className="app-input"
                    value={total}
                    onChange={(e) => setTotal(e.target.value)}
                  />
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
                {Array.isArray(analysis.items) && analysis.items.length > 0 ? (
                  <ul className="list-inside list-disc space-y-0.5">
                    {analysis.items.slice(0, 8).map((it, i) => (
                      <li key={i}>
                        {it.nameRaw}
                        {it.lineTotal != null
                          ? ` — ${it.lineTotal}`
                          : ''}
                      </li>
                    ))}
                    {analysis.items.length > 8 ? (
                      <li>… y más ítems</li>
                    ) : null}
                  </ul>
                ) : (
                  <span>No se detectaron líneas; igual puedes guardar la boleta.</span>
                )}
              </div>
              <Button type="submit" disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar borrador'}
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          Registro guardado
        </h2>
        {listError ? (
          <p className="text-[13px] text-destructive">{listError}</p>
        ) : null}
        <div className="app-data-table-wrap">
          <table className="app-data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Comercio</th>
                <th>Total</th>
                <th>Estado</th>
                <th className="w-[120px]" />
              </tr>
            </thead>
            <tbody>
              {initialReceipts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-muted-foreground">
                    No hay boletas registradas.
                  </td>
                </tr>
              ) : (
                initialReceipts.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-muted-foreground">
                      {new Date(r.created_at).toLocaleString('es')}
                    </td>
                    <td className="font-medium">
                      {r.store_name ?? '—'}
                    </td>
                    <td className="tabular-nums">
                      {r.total != null ? r.total.toFixed(2) : '—'}
                    </td>
                    <td>{statusLabel(r.status)}</td>
                    <td>
                      {r.status === 'pending_review' ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void openReview(r.id)}
                        >
                          Revisar
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      </div>

      {reviewReceiptId ? (
          <div className="app-panel space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                Revisión de boleta
              </h2>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setReviewReceiptId(null)
                    setReviewItems([])
                  }}
                >
                  Cerrar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={confirming || reviewLoading}
                  onClick={() => void onConfirmReceipt()}
                >
                  {confirming ? 'Aplicando…' : 'Confirmar e impactar inventario'}
                </Button>
              </div>
            </div>
            <p className="app-page-lead">
              Empareja cada línea con un producto del inventario. Al confirmar se
              suma la cantidad de la línea al stock y se registra el movimiento
              como compra.
            </p>
            {reviewLoading ? (
              <p className="text-[13px] text-muted-foreground">Cargando…</p>
            ) : (
              <div className="app-data-table-wrap">
                <table className="app-data-table">
                  <thead>
                    <tr>
                      <th>Texto boleta</th>
                      <th className="text-right">Cant.</th>
                      <th>Producto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewItems.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="text-muted-foreground">
                          Sin líneas en esta boleta.
                        </td>
                      </tr>
                    ) : (
                      reviewItems.map((line) => (
                        <tr key={line.id}>
                          <td className="font-medium">{line.name_raw}</td>
                          <td className="text-right tabular-nums">
                            {line.quantity ?? '—'}
                          </td>
                          <td className="min-w-[200px]">
                            <Select
                              value={line.product_id ?? NONE}
                              onValueChange={(v) =>
                                void onLineProduct(line.id, v)
                              }
                            >
                              <SelectTrigger className="app-input h-9 w-full border-input text-[13px]">
                                <SelectValue placeholder="Emparejar…" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE}>
                                  Sin emparejar
                                </SelectItem>
                                {products.map((p) => (
                                  <SelectItem key={p.id} value={p.id}>
                                    {p.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
      ) : null}
    </div>
  )
}
