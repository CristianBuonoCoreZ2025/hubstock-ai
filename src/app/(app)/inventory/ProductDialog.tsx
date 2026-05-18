'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  addProduct,
  addProductCreatingCatalogMaster,
  updateProduct,
  deleteProduct,
} from '@/app/actions/inventory'
import { searchCatalogProductsForPickerAction } from '@/app/actions/catalog'
import type { TaxonomyCategory, TaxonomySection } from '@/types/taxonomy'

type Product = {
  id: string
  name: string
  category_id: string
  section_id: string
  stock_current: number
  stock_min: number | null
  reference_price: number | null
  catalog_product_id?: string | null
}

interface ProductDialogProps {
  categories: TaxonomyCategory[]
  sections: TaxonomySection[]
  product?: Product
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function ProductDialog({
  categories,
  sections,
  product,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: ProductDialogProps) {
  const router = useRouter()
  const [internalOpen, setInternalOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [sectionId, setSectionId] = useState(() => {
    if (product) {
      const cat = categories.find((c) => c.id === product.category_id)
      return cat?.section_id ?? product.section_id
    }
    return sections[0]?.id ?? ''
  })
  const [categoryId, setCategoryId] = useState(() => {
    if (product) return product.category_id
    const sid = sections[0]?.id ?? ''
    return categories.find((c) => c.section_id === sid)?.id ?? ''
  })

  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [catalogOptions, setCatalogOptions] = useState<{ id: string; name: string }[]>([])
  /** Solo se usa en alta o en ítems viejos sin vínculo: producto maestro elegido */
  const [pickedCatalogId, setPickedCatalogId] = useState<string>(() =>
    product?.catalog_product_id ? '' : ''
  )
  const [pickedCatalogName, setPickedCatalogName] = useState('')
  /** Alta nueva: elegir existente en catálogo o crear maestro + ítem a la vez */
  const [addMode, setAddMode] = useState<'pick' | 'create'>('pick')
  const [standardName, setStandardName] = useState('')
  const debounceRef = useRef<number | null>(null)

  const categoriesInSection = useMemo(
    () => categories.filter((c) => c.section_id === sectionId),
    [categories, sectionId]
  )

  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = isControlled ? controlledOnOpenChange! : setInternalOpen

  const isEditing = !!product
  const linkedToCatalog = !!product?.catalog_product_id

  const effectiveCatalogId = linkedToCatalog
    ? (product!.catalog_product_id as string)
    : pickedCatalogId

  const isNewAdd = !isEditing

  useEffect(() => {
    if (!open) return
    if (product) {
      const cat = categories.find((c) => c.id === product.category_id)
      const sec = cat?.section_id ?? product.section_id
      setSectionId(sec)
      setCategoryId(product.category_id)
      setCatalogQuery('')
      setCatalogOptions([])
      setCatalogError(null)
      if (product.catalog_product_id) {
        setPickedCatalogId('')
        setPickedCatalogName('')
      } else {
        setPickedCatalogId('')
        setPickedCatalogName('')
      }
      setAddMode('pick')
      setStandardName('')
      return
    }
    const firstSection = sections[0]?.id ?? ''
    setSectionId(firstSection)
    const firstCat = categories.find((c) => c.section_id === firstSection)?.id ?? ''
    setCategoryId(firstCat)
    setPickedCatalogId('')
    setPickedCatalogName('')
    setCatalogQuery('')
    setCatalogOptions([])
    setCatalogError(null)
    setAddMode('pick')
    setStandardName('')
  }, [product, categories, sections, open])

  useEffect(() => {
    if (!open) return
    const allowed = categories.filter((c) => c.section_id === sectionId)
    if (!allowed.some((c) => c.id === categoryId)) {
      setCategoryId(allowed[0]?.id ?? '')
    }
  }, [sectionId, categories, categoryId, open])

  useEffect(() => {
    if (!open) return
    const q = catalogQuery.trim()
    setCatalogError(null)

    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }

    if (linkedToCatalog || (isNewAdd && addMode === 'create')) {
      setCatalogOptions([])
      setCatalogLoading(false)
      return
    }

    if (q.length < 2) {
      setCatalogOptions([])
      setCatalogLoading(false)
      return
    }

    setCatalogLoading(true)
    debounceRef.current = window.setTimeout(async () => {
      const res = await searchCatalogProductsForPickerAction(q, true)
      if (!res.ok) {
        setCatalogError(res.error ?? 'No se pudo buscar en el catálogo.')
        setCatalogOptions([])
        setCatalogLoading(false)
        return
      }
      setCatalogOptions(res.rows)
      setCatalogLoading(false)
    }, 320)

    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [catalogQuery, open, linkedToCatalog, isNewAdd, addMode])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (isNewAdd && addMode === 'create') {
      const trimmed = standardName.trim()
      if (!trimmed) {
        toast.error('Escribe el nombre estándar del producto (se usará en catálogo e inventario).')
        return
      }
      setIsLoading(true)
      const formData = new FormData(e.currentTarget)
      formData.set('category_id', categoryId)
      formData.set('section_id', sectionId)
      formData.set('standard_name', trimmed)
      try {
        const result = await addProductCreatingCatalogMaster(formData)
        if (result.error) {
          toast.error(result.error)
        } else {
          toast.success('Producto creado en catálogo y agregado al inventario')
          setOpen(false)
          router.refresh()
        }
      } catch {
        toast.error('Ocurrió un error inesperado')
      } finally {
        setIsLoading(false)
      }
      return
    }

    if (!effectiveCatalogId) {
      toast.error(
        'Selecciona un producto del catálogo o usa “Crear nombre estándar” si aún no existe el maestro.'
      )
      setIsLoading(false)
      return
    }

    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    formData.set('category_id', categoryId)
    formData.set('section_id', sectionId)
    formData.set('catalog_product_id', effectiveCatalogId)

    try {
      const result = isEditing
        ? await updateProduct(product.id, formData)
        : await addProduct(formData)

      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(isEditing ? 'Cambios guardados' : 'Producto agregado al inventario')
        setOpen(false)
        router.refresh()
      }
    } catch {
      toast.error('Ocurrió un error inesperado')
    } finally {
      setIsLoading(false)
    }
  }

  async function onDelete() {
    if (!product) return
    if (!window.confirm('¿Desactivar este ítem del inventario?')) return
    setIsLoading(true)
    try {
      const result = await deleteProduct(product.id)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Ítem desactivado en el inventario')
        setOpen(false)
        router.refresh()
      }
    } catch {
      toast.error('No se pudo completar la acción')
    } finally {
      setIsLoading(false)
    }
  }

  const canSave = (() => {
    if (!categoryId || !sectionId || isLoading) return false
    if (isNewAdd && addMode === 'create') return standardName.trim().length > 0
    return !!effectiveCatalogId
  })()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="modal-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Editar en inventario' : 'Agregar al inventario (catálogo)'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          {linkedToCatalog ? (
            <div className="space-y-2">
              <Label>Producto (catálogo global)</Label>
              <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium text-foreground">
                {product!.name}
              </p>
              <p className="text-xs text-muted-foreground">
                El nombre lo define el catálogo. Para otro producto, usa “Agregar desde catálogo” y
                elige existente o “crear nombre estándar”.
              </p>
            </div>
          ) : isNewAdd ? (
            <div className="space-y-3">
              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-medium text-foreground">Origen del producto</legend>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="add_mode"
                    className="mt-1"
                    checked={addMode === 'pick'}
                    onChange={() => {
                      setAddMode('pick')
                      setStandardName('')
                    }}
                  />
                  <span>
                    Elegir un producto que <strong>ya existe</strong> en el catálogo global (nombre
                    estándar definido ahí).
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="add_mode"
                    className="mt-1"
                    checked={addMode === 'create'}
                    onChange={() => {
                      setAddMode('create')
                      setPickedCatalogId('')
                      setPickedCatalogName('')
                      setCatalogQuery('')
                      setCatalogOptions([])
                    }}
                  />
                  <span>
                    <strong>No existe</strong> en el catálogo: crear el nombre estándar{' '}
                    <strong>una sola vez</strong> en catálogo global y agregarlo a este inventario.
                    Requiere rol editor en el hogar (igual que Catálogo).
                  </span>
                </label>
              </fieldset>

              {addMode === 'create' ? (
                <div className="space-y-2">
                  <Label htmlFor="standard_name">Nombre estándar del producto</Label>
                  <Input
                    id="standard_name"
                    name="standard_name"
                    value={standardName}
                    onChange={(e) => setStandardName(e.target.value)}
                    placeholder="Ej. Mayonesa Hellmanns 370 g"
                    autoComplete="off"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Este texto será el maestro en el catálogo y el nombre visible en tu inventario.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="catalog-search">Buscar en catálogo global</Label>
                  <Input
                    id="catalog-search"
                    value={catalogQuery}
                    onChange={(e) => setCatalogQuery(e.target.value)}
                    placeholder="Escribe al menos 2 caracteres…"
                    autoComplete="off"
                  />
                  <div className="rounded-md border bg-background">
                    <div className="max-h-44 overflow-auto p-2">
                      {catalogLoading ? (
                        <p className="text-sm text-muted-foreground">Buscando…</p>
                      ) : catalogError ? (
                        <p className="text-sm text-destructive">{catalogError}</p>
                      ) : catalogQuery.trim().length >= 2 && catalogOptions.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No se encontraron resultados.</p>
                      ) : catalogOptions.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          {catalogOptions.map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              className={`rounded px-2 py-1 text-left text-sm hover:bg-muted ${
                                pickedCatalogId === opt.id ? 'bg-muted font-medium' : ''
                              }`}
                              onClick={() => {
                                setPickedCatalogId(opt.id)
                                setPickedCatalogName(opt.name)
                                setCatalogQuery(opt.name)
                                setCatalogOptions([])
                              }}
                            >
                              {opt.name}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Escribe para buscar productos del catálogo global.
                        </p>
                      )}
                    </div>
                  </div>
                  {pickedCatalogId ? (
                    <p className="text-xs text-muted-foreground">
                      Se agregará al inventario:{' '}
                      <span className="font-medium">{pickedCatalogName}</span>
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="catalog-search">Vincular a producto del catálogo (obligatorio)</Label>
              <Input
                id="catalog-search"
                value={catalogQuery}
                onChange={(e) => setCatalogQuery(e.target.value)}
                placeholder="Escribe al menos 2 caracteres…"
                autoComplete="off"
              />
              <div className="rounded-md border bg-background">
                <div className="max-h-44 overflow-auto p-2">
                  {catalogLoading ? (
                    <p className="text-sm text-muted-foreground">Buscando…</p>
                  ) : catalogError ? (
                    <p className="text-sm text-destructive">{catalogError}</p>
                  ) : catalogQuery.trim().length >= 2 && catalogOptions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No se encontraron resultados.</p>
                  ) : catalogOptions.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {catalogOptions.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          className={`rounded px-2 py-1 text-left text-sm hover:bg-muted ${
                            pickedCatalogId === opt.id ? 'bg-muted font-medium' : ''
                          }`}
                          onClick={() => {
                            setPickedCatalogId(opt.id)
                            setPickedCatalogName(opt.name)
                            setCatalogQuery(opt.name)
                            setCatalogOptions([])
                          }}
                        >
                          {opt.name}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Escribe para buscar el producto maestro correcto.
                    </p>
                  )}
                </div>
              </div>
              {pickedCatalogId ? (
                <p className="text-xs text-muted-foreground">
                  Se guardará la relación con: <span className="font-medium">{pickedCatalogName}</span>
                </p>
              ) : null}
            </div>
          )}

          {isNewAdd ? (
            <p className="text-xs text-muted-foreground">
              También puedes administrar solo el catálogo en{' '}
              <Link
                href="/catalog"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Catálogo
              </Link>
              .
            </p>
          ) : !linkedToCatalog ? (
            <p className="text-xs text-muted-foreground">
              Este ítem no tenía vínculo: elige el producto correcto en el catálogo o revisa en{' '}
              <Link
                href="/catalog"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Catálogo
              </Link>
              .
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Sección</Label>
              <Select value={sectionId} onValueChange={setSectionId} required>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Seleccionar..." />
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

            <div className="space-y-2">
              <Label>Categoría</Label>
              <Select value={categoryId} onValueChange={setCategoryId} required>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  {categoriesInSection.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="stock_current">Stock actual</Label>
              <Input
                id="stock_current"
                name="stock_current"
                type="number"
                step={1}
                min={0}
                defaultValue={product?.stock_current ?? 0}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="stock_min">Stock mínimo</Label>
              <Input
                id="stock_min"
                name="stock_min"
                type="number"
                step={1}
                min={0}
                defaultValue={product?.stock_min ?? ''}
                placeholder="Opcional"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reference_price">Precio ref.</Label>
              <Input
                id="reference_price"
                name="reference_price"
                type="number"
                step="0.01"
                min="0"
                defaultValue={product?.reference_price ?? ''}
              />
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2 pt-4">
            {isEditing ? (
              <Button
                type="button"
                variant="destructive"
                onClick={onDelete}
                disabled={isLoading}
                className="mr-auto"
              >
                Desactivar
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isLoading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSave}>
              {isLoading ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
