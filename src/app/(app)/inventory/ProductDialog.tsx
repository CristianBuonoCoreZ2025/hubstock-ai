'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
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
import { addProduct, updateProduct, deleteProduct } from '@/app/actions/inventory'
import type { TaxonomyCategory, TaxonomySection } from '@/types/taxonomy'
type Product = {
  id: string
  name: string
  category_id: string
  section_id: string
  stock_current: number
  stock_min: number | null
  reference_price: number | null
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

  const categoriesInSection = useMemo(
    () => categories.filter((c) => c.section_id === sectionId),
    [categories, sectionId]
  )

  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = isControlled ? controlledOnOpenChange! : setInternalOpen

  const isEditing = !!product

  useEffect(() => {
    if (!open) return
    if (product) {
      const cat = categories.find((c) => c.id === product.category_id)
      const sec = cat?.section_id ?? product.section_id
      setSectionId(sec)
      setCategoryId(product.category_id)
      return
    }
    const firstSection = sections[0]?.id ?? ''
    setSectionId(firstSection)
    const firstCat = categories.find((c) => c.section_id === firstSection)?.id ?? ''
    setCategoryId(firstCat)
  }, [product, categories, sections, open])

  useEffect(() => {
    if (!open) return
    const allowed = categories.filter((c) => c.section_id === sectionId)
    if (!allowed.some((c) => c.id === categoryId)) {
      setCategoryId(allowed[0]?.id ?? '')
    }
  }, [sectionId, categories, categoryId, open])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    formData.set('category_id', categoryId)
    formData.set('section_id', sectionId)

    try {
      const result = isEditing
        ? await updateProduct(product.id, formData)
        : await addProduct(formData)

      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(isEditing ? 'Producto actualizado' : 'Producto creado')
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
    if (!window.confirm('¿Desactivar este producto del inventario?')) return
    setIsLoading(true)
    try {
      const result = await deleteProduct(product.id)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Producto desactivado')
        setOpen(false)
        router.refresh()
      }
    } catch {
      toast.error('No se pudo eliminar el producto')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar producto' : 'Nuevo producto'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nombre</Label>
            <Input
              id="name"
              name="name"
              defaultValue={product?.name}
              required
            />
          </div>

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
                step="0.01"
                min="0"
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
                step="0.01"
                min="0"
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
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isLoading}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
