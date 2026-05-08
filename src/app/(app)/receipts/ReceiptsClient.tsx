'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  confirmPurchaseReceipt,
  getReceiptDetail,
  type ProductPickerRow,
  type ReceiptDetailItem,
  savePurchaseReceiptDraft,
  setReceiptLineProduct,
} from '@/app/actions/receipts'
import { AppSearchBox } from '@/components/search/app-search-box'
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
import { VisionOpenRouterTierSelect } from '@/components/vision-openrouter-tier-select'
import { VisionAnalysisNote } from '@/components/vision-analysis-note'
import {
  messageFromAiApiError,
  messageWhenAiApiBodyNotJson,
  readAiApiJsonBody,
} from '@/lib/ai-api-error'
import { fileToBase64 } from '@/lib/ai-mime'
import { buildVisionAnalysisImagePayload } from '@/lib/capture-vision-image'
import type { OpenRouterStockCheckTier } from '@/types/open-router-stock-check-tier'
import type { VisionAnalysisMeta } from '@/types/vision-meta'
import { suggestInventoryProductsForReceiptLine } from '@/lib/receipt-line-product-suggestions'
import { filterBySearch, normalizeSearchText } from '@/lib/search'
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

const NONE = '__none__'

/** Foto (visión) o PDF (texto extraído en servidor). Sin texto pegado. */
type BoletaSource = 'image' | 'document_pdf'

interface ReceiptsClientProps {
  profileId: string
  initialReceipts: ReceiptRow[]
  products: ProductPickerRow[]
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

  const [openRouterTier, setOpenRouterTier] =
    useState<OpenRouterStockCheckTier>('free_first')
  const [boletaSource, setBoletaSource] = useState<BoletaSource>('image')
  const [file, setFile] = useState<File | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [analysis, setAnalysis] = useState<ReceiptAnalysis | null>(null)
  const [receiptVision, setReceiptVision] = useState<VisionAnalysisMeta | null>(
    null
  )

  const [receiptListSearchDraft, setReceiptListSearchDraft] = useState('')
  const [receiptListSearchSubmitted, setReceiptListSearchSubmitted] = useState('')

  const filteredReceiptRows = useMemo(() => {
    const rows = initialReceipts ?? []
    if (!normalizeSearchText(receiptListSearchSubmitted)) return rows
    return filterBySearch(rows, receiptListSearchSubmitted, (r) => {
      const dateStr = new Date(r.created_at).toLocaleString('es')
      const totalStr = r.total != null ? String(r.total) : ''
      return `${r.store_name ?? ''} ${statusLabel(r.status)} ${totalStr} ${dateStr}`
    })
  }, [initialReceipts, receiptListSearchSubmitted])

  const [storeName, setStoreName] = useState('')
  const [purchasedAt, setPurchasedAt] = useState('')
  const [total, setTotal] = useState('')

  function clearReceiptAiDraft() {
    setReceiptVision(null)
    setAnalysis(null)
    setStoreName('')
    setPurchasedAt('')
    setTotal('')
  }

  function resetBoletaInputs() {
    setFile(null)
    clearReceiptAiDraft()
  }

  function changeBoletaSource(next: BoletaSource) {
    setBoletaSource(next)
    resetBoletaInputs()
  }

  async function analyze() {
    setAnalyzing(true)
    try {
      let body: Record<string, unknown>
      if (boletaSource === 'image') {
        if (!file) {
          toast.error('Selecciona una imagen de la boleta')
          return
        }
        const img = await buildVisionAnalysisImagePayload(file)
        body = {
          profileId,
          inputKind: 'image',
          imageBase64: img.imageBase64,
          mimeType: img.mimeType,
          openRouterTier,
        }
      } else {
        if (!file) {
          toast.error('Selecciona un PDF')
          return
        }
        if (
          file.type !== 'application/pdf' &&
          !file.name.toLowerCase().endsWith('.pdf')
        ) {
          toast.error('El archivo debe ser PDF')
          return
        }
        const pdfBase64 = await fileToBase64(file)
        body = {
          profileId,
          inputKind: 'document_pdf',
          pdfBase64,
          openRouterTier,
        }
      }

      const res = await fetch('/api/ai/analyze-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const parsed = await readAiApiJsonBody<{
        error?: string
        hint?: string
        analysis?: unknown
        vision?: VisionAnalysisMeta
      }>(res)
      if (parsed.kind === 'invalid_json') {
        toast.error(messageWhenAiApiBodyNotJson(parsed.rawPreview))
        return
      }
      if (parsed.kind === 'empty') {
        toast.error(
          res.ok
            ? 'Respuesta vacía del servidor.'
            : messageFromAiApiError({})
        )
        return
      }
      const json = parsed.json
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

  function canAnalyze(): boolean {
    return Boolean(file)
  }

  async function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!analysis) {
      toast.error('Primero analiza la boleta')
      return
    }
    setSaving(true)
    try {
      const fd = new FormData()
      fd.set('analysis_json', JSON.stringify(analysis))
      fd.set('store_name', storeName)
      if (purchasedAt) fd.set('purchased_at', new Date(purchasedAt).toISOString())
      if (total.trim() !== '') fd.set('total', total)
      if (
        file &&
        (boletaSource === 'image' || boletaSource === 'document_pdf')
      ) {
        fd.set('image', file)
      }

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
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="app-panel space-y-4">
          <h2 className="text-sm font-semibold text-foreground">
            1. Modelo y archivo
          </h2>
          <p className="app-page-lead">
            Mismo criterio que <strong>Inventario · Cargar por fotos</strong>: eliges
            si OpenRouter intenta primero modelos gratuitos, solo gratuitos o solo de
            pago. La <strong>zona física del hogar</strong> no aplica en boletas (solo
            en carga por fotos). Entrada permitida: <strong>foto</strong> del ticket
            (visión) o <strong>PDF</strong> (texto extraído en el servidor).
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={boletaSource === 'image' ? 'default' : 'outline'}
              onClick={() => changeBoletaSource('image')}
              disabled={analyzing}
            >
              Foto de boleta
            </Button>
            <Button
              type="button"
              size="sm"
              variant={boletaSource === 'document_pdf' ? 'default' : 'outline'}
              onClick={() => changeBoletaSource('document_pdf')}
              disabled={analyzing}
            >
              PDF (documento)
            </Button>
          </div>

          <VisionOpenRouterTierSelect
            value={openRouterTier}
            disabled={analyzing}
            hintVariant={boletaSource === 'image' ? 'vision' : 'document'}
            onValueChange={(v) => {
              setOpenRouterTier(v)
              clearReceiptAiDraft()
            }}
          />

          {boletaSource === 'image' ? (
            <div className="space-y-1.5">
              <Label htmlFor="receipt-photo" className="app-field-label">
                Imagen del ticket
              </Label>
              <Input
                id="receipt-photo"
                type="file"
                accept="image/*"
                className="app-input cursor-pointer"
                onChange={(ev) => {
                  setFile(ev.target.files?.[0] ?? null)
                  clearReceiptAiDraft()
                }}
              />
            </div>
          ) : null}

          {boletaSource === 'document_pdf' ? (
            <div className="space-y-1.5">
              <Label htmlFor="receipt-pdf" className="app-field-label">
                PDF de la boleta
              </Label>
              <Input
                id="receipt-pdf"
                type="file"
                accept="application/pdf,.pdf"
                className="app-input cursor-pointer"
                onChange={(ev) => {
                  setFile(ev.target.files?.[0] ?? null)
                  clearReceiptAiDraft()
                }}
              />
              <p className="text-[12px] text-muted-foreground">
                El servidor extrae el texto del PDF y lo envía a modelos de{' '}
                <strong>documento</strong> (variables{' '}
                <code className="rounded bg-muted px-1 text-[11px]">
                  OPENROUTER_DOCUMENT_MODEL*
                </code>{' '}
                si las configuraste).
              </p>
            </div>
          ) : null}

          <Button
            type="button"
            variant="secondary"
            onClick={() => void analyze()}
            disabled={!canAnalyze() || analyzing}
          >
            {analyzing ? 'Leyendo…' : 'Analizar boleta'}
          </Button>
          <VisionAnalysisNote vision={receiptVision} />
        </div>

        <div className="app-panel space-y-4">
          <h2 className="text-sm font-semibold text-foreground">
            2. Revisar y guardar borrador
          </h2>
          <p className="app-page-lead text-[13px] text-muted-foreground">
            Al guardar solo queda un borrador (sin cambiar inventario). En{' '}
            <strong>Registro guardado → Revisar</strong> emparejas cada línea con un
            producto del inventario (los ítems vienen del catálogo global ligado al
            hogar). Al confirmar se aplican cantidades al stock.
          </p>

          {!analysis ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
              Ejecuta el análisis en el paso 1 para ver comercio, total y líneas.
            </p>
          ) : (
            <form className="space-y-3" onSubmit={onSave}>
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
              <div className="app-data-table-wrap text-[12px]">
                {Array.isArray(analysis.items) && analysis.items.length > 0 ? (
                  <table className="app-data-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Descripción</th>
                        <th className="text-right">Cant.</th>
                        <th className="text-right">P. unit.</th>
                        <th className="text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.items.slice(0, 12).map((it, i) => (
                        <tr key={i}>
                          <td className="tabular-nums text-muted-foreground">
                            {i + 1}
                          </td>
                          <td className="max-w-[240px] truncate font-medium">
                            {it.nameRaw}
                          </td>
                          <td className="text-right tabular-nums">
                            {it.quantity ?? '—'}
                          </td>
                          <td className="text-right tabular-nums">
                            {it.unitPrice ?? '—'}
                          </td>
                          <td className="text-right tabular-nums">
                            {it.lineTotal ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-muted-foreground">
                    No se detectaron líneas; igual puedes guardar la boleta.
                  </p>
                )}
                {Array.isArray(analysis.items) && analysis.items.length > 12 ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Mostrando 12 de {analysis.items.length} líneas; el borrador
                    guardará el JSON completo.
                  </p>
                ) : null}
              </div>
              <Button type="submit" disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar borrador'}
              </Button>
            </form>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          Registro guardado
        </h2>
        {listError ? (
          <p className="text-[13px] text-destructive">{listError}</p>
        ) : null}
        <div className="mb-3 max-w-md space-y-1.5">
          <Label className="text-[12px] text-muted-foreground">Filtrar listado</Label>
          <AppSearchBox
            ariaLabel="Filtrar boletas guardadas"
            placeholder="Comercio, estado, fecha… (Enter o lupa)"
            value={receiptListSearchDraft}
            onChange={setReceiptListSearchDraft}
            onSubmit={() => setReceiptListSearchSubmitted(receiptListSearchDraft.trim())}
          />
        </div>
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
              ) : filteredReceiptRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-muted-foreground">
                    Ningún registro coincide con el filtro.
                  </td>
                </tr>
              ) : (
                filteredReceiptRows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-muted-foreground">
                      {new Date(r.created_at).toLocaleString('es')}
                    </td>
                    <td className="font-medium">{r.store_name ?? '—'}</td>
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
              Empareja cada línea con un producto de tu inventario (mismo listado que
              en esta pantalla: nombre comercial del hogar ligado al catálogo). Verás
              sugerencias por nombre, marca y precio unitario cercano al último
              precio guardado. Al confirmar se suma la cantidad de la línea al stock y
              se registra la compra en historial.
            </p>
            <p className="text-[13px] text-muted-foreground">
              ¿No existe el producto? Créalo en{' '}
              <Link href="/inventory" className="underline underline-offset-2">
                Inventario
              </Link>{' '}
              (alta desde catálogo o nombre nuevo maestro) o en{' '}
              <Link href="/catalog" className="underline underline-offset-2">
                Catálogo
              </Link>
              ; luego vuelve aquí, pulsa <strong>Revisar</strong> de nuevo y el nuevo
              ítem aparecerá en el selector.
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
                      reviewItems.map((line) => {
                        const suggestions = suggestInventoryProductsForReceiptLine(
                          {
                            name_raw: line.name_raw,
                            unit_price: line.unit_price,
                          },
                          products,
                          3,
                        )
                        return (
                          <tr key={line.id}>
                            <td className="max-w-[min(280px,36vw)] align-top">
                              <div className="font-medium leading-snug">
                                {line.name_raw}
                              </div>
                              {suggestions.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  <span className="text-[11px] text-muted-foreground">
                                    Sugerencias:
                                  </span>
                                  {suggestions.map((p) => (
                                    <Button
                                      key={p.id}
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-7 max-w-[200px] truncate px-2 text-[11px]"
                                      title={`${p.name}${p.brand ? ` · ${p.brand}` : ''}`}
                                      onClick={() =>
                                        void onLineProduct(line.id, p.id)
                                      }
                                    >
                                      {p.name.length > 28
                                        ? `${p.name.slice(0, 26)}…`
                                        : p.name}
                                    </Button>
                                  ))}
                                </div>
                              ) : null}
                            </td>
                            <td className="text-right tabular-nums align-top">
                              {line.quantity ?? '—'}
                            </td>
                            <td className="min-w-[200px] align-top">
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
                                      {p.brand ? ` · ${p.brand}` : ''}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>
                          </tr>
                        )
                      })
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
