'use client'

import type { ProductPickerRow } from '@/app/actions/receipts'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  deleteStockCheckDetectedItem,
  saveProfileBrand,
  saveProfilePresentation,
  saveProfileProductType,
  type MeasureUnitRow,
  type NetContentOptionRow,
  type ProfileBrandRow,
  type ProfileCatalogRow,
  type StockCheckDetailItem,
  updateStockCheckDetectedItem,
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
import { parseNetFromProductUnit } from '@/lib/stock-check-scan-rows'

const NONE = '__none__'
const PID_MANUAL = '__manual__'
const CAT_NONE = '__cat_none__'
const CAT_CUSTOM = '__cat_custom__'
const BRAND_NONE = '__brand_none__'
const BRAND_CUSTOM = '__brand_custom__'
const NET_CUSTOM = '__net_custom__'
const QTY_NONE = '__qty_none__'
const QTY_MANUAL = '__qty_manual__'
const UNIT_OTHER = '__unit_other__'

const VISIBLE_QTY_OPTIONS = Array.from({ length: 48 }, (_, i) => i + 1)

function catalogSelectValue(
  current: string,
  catalogNames: Set<string>
): string {
  const t = current.trim()
  if (!t) return CAT_NONE
  if (catalogNames.has(t)) return t
  return CAT_CUSTOM
}

function brandSelectValue(
  current: string,
  catalogNames: Set<string>
): string {
  const t = current.trim()
  if (!t) return BRAND_NONE
  if (catalogNames.has(t)) return t
  return BRAND_CUSTOM
}

function matchNetPresetId(
  netQty: string,
  netUnit: string,
  opts: NetContentOptionRow[]
): string {
  if (netQty.trim() === '' || netUnit.trim() === '') return NET_CUSTOM
  const q = Number(netQty)
  if (!Number.isFinite(q)) return NET_CUSTOM
  const u = netUnit.trim().toLowerCase()
  const hit = opts.find(
    (o) =>
      Number(o.net_quantity) === q &&
      o.unit_code.trim().toLowerCase() === u
  )
  return hit?.id ?? NET_CUSTOM
}

function netUnitCodeValue(
  code: string,
  knownLower: Set<string>
): string {
  const t = code.trim().toLowerCase()
  if (!t) return CAT_NONE
  if (knownLower.has(t)) return t
  return UNIT_OTHER
}

export function StockCheckLineEditDialog({
  open,
  onOpenChange,
  item,
  products,
  brands,
  productTypes,
  presentations,
  measureUnits,
  netContentOptions,
  onSaved,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  item: StockCheckDetailItem | null
  products: ProductPickerRow[]
  brands: ProfileBrandRow[]
  productTypes: ProfileCatalogRow[]
  presentations: ProfileCatalogRow[]
  measureUnits: MeasureUnitRow[]
  netContentOptions: NetContentOptionRow[]
  onSaved: () => void
  onDeleted: () => void
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [productType, setProductType] = useState('')
  const [presentation, setPresentation] = useState('')
  const [netQty, setNetQty] = useState('')
  const [netUnit, setNetUnit] = useState('')
  const [notes, setNotes] = useState('')
  const [qtyVisible, setQtyVisible] = useState('')
  const [markedInvalid, setMarkedInvalid] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [productId, setProductId] = useState<string>(NONE)
  const [inventoryPick, setInventoryPick] = useState(PID_MANUAL)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [savingBrand, setSavingBrand] = useState(false)
  const [savingType, setSavingType] = useState(false)
  const [savingPres, setSavingPres] = useState(false)

  const brandNameSet = useMemo(
    () => new Set(brands.map((b) => b.name)),
    [brands]
  )
  const typeNameSet = useMemo(
    () => new Set(productTypes.map((t) => t.name)),
    [productTypes]
  )
  const presNameSet = useMemo(
    () => new Set(presentations.map((p) => p.name)),
    [presentations]
  )
  const unitCodeLower = useMemo(
    () => new Set(measureUnits.map((u) => u.code.trim().toLowerCase())),
    [measureUnits]
  )

  useEffect(() => {
    if (!item) return
    setName(item.name_guess)
    setBrand(item.brand_guess ?? '')
    setProductType(item.product_type_guess ?? '')
    setPresentation(item.presentation_guess ?? '')
    setNetQty(
      item.net_quantity != null && !Number.isNaN(item.net_quantity)
        ? String(item.net_quantity)
        : ''
    )
    setNetUnit(item.net_unit ?? '')
    setNotes(item.notes ?? '')
    setQtyVisible(
      item.quantity_guess != null && !Number.isNaN(item.quantity_guess)
        ? String(Math.round(item.quantity_guess))
        : ''
    )
    setMarkedInvalid(item.marked_invalid === true)
    setAccepted(item.accepted === true)
    setProductId(item.product_id ?? NONE)
    setInventoryPick(PID_MANUAL)
  }, [item])

  const netPreset = useMemo(
    () => matchNetPresetId(netQty, netUnit, netContentOptions),
    [netQty, netUnit, netContentOptions]
  )

  const qtySelectVal = useMemo(() => {
    if (qtyVisible.trim() === '') return QTY_NONE
    const n = Number(qtyVisible)
    if (!Number.isFinite(n)) return QTY_NONE
    const ri = Math.round(n)
    if (n === ri && VISIBLE_QTY_OPTIONS.includes(ri)) return String(ri)
    return QTY_MANUAL
  }, [qtyVisible])

  async function onSave() {
    if (!item) return
    setSaving(true)
    try {
      const nq = netQty.trim() === '' ? null : Number(netQty)
      if (netQty.trim() !== '' && (nq == null || Number.isNaN(nq))) {
        toast.error('Contenido neto: número inválido')
        return
      }
      const qv =
        qtySelectVal === QTY_NONE
          ? null
          : qtySelectVal === QTY_MANUAL
            ? qtyVisible.trim() === ''
              ? null
              : Number(qtyVisible)
            : Number(qtySelectVal)
      if (qv != null && Number.isNaN(qv)) {
        toast.error('Unidades visibles: número inválido')
        return
      }
      const res = await updateStockCheckDetectedItem(item.id, {
        nameGuess: name,
        brandGuess: brand.trim() || null,
        productTypeGuess: productType.trim() || null,
        presentationGuess: presentation.trim() || null,
        netQuantity: nq,
        netUnit: netUnit.trim() || null,
        notes: notes.trim() || null,
        quantityGuess: qv,
        markedInvalid,
        accepted,
        productId: productId === NONE ? null : productId,
      })
      if (!res.ok) {
        toast.error(res.error ?? 'No se pudo guardar')
        return
      }
      toast.success('Línea actualizada')
      onOpenChange(false)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  async function onDelete() {
    if (!item) return
    if (!window.confirm('¿Eliminar esta línea del chequeo?')) return
    setDeleting(true)
    try {
      const res = await deleteStockCheckDetectedItem(item.id)
      if (!res.ok) {
        toast.error(res.error ?? 'No se pudo eliminar')
        return
      }
      toast.success('Línea eliminada')
      onOpenChange(false)
      onDeleted()
    } finally {
      setDeleting(false)
    }
  }

  async function onRememberBrand() {
    const trimmed = brand.trim()
    if (!trimmed) {
      toast.error('Escribe o elige una marca primero')
      return
    }
    setSavingBrand(true)
    try {
      const res = await saveProfileBrand(trimmed)
      if (!res.ok) {
        toast.error(res.error ?? 'No se pudo guardar la marca')
        return
      }
      toast.success('Marca guardada para autocompletado')
      router.refresh()
    } finally {
      setSavingBrand(false)
    }
  }

  async function onRememberProductType() {
    const trimmed = productType.trim()
    if (!trimmed) return
    setSavingType(true)
    try {
      const res = await saveProfileProductType(trimmed)
      if (!res.ok) {
        toast.error(res.error ?? 'No se pudo guardar el tipo')
        return
      }
      toast.success('Tipo guardado')
      router.refresh()
    } finally {
      setSavingType(false)
    }
  }

  async function onRememberPresentation() {
    const trimmed = presentation.trim()
    if (!trimmed) return
    setSavingPres(true)
    try {
      const res = await saveProfilePresentation(trimmed)
      if (!res.ok) {
        toast.error(res.error ?? 'No se pudo guardar la presentación')
        return
      }
      toast.success('Presentación guardada')
      router.refresh()
    } finally {
      setSavingPres(false)
    }
  }

  const brandVal = brandSelectValue(brand, brandNameSet)
  const typeVal = catalogSelectValue(productType, typeNameSet)
  const presVal = catalogSelectValue(presentation, presNameSet)
  const unitCodeVal = netUnitCodeValue(netUnit, unitCodeLower)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[min(90vh,calc(100vh-2rem))] max-w-lg overflow-y-auto gap-4"
        showCloseButton
      >
        <DialogHeader>
          <DialogTitle>Editar línea del chequeo</DialogTitle>
          <p className="text-[12px] text-muted-foreground">
            Corrige lo que la IA leyó mal. Las líneas marcadas como error no se
            aplican al inventario.
          </p>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="sc-fill">Rellenar desde inventario (opcional)</Label>
            <Select
              value={inventoryPick}
              onValueChange={(v) => {
                setInventoryPick(v)
                if (v === PID_MANUAL) return
                const p = products.find((x) => x.id === v)
                if (!p) return
                const net = parseNetFromProductUnit(p.unit)
                setName(p.name)
                setBrand(p.brand?.trim() ?? '')
                setPresentation(p.format?.trim() ?? presentation)
                if (net.quantity != null) setNetQty(String(net.quantity))
                if (net.unitCode) setNetUnit(net.unitCode)
              }}
            >
              <SelectTrigger id="sc-fill" className="app-input w-full border-input">
                <SelectValue placeholder="Producto del inventario…" />
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-64">
                <SelectItem value={PID_MANUAL}>Sin autocompletar</SelectItem>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sc-name">Producto / nombre</Label>
            <Input
              id="sc-name"
              className="app-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setInventoryPick(PID_MANUAL)
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Marca</Label>
            <Select
              value={brandVal}
              onValueChange={(v) => {
                if (v === BRAND_NONE) {
                  setBrand('')
                  return
                }
                if (v === BRAND_CUSTOM) return
                setBrand(v)
              }}
            >
              <SelectTrigger className="app-input w-full border-input">
                <SelectValue placeholder="Marca" />
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-56">
                <SelectItem value={BRAND_NONE}>(Sin marca)</SelectItem>
                {[...brandNameSet]
                  .sort((a, b) => a.localeCompare(b))
                  .map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                <SelectItem value={BRAND_CUSTOM}>Otro (escribir)…</SelectItem>
              </SelectContent>
            </Select>
            {brandVal === BRAND_CUSTOM ? (
              <Input
                className="app-input"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Marca"
              />
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1"
              disabled={savingBrand || !brand.trim()}
              onClick={() => void onRememberBrand()}
            >
              {savingBrand ? 'Guardando…' : 'Guardar marca en la base'}
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select
                value={typeVal}
                onValueChange={(v) => {
                  if (v === CAT_NONE) {
                    setProductType('')
                    return
                  }
                  if (v === CAT_CUSTOM) return
                  setProductType(v)
                }}
              >
                <SelectTrigger className="app-input w-full border-input">
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent position="popper" className="max-h-56">
                  <SelectItem value={CAT_NONE}>(Sin tipo)</SelectItem>
                  {[...typeNameSet]
                    .sort((a, b) => a.localeCompare(b))
                    .map((n) => (
                      <SelectItem key={n} value={n}>
                        {n}
                      </SelectItem>
                    ))}
                  <SelectItem value={CAT_CUSTOM}>Otro…</SelectItem>
                </SelectContent>
              </Select>
              {typeVal === CAT_CUSTOM ? (
                <Input
                  className="app-input"
                  value={productType}
                  onChange={(e) => setProductType(e.target.value)}
                  placeholder="Tipo"
                />
              ) : null}
              {typeVal === CAT_CUSTOM &&
              productType.trim() &&
              !typeNameSet.has(productType.trim()) ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-[11px]"
                  disabled={savingType}
                  onClick={() => void onRememberProductType()}
                >
                  {savingType ? '…' : 'Guardar tipo'}
                </Button>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label>Presentación</Label>
              <Select
                value={presVal}
                onValueChange={(v) => {
                  if (v === CAT_NONE) {
                    setPresentation('')
                    return
                  }
                  if (v === CAT_CUSTOM) return
                  setPresentation(v)
                }}
              >
                <SelectTrigger className="app-input w-full border-input">
                  <SelectValue placeholder="Presentación" />
                </SelectTrigger>
                <SelectContent position="popper" className="max-h-56">
                  <SelectItem value={CAT_NONE}>(Sin presentación)</SelectItem>
                  {[...presNameSet]
                    .sort((a, b) => a.localeCompare(b))
                    .map((n) => (
                      <SelectItem key={n} value={n}>
                        {n}
                      </SelectItem>
                    ))}
                  <SelectItem value={CAT_CUSTOM}>Otro…</SelectItem>
                </SelectContent>
              </Select>
              {presVal === CAT_CUSTOM ? (
                <Input
                  className="app-input"
                  value={presentation}
                  onChange={(e) => setPresentation(e.target.value)}
                  placeholder="Presentación"
                />
              ) : null}
              {presVal === CAT_CUSTOM &&
              presentation.trim() &&
              !presNameSet.has(presentation.trim()) ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-[11px]"
                  disabled={savingPres}
                  onClick={() => void onRememberPresentation()}
                >
                  {savingPres ? '…' : 'Guardar presentación'}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Contenido neto</Label>
            <Select
              value={netPreset}
              onValueChange={(v) => {
                if (v === NET_CUSTOM) return
                const opt = netContentOptions.find((o) => o.id === v)
                if (!opt) return
                setNetQty(String(opt.net_quantity))
                setNetUnit(opt.unit_code)
              }}
            >
              <SelectTrigger className="app-input w-full border-input">
                <SelectValue placeholder="Preset o personalizado" />
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-56">
                <SelectItem value={NET_CUSTOM}>Personalizado…</SelectItem>
                {netContentOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {netPreset === NET_CUSTOM ? (
              <div className="flex flex-wrap gap-2">
                <Input
                  id="sc-netq"
                  className="app-input max-w-[120px]"
                  inputMode="decimal"
                  value={netQty}
                  onChange={(e) => setNetQty(e.target.value)}
                  placeholder="Cantidad"
                />
                <Select
                  value={unitCodeVal}
                  onValueChange={(v) => {
                    if (v === CAT_NONE) {
                      setNetUnit('')
                      return
                    }
                    if (v === UNIT_OTHER) return
                    const mu = measureUnits.find(
                      (u) => u.code.trim().toLowerCase() === v.toLowerCase()
                    )
                    setNetUnit(mu?.code ?? v)
                  }}
                >
                  <SelectTrigger className="app-input w-[140px] border-input">
                    <SelectValue placeholder="Unidad" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value={CAT_NONE}>(—)</SelectItem>
                    {measureUnits.map((u) => (
                      <SelectItem
                        key={u.id}
                        value={u.code.trim().toLowerCase()}
                      >
                        {u.label}
                      </SelectItem>
                    ))}
                    <SelectItem value={UNIT_OTHER}>Otra…</SelectItem>
                  </SelectContent>
                </Select>
                {unitCodeVal === UNIT_OTHER ? (
                  <Input
                    id="sc-netu"
                    className="app-input min-w-[80px] flex-1"
                    value={netUnit}
                    onChange={(e) => setNetUnit(e.target.value)}
                    placeholder="Unidad"
                  />
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sc-notes">Notas</Label>
            <Input
              id="sc-notes"
              className="app-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Unidades visibles en foto</Label>
            <Select
              value={qtySelectVal}
              onValueChange={(v) => {
                if (v === QTY_NONE) {
                  setQtyVisible('')
                  return
                }
                if (v === QTY_MANUAL) {
                  setQtyVisible('')
                  return
                }
                setQtyVisible(v)
              }}
            >
              <SelectTrigger id="sc-qtyv" className="app-input w-full border-input">
                <SelectValue placeholder="Cantidad" />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value={QTY_NONE}>(—)</SelectItem>
                {VISIBLE_QTY_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
                <SelectItem value={QTY_MANUAL}>Otro valor…</SelectItem>
              </SelectContent>
            </Select>
            {qtySelectVal === QTY_MANUAL ? (
              <Input
                className="app-input"
                inputMode="decimal"
                value={qtyVisible}
                onChange={(e) => setQtyVisible(e.target.value)}
                placeholder="Ej. 2,5"
              />
            ) : null}
          </div>

          <div className="flex flex-wrap gap-4 border-y border-border py-3">
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                className="size-4 rounded border-input"
                checked={markedInvalid}
                onChange={(e) => setMarkedInvalid(e.target.checked)}
              />
              Lectura errónea (no aplicar)
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                className="size-4 rounded border-input"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                disabled={markedInvalid}
              />
              Aceptar para inventario
            </label>
          </div>

          <div className="space-y-1.5">
            <span className="app-field-label">Enlazar inventario</span>
            <Select
              value={productId}
              onValueChange={setProductId}
              disabled={markedInvalid}
            >
              <SelectTrigger className="app-input w-full border-input">
                <SelectValue placeholder="Producto…" />
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-64">
                <SelectItem value={NONE}>Sin asignar</SelectItem>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="destructive"
            disabled={deleting}
            onClick={() => void onDelete()}
          >
            {deleting ? 'Eliminando…' : 'Eliminar línea'}
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={saving || !item}
              onClick={() => void onSave()}
            >
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
