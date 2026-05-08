'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { addProductFromCapture } from '@/app/actions/capture'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { VisionOpenRouterTierSelect } from '@/components/vision-openrouter-tier-select'
import { VisionAnalysisNote } from '@/components/vision-analysis-note'
import { pickCatalogTaxonomyFromGuess } from '@/lib/catalog-taxonomy-match'
import { createThumbnailPreviewUrl } from '@/lib/capture-preview-thumb'
import { captureTrace } from '@/lib/capture-trace'
import {
  messageFromAiApiError,
  messageWhenAiApiBodyNotJson,
  readAiApiJsonBody,
} from '@/lib/ai-api-error'
import { buildVisionAnalysisImagePayload } from '@/lib/capture-vision-image'
import { STOCK_ZONE_OPTIONS, stockZoneLabel } from '@/lib/stock-zones'
import type { OpenRouterStockCheckTier } from '@/types/open-router-stock-check-tier'
import type { VisionAnalysisMeta } from '@/types/vision-meta'
import type { TaxonomyCategory, TaxonomySection } from '@/types/taxonomy'

/** Respuesta enriquecida de `/api/ai/analyze-product` (cadena ítem). */
type EnrichedVisionProduct = {
  name: string
  brand: string | null
  format: string | null
  unit: string | null
  categoryGuess: string | null
  notes: string | null
  enrichment?: { matched: boolean; source?: string } | null
}

function buildNotesHint(params: {
  notes?: string | null
  categoryGuess?: string | null
}): string | null {
  const bits: string[] = []
  const n = params.notes
  if (typeof n === 'string' && n.trim()) bits.push(n.trim())
  const cg = params.categoryGuess
  if (typeof cg === 'string' && cg.trim())
    bits.push(`Categoría sugerida: ${cg.trim()}`)
  if (bits.length === 0) return null
  return bits.join(' · ')
}

type DetectedRow = {
  key: string
  originShort: string
  originTitle: string
  sectionId: string
  categoryId: string
  name: string
  brand: string
  format: string
  unit: string
  notesHint: string | null
  include: boolean
  stock: number
}

function enrichmentLabels(p: EnrichedVisionProduct): {
  originShort: string
  originTitle: string
} {
  if (p.enrichment?.matched) {
    return {
      originShort: 'OFF',
      originTitle:
        'Coincidencia en Open Food Facts (fuente externa). El catálogo interno del sistema no se consulta en este paso.',
    }
  }
  return {
    originShort: 'Nuevo',
    originTitle:
      'Sin coincidencia automática: se creará una ficha nueva en tu inventario al guardar.',
  }
}

function enrichedToDetectedRow(
  p: EnrichedVisionProduct,
  categories: TaxonomyCategory[]
): DetectedRow | null {
  const picked = pickCatalogTaxonomyFromGuess(
    typeof p.categoryGuess === 'string' ? p.categoryGuess : null,
    categories
  )
  if (!picked) return null

  const categoryGuess =
    typeof p.categoryGuess === 'string' ? p.categoryGuess : null
  const notes = typeof p.notes === 'string' ? p.notes : null
  const { originShort, originTitle } = enrichmentLabels(p)

  return {
    key:
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now()) + Math.random(),
    originShort,
    originTitle,
    sectionId: picked.sectionId,
    categoryId: picked.categoryId,
    name: typeof p.name === 'string' ? p.name : '',
    brand: p.brand != null ? String(p.brand) : '',
    format: p.format != null ? String(p.format) : '',
    unit: p.unit != null ? String(p.unit) : '',
    notesHint: buildNotesHint({
      notes,
      categoryGuess,
    }),
    include: Boolean(p.name?.trim()) && String(p.name).trim() !== 'Desconocido',
    stock: 1,
  }
}

interface CaptureViewProps {
  profileId: string
  categories: TaxonomyCategory[]
  sections: TaxonomySection[]
}

export function CaptureView({
  profileId,
  categories,
  sections,
}: CaptureViewProps) {
  const router = useRouter()

  const [openRouterTier, setOpenRouterTier] =
    useState<OpenRouterStockCheckTier>('free_first')
  const [zone, setZone] = useState(STOCK_ZONE_OPTIONS[0]?.value ?? 'alacena')
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)

  const [detected, setDetected] = useState<DetectedRow[]>([])
  const [lastVision, setLastVision] = useState<VisionAnalysisMeta | null>(null)

  const categoryById = useMemo(() => {
    const m = new Map<string, TaxonomyCategory>()
    for (const c of categories) {
      m.set(c.id, c)
    }
    return m
  }, [categories])

  const sectionsOrdered = useMemo(
    () =>
      [...sections].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
      ),
    [sections]
  )

  function updateRow(key: string, patch: Partial<DetectedRow>) {
    setDetected((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r))
    )
  }

  function removeRow(key: string) {
    setDetected((prev) => prev.filter((r) => r.key !== key))
  }

  function clearAiDraft() {
    setLastVision(null)
    setDetected([])
  }

  async function onPickFile(f: File | null) {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setPreviewError(null)
    setFile(f)
    clearAiDraft()

    if (!f) {
      captureTrace('file_cleared', {})
      return
    }

    captureTrace('file_selected', {
      name: f.name,
      size: f.size,
      type: f.type,
    })

    try {
      const thumb = await createThumbnailPreviewUrl(f, 280)
      setPreviewUrl(thumb.url)
      captureTrace('thumbnail_ready', {
        thumbW: thumb.thumbWidth,
        thumbH: thumb.thumbHeight,
        thumbBytesApprox: thumb.thumbBytesApprox,
        originalBytes: f.size,
      })
    } catch (e) {
      setPreviewError(
        'No se pudo generar miniatura en este navegador (p. ej. HEIC sin soporte). La foto igual se puede analizar.'
      )
      captureTrace('thumbnail_failed', { error: String(e) })
    }
  }

  async function analyze() {
    if (!file) {
      toast.error('Selecciona una foto')
      return
    }
    setAnalyzing(true)
    try {
      const payload = await buildVisionAnalysisImagePayload(file)
      captureTrace('analyze_request', {
        originalBytes: file.size,
        base64Chars: payload.imageBase64.length,
        mimeType: payload.mimeType,
        visionDownscaled: !payload.usedOriginalFile,
      })
      const res = await fetch('/api/ai/analyze-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId,
          imageBase64: payload.imageBase64,
          mimeType: payload.mimeType,
          openRouterTier,
        }),
      })
      const parsed = await readAiApiJsonBody<{
        error?: string
        hint?: string
        products?: EnrichedVisionProduct[]
        enriched?: EnrichedVisionProduct | null
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
      setLastVision(json.vision ?? null)

      let list: EnrichedVisionProduct[] = []
      if (Array.isArray(json.products) && json.products.length > 0) {
        list = json.products.filter((p) => p && typeof p.name === 'string')
      } else if (json.enriched && typeof json.enriched.name === 'string') {
        list = [json.enriched]
      }

      if (list.length === 0) {
        setDetected([])
        toast.warning('No se pudieron obtener productos a partir del análisis.')
        return
      }

      const rows = list
        .map((p) => enrichedToDetectedRow(p, categories))
        .filter((r): r is DetectedRow => r != null)

      setDetected(rows)
      toast.success(
        rows.length > 1
          ? `${rows.length} productos detectados en la foto — revisa cada fila antes de guardar.`
          : 'Sugerencia aplicada — revisa categoría de catálogo, marca y cantidad antes de guardar.'
      )
    } catch {
      toast.error('Error de red al analizar')
    } finally {
      setAnalyzing(false)
    }
  }

  async function saveSelected() {
    const selected = detected.filter((r) => r.include && r.name.trim())
    if (selected.length === 0) {
      toast.error(
        'Incluye al menos un ítem con nombre válido o marca los productos detectados.'
      )
      return
    }

    for (const row of selected) {
      if (!row.categoryId || !row.sectionId) {
        toast.error(
          'Cada ítem debe tener categoría del catálogo (revisa la columna correspondiente).'
        )
        return
      }
    }

    captureTrace('save_batch_start', {
      rows: selected.length,
      uploadFullImage: false,
    })

    setSaving(true)
    let okCount = 0
    let lastError: string | null = null

    try {
      for (const row of selected) {
        const fd = new FormData()
        fd.set('name', row.name.trim())
        fd.set('brand', row.brand.trim())
        fd.set('format', row.format.trim())
        fd.set('unit', row.unit.trim())
        fd.set('stock_current', String(row.stock))
        fd.set('category_id', row.categoryId)
        fd.set('section_id', row.sectionId)
        fd.set('location', zone)
        const result = await addProductFromCapture(fd)
        if (!result.ok) {
          lastError = 'error' in result ? result.error : 'Error al guardar'
          break
        }
        okCount += 1
      }

      if (lastError) {
        toast.error(
          okCount > 0
            ? `Se guardaron ${okCount}; luego hubo error: ${lastError}`
            : lastError
        )
        router.refresh()
        return
      }

      captureTrace('save_batch_ok', { saved: okCount })

      toast.success(
        okCount > 1
          ? `${okCount} productos guardados en el inventario`
          : 'Producto agregado al inventario'
      )
      setFile(null)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
      setPreviewError(null)
      setDetected([])
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  const includedCount = detected.filter((r) => r.include && r.name.trim()).length

  if (categories.length === 0 || sections.length === 0) {
    return (
      <div className="app-panel">
        <p className="app-page-lead">
          Necesitas al menos una categoría y una sección en el catálogo global para
          usar Inventario · Cargar por fotos.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="app-panel space-y-4">
        <h2 className="text-sm font-semibold text-foreground">
          1. Modelo, zona y foto
        </h2>
        <p className="app-page-lead">
          Mismo orden que <strong>Chequeo de stock</strong>: primero modelos
          OpenRouter, luego la <strong>zona física</strong> del hogar (lista fija
          para todas las ubicaciones), después la imagen. Antes de enviarla al
          modelo, la foto se <strong>optimiza en el navegador</strong> (tamaño y
          JPEG) para que el análisis sea más rápido. La categoría de cada producto
          se toma del <strong>catálogo global</strong> según la sugerencia de la IA
          (puedes corregirla por fila).
        </p>

        <VisionOpenRouterTierSelect
          value={openRouterTier}
          disabled={analyzing}
          onValueChange={(v) => {
            setOpenRouterTier(v)
            clearAiDraft()
          }}
        />

        <div className="space-y-1.5">
          <span className="app-field-label">Zona</span>
          <Select
            value={zone}
            onValueChange={(v) => {
              setZone(v)
              clearAiDraft()
            }}
          >
            <SelectTrigger className="app-input w-full border-input">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STOCK_ZONE_OPTIONS.map((z) => (
                <SelectItem key={z.value} value={z.value}>
                  {z.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[12px] text-muted-foreground">
            Equivalente a la zona del chequeo de stock. Toda ubicación usa estas mismas
            opciones por defecto.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="capture-photo" className="app-field-label">
            Foto
          </Label>
          <Input
            id="capture-photo"
            type="file"
            accept="image/*"
            className="app-input cursor-pointer"
            onChange={(ev) => void onPickFile(ev.target.files?.[0] ?? null)}
          />
        </div>

        {previewError ? (
          <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
            {previewError}
          </p>
        ) : null}

        {previewUrl ? (
          <div className="space-y-1">
            <img
              src={previewUrl}
              alt="Miniatura local para orientación (no es la imagen completa)"
              className="mx-auto max-h-40 max-w-[280px] rounded-lg border border-border object-contain bg-muted/20 shadow-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Solo miniatura (~280px). La imagen original no se muestra ni se sube al inventario;
              cuando exista recorte por producto se podrá adjuntar únicamente ese recorte.
            </p>
          </div>
        ) : null}

        <Button
          type="button"
          variant="secondary"
          onClick={() => void analyze()}
          disabled={!file || analyzing}
        >
          {analyzing ? 'Analizando…' : 'Analizar con IA'}
        </Button>
        <VisionAnalysisNote vision={lastVision} />
      </div>

      <div className="app-panel space-y-4">
        <h2 className="text-sm font-semibold text-foreground">
          2. Revisar y guardar
        </h2>
        <p className="app-page-lead text-[13px] text-muted-foreground">
          Para cada fila marcada se crea una ficha en el inventario con la{' '}
          <strong>sección y categoría del catálogo global</strong> elegidas por
          ítem. La <strong>zona</strong> del paso anterior ({stockZoneLabel(zone)})
          se guarda como ubicación física del producto. No se sube la foto de la escena:
          solo tendría sentido guardar un recorte por ítem cuando el flujo lo soporte.
        </p>

        {detected.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
            Analiza una foto para ver las sugerencias.
          </p>
        ) : (
          <div className="app-data-table-wrap max-h-[min(60vh,520px)] overflow-auto">
            <table className="app-data-table min-w-[72rem] text-[13px]">
              <thead>
                <tr>
                  <th className="w-10 text-center" title="Incluir al guardar">
                    ✓
                  </th>
                  <th className="w-[72px]" title="Origen de los datos sugeridos">
                    Origen
                  </th>
                  <th>Nombre</th>
                  <th>Marca</th>
                  <th className="min-w-[10rem]">Categoría (catálogo)</th>
                  <th className="w-20 text-right">Stock</th>
                  <th>Presentación</th>
                  <th>Unidad</th>
                  <th className="max-w-[120px]">Notas</th>
                  <th className="w-14" />
                </tr>
              </thead>
              <tbody>
                {detected.map((row) => (
                  <tr key={row.key}>
                    <td className="text-center align-middle">
                      <input
                        type="checkbox"
                        checked={row.include}
                        onChange={(e) =>
                          updateRow(row.key, { include: e.target.checked })
                        }
                        className="h-4 w-4 rounded border-input"
                        aria-label="Incluir al guardar"
                      />
                    </td>
                    <td
                      className="align-middle font-medium tabular-nums"
                      title={row.originTitle}
                    >
                      {row.originShort}
                    </td>
                    <td className="align-middle">
                      <Input
                        className="app-input h-8 min-w-[10rem] py-1 text-[13px]"
                        value={row.name}
                        onChange={(e) =>
                          updateRow(row.key, { name: e.target.value })
                        }
                      />
                    </td>
                    <td className="align-middle">
                      <Input
                        className="app-input h-8 min-w-[6rem] py-1 text-[13px]"
                        value={row.brand}
                        onChange={(e) =>
                          updateRow(row.key, { brand: e.target.value })
                        }
                      />
                    </td>
                    <td className="align-middle">
                      <Select
                        value={row.categoryId}
                        onValueChange={(catId) => {
                          const c = categoryById.get(catId)
                          if (c) {
                            updateRow(row.key, {
                              categoryId: catId,
                              sectionId: c.section_id,
                            })
                          }
                        }}
                      >
                        <SelectTrigger className="app-input h-8 max-w-[14rem] border-input py-1 text-[13px]">
                          <SelectValue placeholder="Categoría" />
                        </SelectTrigger>
                        <SelectContent>
                          {sectionsOrdered.map((s) => (
                            <SelectGroup key={s.id}>
                              <SelectLabel>{s.name}</SelectLabel>
                              {categories
                                .filter((c) => c.section_id === s.id)
                                .sort(
                                  (a, b) =>
                                    (a.sort_order ?? 0) - (b.sort_order ?? 0)
                                )
                                .map((c) => (
                                  <SelectItem key={c.id} value={c.id}>
                                    {c.name}
                                  </SelectItem>
                                ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="align-middle">
                      <Input
                        className="app-input h-8 w-[4.25rem] py-1 text-[13px]"
                        type="number"
                        step={1}
                        min={0}
                        inputMode="numeric"
                        value={row.stock}
                        onChange={(e) =>
                          updateRow(row.key, {
                            stock: Math.max(
                              0,
                              Math.round(Number(e.target.value) || 0)
                            ),
                          })
                        }
                      />
                    </td>
                    <td className="align-middle">
                      <Input
                        className="app-input h-8 min-w-[5rem] py-1 text-[13px]"
                        value={row.format}
                        onChange={(e) =>
                          updateRow(row.key, { format: e.target.value })
                        }
                      />
                    </td>
                    <td className="align-middle">
                      <Input
                        className="app-input h-8 min-w-[5rem] py-1 text-[13px]"
                        value={row.unit}
                        onChange={(e) =>
                          updateRow(row.key, { unit: e.target.value })
                        }
                      />
                    </td>
                    <td
                      className="max-w-[120px] truncate align-middle text-[12px] text-muted-foreground"
                      title={row.notesHint ?? undefined}
                    >
                      {row.notesHint ?? '—'}
                    </td>
                    <td className="align-middle">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-muted-foreground"
                        onClick={() => removeRow(row.key)}
                      >
                        Quitar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="app-form-actions flex-wrap justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {detected.length > 0
              ? `${includedCount} de ${detected.length} ítem(s) se guardará(n).`
              : null}
          </p>
          <Button
            type="button"
            disabled={saving || includedCount === 0}
            onClick={() => void saveSelected()}
          >
            {saving
              ? 'Guardando…'
              : includedCount > 1
                ? `Guardar ${includedCount} en inventario`
                : 'Guardar en inventario'}
          </Button>
        </div>
      </div>
    </div>
  )
}
