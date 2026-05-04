'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { addProductFromCapture } from '@/app/actions/capture'
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

type Category = { id: string; name: string }
type Section = { id: string; name: string }

type ProductAnalysis = {
  name?: string
  brand?: string | null
  productType?: string | null
  presentation?: string | null
  netQuantity?: number | null
  netUnit?: string | null
  format?: string | null
  unit?: string | null
  categoryGuess?: string | null
  notes?: string | null
}

function buildFormatFromAnalysis(a: ProductAnalysis): string {
  const direct =
    typeof a.format === 'string' && a.format.trim().length > 0
      ? a.format.trim()
      : ''
  if (direct) return direct
  const parts = [
    typeof a.productType === 'string' ? a.productType.trim() : '',
    typeof a.presentation === 'string' ? a.presentation.trim() : '',
  ].filter(Boolean)
  return parts.join(' · ')
}

function buildUnitFromAnalysis(a: ProductAnalysis): string {
  const direct =
    typeof a.unit === 'string' && a.unit.trim().length > 0
      ? a.unit.trim()
      : ''
  if (direct) return direct
  const q = a.netQuantity
  const u =
    typeof a.netUnit === 'string' && a.netUnit.trim().length > 0
      ? a.netUnit.trim()
      : ''
  if (typeof q === 'number' && !Number.isNaN(q) && u) {
    return `${q} ${u}`
  }
  return ''
}

function buildNotesHint(a: ProductAnalysis): string | null {
  const bits: string[] = []
  if (typeof a.notes === 'string' && a.notes.trim())
    bits.push(a.notes.trim())
  if (typeof a.categoryGuess === 'string' && a.categoryGuess.trim()) {
    bits.push(`Categoría sugerida: ${a.categoryGuess.trim()}`)
  }
  if (bits.length === 0) return null
  return bits.join(' · ')
}

interface CaptureViewProps {
  profileId: string
  categories: Category[]
  sections: Section[]
}

export function CaptureView({
  profileId,
  categories,
  sections,
}: CaptureViewProps) {
  const router = useRouter()
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '')
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? '')
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)

  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [format, setFormat] = useState('')
  const [unit, setUnit] = useState('')
  const [notesHint, setNotesHint] = useState<string | null>(null)
  const [lastVision, setLastVision] = useState<VisionAnalysisMeta | null>(null)

  function onPickFile(f: File | null) {
    setFile(f)
    setLastVision(null)
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return f ? URL.createObjectURL(f) : null
    })
  }

  async function analyze() {
    if (!file) {
      toast.error('Selecciona una foto del producto')
      return
    }
    setAnalyzing(true)
    try {
      const mimeType = resolveApiImageMimeType(file)
      const imageBase64 = await fileToBase64(file)
      const res = await fetch('/api/ai/analyze-product', {
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
      setLastVision(json.vision ?? null)
      const a = json.analysis as ProductAnalysis
      setName(typeof a.name === 'string' ? a.name : '')
      setBrand(a.brand != null ? String(a.brand) : '')
      setFormat(buildFormatFromAnalysis(a))
      setUnit(buildUnitFromAnalysis(a))
      setNotesHint(buildNotesHint(a))
      toast.success('Sugerencias aplicadas — revisa tipo, marca y contenido neto')
    } catch {
      toast.error('Error de red al analizar')
    } finally {
      setAnalyzing(false)
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!name.trim()) {
      toast.error('Indica un nombre de producto')
      return
    }
    if (!categoryId || !sectionId) {
      toast.error('Selecciona categoría y sección')
      return
    }
    setSaving(true)
    try {
      const fd = new FormData(e.currentTarget)
      fd.set('category_id', categoryId)
      fd.set('section_id', sectionId)
      if (file) {
        fd.set('image', file)
      }
      const result = await addProductFromCapture(fd)
      if (!result.ok) {
        toast.error('error' in result ? result.error : 'Error al guardar')
        return
      }
      toast.success('Producto agregado al inventario')
      setFile(null)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
      setName('')
      setBrand('')
      setFormat('')
      setUnit('')
      setNotesHint(null)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  if (categories.length === 0 || sections.length === 0) {
    return (
      <div className="app-panel">
        <p className="app-page-lead">
          Necesitas al menos una categoría y una sección en la base de datos
          para crear productos por captura.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="app-panel space-y-4">
        <h2 className="text-sm font-semibold text-foreground">1. Foto</h2>
        <p className="app-page-lead">
          Foto nítida de la etiqueta o frente del envase. La IA intenta leer
          marca, tipo de producto, presentación y contenido neto (g, ml, L). Si un
          proveedor falla, se intenta el siguiente según tu cadena en variables
          de entorno.
        </p>
        <Input
          type="file"
          accept="image/*"
          className="app-input cursor-pointer"
          onChange={(ev) => onPickFile(ev.target.files?.[0] ?? null)}
        />
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="Vista previa"
            className="max-h-56 w-full rounded-xl border border-border object-contain bg-muted/30"
          />
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

      <form className="app-panel space-y-4" onSubmit={onSubmit}>
        <h2 className="text-sm font-semibold text-foreground">
          2. Confirmar y guardar
        </h2>
        {notesHint ? (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
            {notesHint}
          </p>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="name" className="app-field-label">
            Nombre
          </Label>
          <Input
            id="name"
            name="name"
            className="app-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <span className="app-field-label">Categoría</span>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="app-input w-full border-input">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <span className="app-field-label">Sección</span>
            <Select value={sectionId} onValueChange={setSectionId}>
              <SelectTrigger className="app-input w-full border-input">
                <SelectValue />
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
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="brand" className="app-field-label">
              Marca
            </Label>
            <Input
              id="brand"
              name="brand"
              className="app-input"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="format" className="app-field-label">
              Tipo / presentación
            </Label>
            <Input
              id="format"
              name="format"
              className="app-input"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="unit" className="app-field-label">
              Contenido / unidad (ej. 500 g, 1 L)
            </Label>
            <Input
              id="unit"
              name="unit"
              className="app-input"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="stock_current" className="app-field-label">
              Stock inicial
            </Label>
            <Input
              id="stock_current"
              name="stock_current"
              type="number"
              step="0.01"
              min="0"
              className="app-input"
              defaultValue={1}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stock_min" className="app-field-label">
              Stock mín.
            </Label>
            <Input
              id="stock_min"
              name="stock_min"
              type="number"
              step="0.01"
              min="0"
              className="app-input"
              placeholder="Opcional"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reference_price" className="app-field-label">
              Precio ref.
            </Label>
            <Input
              id="reference_price"
              name="reference_price"
              type="number"
              step="0.01"
              min="0"
              className="app-input"
              placeholder="Opcional"
            />
          </div>
        </div>

        <div className="app-form-actions justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar en inventario'}
          </Button>
        </div>
      </form>
    </div>
  )
}
