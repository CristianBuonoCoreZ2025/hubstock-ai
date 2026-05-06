'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  confirmPurchaseReceipt,
  createAndLinkProductFromReceiptLine,
  getReceiptDetail,
  linkPurchaseReceiptLineFromCatalog,
  type ReceiptDetailItem,
  savePurchaseReceiptDraft,
  searchCatalogProductsForReceipt,
  setReceiptLineProduct,
  type CatalogSearchRow,
  type ProductPickerRow,
} from '@/app/actions/receipts'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { VisionAnalysisNote } from '@/components/vision-analysis-note'
import { messageFromAiApiError } from '@/lib/ai-api-error'
import { fileToBase64, resolveApiImageMimeType } from '@/lib/ai-mime'
import { PAGE_LEADS } from '@/lib/domain'
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

type CategoryOpt = { id: string; name: string; section_id: string }
type SectionOpt = { id: string; name: string }

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

function formatMoney(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return Number(n).toFixed(2)
}

const NONE = '__none__'

interface ReceiptsClientProps {
  profileId: string
  initialReceipts: ReceiptRow[]
  products: ProductPickerRow[]
  categories: CategoryOpt[]
  sections: SectionOpt[]
  listError: string | null
}

export function ReceiptsClient({
  profileId,
  initialReceipts,
  products,
  categories,
  sections,
  listError,
}: ReceiptsClientProps) {
  const router = useRouter()
  const [reviewReceiptId, setReviewReceiptId] = useState<string | null>(null)
  const [reviewReceiptMeta, setReviewReceiptMeta] = useState<{
    status: ReceiptStatus
    store_name: string | null
  } | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewItems, setReviewItems] = useState<ReceiptDetailItem[]>([])
  const [confirming, setConfirming] = useState(false)

  const [lineSearch, setLineSearch] = useState<Record<string, string>>({})
  const [catalogQueryByLine, setCatalogQueryByLine] = useState<
    Record<string, string>
  >({})
  const [catalogHitsByLine, setCatalogHitsByLine] = useState<
    Record<string, CatalogSearchRow[]>
  >({})
  const [catalogBusyLineId, setCatalogBusyLineId] = useState<string | null>(
    null
  )

  const [createOpen, setCreateOpen] = useState(false)
  const [createLineId, setCreateLineId] = useState<string | null>(null)
  const [createName, setCreateName] = useState('')
  const [createSectionId, setCreateSectionId] = useState('')
  const [createCategoryId, setCreateCategoryId] = useState('')
  const [createRefPrice, setCreateRefPrice] = useState('')
  const [createSaving, setCreateSaving] = useState(false)

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

  const pendingLines = useMemo(
    () => reviewItems.filter((l) => !l.product_id),
    [reviewItems]
  )
  const linkedLines = useMemo(
    () => reviewItems.filter((l) => !!l.product_id),
    [reviewItems]
  )

  const canConfirmReceipt =
    !!reviewReceiptMeta &&
    reviewReceiptMeta.status === 'pending_review' &&
    reviewItems.length > 0 &&
    pendingLines.length === 0

  const categoriesForSection = useMemo(() => {
    if (!createSectionId) return categories
    return categories.filter((c) => c.section_id === createSectionId)
  }, [categories, createSectionId])

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
      setStoreName(typeof a.storeName === 'string' ? a.storeName : '')
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

  async function refreshReviewDetail(id: string) {
    const detail = await getReceiptDetail(id)
    if (detail.error || !detail.receipt) {
      toast.error(detail.error ?? 'No se pudo cargar la boleta')
      return
    }
    setReviewItems(detail.items)
    setReviewReceiptMeta({
      status: detail.receipt.status,
      store_name: detail.receipt.store_name,
    })
  }

  async function openReview(receiptId: string) {
    setReviewReceiptId(receiptId)
    setReviewLoading(true)
    try {
      await refreshReviewDetail(receiptId)
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
    if (reviewReceiptId) await refreshReviewDetail(reviewReceiptId)
    router.refresh()
  }

  function filteredProductsForLine(lineId: string): ProductPickerRow[] {
    const q = (lineSearch[lineId] ?? '').trim().toLowerCase()
    if (!q) return products.slice(0, 80)
    return products
      .filter((p) => {
        const hay = `${p.name} ${p.brand ?? ''} ${p.format ?? ''}`.toLowerCase()
        return hay.includes(q)
      })
      .slice(0, 80)
  }

  function openCreateDialog(line: ReceiptDetailItem) {
    setCreateLineId(line.id)
    setCreateName(line.name_raw || '')
    const firstSec = sections[0]?.id ?? ''
    setCreateSectionId(firstSec)
    const cats = categories.filter((c) => c.section_id === firstSec)
    setCreateCategoryId(cats[0]?.id ?? '')
    setCreateRefPrice(
      line.unit_price != null && !Number.isNaN(line.unit_price)
        ? String(line.unit_price)
        : ''
    )
    setCreateOpen(true)
  }

  async function submitCreateProduct() {
    if (!createLineId) return
    setCreateSaving(true)
    try {
      const ref =
        createRefPrice.trim() === ''
          ? null
          : Number(createRefPrice.replace(',', '.'))
      const refNum =
        ref != null && !Number.isNaN(ref) ? ref : null

      const res = await createAndLinkProductFromReceiptLine({
        lineId: createLineId,
        name: createName,
        categoryId: createCategoryId,
        sectionId: createSectionId,
        referencePrice: refNum,
      })
      if (!res.ok) {
        toast.error(res.error ?? 'No se pudo crear')
        return
      }
      toast.success('Producto creado y línea vinculada')
      setCreateOpen(false)
      setCreateLineId(null)
      if (reviewReceiptId) await refreshReviewDetail(reviewReceiptId)
      router.refresh()
    } finally {
      setCreateSaving(false)
    }
  }

  async function runCatalogSearch(lineId: string) {
    const q = (catalogQueryByLine[lineId] ?? '').trim()
    if (q.length < 2) {
      toast.message('Escribe al menos 2 caracteres')
      return
    }
    setCatalogBusyLineId(lineId)
    try {
      const { data, error } = await searchCatalogProductsForReceipt(q)
      if (error) {
        toast.error(error)
        return
      }
      setCatalogHitsByLine((prev) => ({ ...prev, [lineId]: data }))
      if (!data.length) {
        toast.message('Sin resultados en catálogo maestro')
      }
    } finally {
      setCatalogBusyLineId(null)
    }
  }

  async function pickCatalogHit(lineId: string, catalogId: string) {
    const res = await linkPurchaseReceiptLineFromCatalog(lineId, catalogId)
    if (!res.ok) {
      toast.error(res.error ?? 'No se pudo vincular desde catálogo')
      return
    }
    toast.success('Producto del catálogo vinculado al inventario')
    if (reviewReceiptId) await refreshReviewDetail(reviewReceiptId)
    router.refresh()
  }

  async function onConfirmReceipt() {
    if (!reviewReceiptId || !canConfirmReceipt) return
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
      setReviewReceiptMeta(null)
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
              Sube una foto del ticket. La IA extrae ítems y total; al guardar solo
              queda un borrador (sin cambiar inventario) hasta que revises y
              confirmes la boleta abajo.
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
                          {it.lineTotal != null ? ` — ${it.lineTotal}` : ''}
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
      </div>

      {reviewReceiptId ? (
        <div className="app-panel space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Revisión de boleta
              </h2>
              {reviewReceiptMeta ? (
                <p className="text-[12px] text-muted-foreground">
                  {reviewReceiptMeta.store_name ?? 'Sin comercio'} ·{' '}
                  {statusLabel(reviewReceiptMeta.status)}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setReviewReceiptId(null)
                  setReviewReceiptMeta(null)
                  setReviewItems([])
                }}
              >
                Cerrar
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={
                  confirming ||
                  reviewLoading ||
                  !canConfirmReceipt
                }
                onClick={() => void onConfirmReceipt()}
              >
                {confirming ? 'Aplicando…' : 'Confirmar boleta e inventario'}
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[13px] text-foreground">
            <strong className="font-semibold">Importante:</strong> al confirmar se
            sumarán las cantidades de cada línea al stock del producto vinculado y
            se registrarán movimientos tipo compra. Guardar borrador no modifica
            inventario.
          </div>

          <div className="flex flex-wrap gap-4 text-[13px]">
            <span>
              <span className="text-muted-foreground">Pendientes:</span>{' '}
              <strong>{pendingLines.length}</strong>
            </span>
            <span>
              <span className="text-muted-foreground">Vinculadas:</span>{' '}
              <strong>{linkedLines.length}</strong>
            </span>
          </div>

          {!canConfirmReceipt && reviewItems.length > 0 ? (
            <p className="text-[13px] text-destructive">
              Confirma la boleta solo cuando todas las líneas tengan un producto del
              inventario ({pendingLines.length} línea
              {pendingLines.length !== 1 ? 's' : ''} sin vincular).
            </p>
          ) : null}

          <p className="text-[12px] text-muted-foreground">
            {PAGE_LEADS.receiptCatalogNote}
          </p>

          <p className="app-page-lead">
            Por cada línea: busca en tu inventario, crea un producto nuevo con stock
            0 (las unidades entran al confirmar la boleta) o busca en el catálogo
            maestro para crear el ítem del hogar automáticamente.
          </p>

          {reviewLoading ? (
            <p className="text-[13px] text-muted-foreground">Cargando…</p>
          ) : (
            <div className="space-y-6">
              {reviewItems.map((line) => {
                const linked = !!line.product_id
                return (
                  <div
                    key={line.id}
                    className="rounded-lg border border-border bg-muted/20 p-3 space-y-3"
                  >
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-[13px]">
                      <div>
                        <div className="text-muted-foreground text-[11px] uppercase tracking-wide">
                          Texto en boleta
                        </div>
                        <div className="font-medium">{line.name_raw}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-[11px] uppercase tracking-wide">
                          Cantidad
                        </div>
                        <div className="tabular-nums">{line.quantity ?? '—'}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-[11px] uppercase tracking-wide">
                          Precio línea
                        </div>
                        <div className="tabular-nums">
                          {formatMoney(line.unit_price)}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-[11px] uppercase tracking-wide">
                          Estado
                        </div>
                        <span
                          className={
                            linked
                              ? 'inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-800 dark:text-emerald-200'
                              : 'inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-900 dark:text-amber-100'
                          }
                        >
                          {linked ? 'Vinculada' : 'Pendiente'}
                        </span>
                      </div>
                    </div>

                    <div className="text-[13px]">
                      <span className="text-muted-foreground">Producto vinculado:</span>{' '}
                      <strong>
                        {linked
                          ? line.linked_product_name ?? line.product_id
                          : '—'}
                      </strong>
                    </div>

                    {!linked ? (
                      <>
                        <div className="space-y-2">
                          <Label className="app-field-label">
                            Buscar en inventario del hogar
                          </Label>
                          <Input
                            className="app-input"
                            placeholder="Filtrar por nombre…"
                            value={lineSearch[line.id] ?? ''}
                            onChange={(e) =>
                              setLineSearch((prev) => ({
                                ...prev,
                                [line.id]: e.target.value,
                              }))
                            }
                          />
                          <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto">
                            {filteredProductsForLine(line.id).map((p) => (
                              <Button
                                key={p.id}
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="h-auto max-w-[220px] justify-start whitespace-normal py-1.5 text-left text-[12px]"
                                onClick={() =>
                                  void onLineProduct(line.id, p.id)
                                }
                              >
                                {p.name}
                                {p.brand ? (
                                  <span className="text-muted-foreground">
                                    {' '}
                                    · {p.brand}
                                  </span>
                                ) : null}
                              </Button>
                            ))}
                          </div>
                          <div className="flex flex-wrap gap-2 pt-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openCreateDialog(line)}
                            >
                              Crear producto nuevo (stock 0 hasta confirmar boleta)
                            </Button>
                          </div>
                        </div>

                        <div className="border-t border-border pt-3 space-y-2">
                          <Label className="app-field-label">
                            Catálogo maestro (global)
                          </Label>
                          <div className="flex flex-wrap gap-2 items-end">
                            <Input
                              className="app-input max-w-xs"
                              placeholder="Buscar por nombre (mín. 2 caracteres)"
                              value={catalogQueryByLine[line.id] ?? ''}
                              onChange={(e) =>
                                setCatalogQueryByLine((prev) => ({
                                  ...prev,
                                  [line.id]: e.target.value,
                                }))
                              }
                            />
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              disabled={catalogBusyLineId === line.id}
                              onClick={() => void runCatalogSearch(line.id)}
                            >
                              {catalogBusyLineId === line.id
                                ? 'Buscando…'
                                : 'Buscar'}
                            </Button>
                          </div>
                          {(catalogHitsByLine[line.id] ?? []).length > 0 ? (
                            <ul className="space-y-1 text-[13px]">
                              {(catalogHitsByLine[line.id] ?? []).map((hit) => (
                                <li
                                  key={hit.id}
                                  className="flex flex-wrap items-center gap-2"
                                >
                                  <span>
                                    {hit.name}
                                    {hit.brand ? (
                                      <span className="text-muted-foreground">
                                        {' '}
                                        · {hit.brand}
                                      </span>
                                    ) : null}
                                  </span>
                                  <Button
                                    type="button"
                                    variant="link"
                                    size="sm"
                                    className="h-auto p-0 text-[13px]"
                                    onClick={() =>
                                      void pickCatalogHit(line.id, hit.id)
                                    }
                                  >
                                    Usar en inventario
                                  </Button>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-wrap gap-2 items-center text-[13px]">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void onLineProduct(line.id, NONE)}
                        >
                          Quitar vínculo
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}

              {reviewItems.length === 0 ? (
                <p className="text-muted-foreground text-[13px]">
                  Sin líneas en esta boleta.
                </p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo producto desde boleta</DialogTitle>
            <DialogDescription>
              Se crea con stock 0 en el inventario del hogar. Las unidades de esta
              línea se suman cuando confirmas la boleta.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="rcp-name">Nombre</Label>
              <Input
                id="rcp-name"
                className="app-input"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Sección</Label>
                <Select
                  value={createSectionId || undefined}
                  onValueChange={(v) => {
                    setCreateSectionId(v)
                    const cats = categories.filter((c) => c.section_id === v)
                    setCreateCategoryId(cats[0]?.id ?? '')
                  }}
                >
                  <SelectTrigger className="app-input">
                    <SelectValue placeholder="Sección" />
                  </SelectTrigger>
                  <SelectContent>
                    {sections.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Categoría</Label>
                <Select
                  value={createCategoryId || undefined}
                  onValueChange={setCreateCategoryId}
                >
                  <SelectTrigger className="app-input">
                    <SelectValue placeholder="Categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    {categoriesForSection.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rcp-price">Precio referencia (opcional)</Label>
              <Input
                id="rcp-price"
                className="app-input"
                inputMode="decimal"
                value={createRefPrice}
                onChange={(e) => setCreateRefPrice(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={
                createSaving ||
                !createName.trim() ||
                !createSectionId ||
                !createCategoryId
              }
              onClick={() => void submitCreateProduct()}
            >
              {createSaving ? 'Guardando…' : 'Crear y vincular'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
