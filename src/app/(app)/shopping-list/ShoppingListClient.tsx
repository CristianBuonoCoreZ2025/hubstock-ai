'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  addItemToList,
  generateAutoList,
  removeListItem,
  startShoppingTrip,
  updateListItemPlanned,
} from '@/app/actions/shopping'
import { TRIP_PHASE_SHOPPING } from '@/lib/shopping-phase'

type ItemRow = {
  id: string
  quantity_planned: number
  product_id: string
  products: {
    name: string
    sections: { name: string } | null
  } | null
}

type ProductOption = { id: string; name: string }

type Props = {
  tripId: string | null
  phaseNotes: string | null
  items: ItemRow[]
  products: ProductOption[]
}

export function ShoppingListClient({ tripId, phaseNotes, items, products }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [productId, setProductId] = useState(products[0]?.id ?? '')
  const [qty, setQty] = useState('1')

  const inShopping = phaseNotes === TRIP_PHASE_SHOPPING

  function run(fn: () => Promise<{ error?: string; success?: boolean }>) {
    startTransition(async () => {
      const res = await fn()
      if (res.error) toast.error(res.error)
      else {
        toast.success('Listo')
        router.refresh()
      }
    })
  }

  return (
    <div className="app-page">
      <header className="app-page-header">
        <h1 className="app-page-title">Lista de compras</h1>
        <p className="app-page-lead">
          Planifica cantidades; el modo supermercado marca ítems y cierra el viaje para actualizar stock.
        </p>
      </header>

      {inShopping ? (
        <div className="app-alert-warn">
          <p className="font-medium">Viaje en curso</p>
          <p className="mt-1 text-sm opacity-90">
            Continúa en <span className="font-semibold">Supermercado</span> o finaliza ahí el viaje.
          </p>
          <Button
            type="button"
            className="mt-3"
            onClick={() => router.push('/supermarket')}
          >
            Ir al supermercado
          </Button>
        </div>
      ) : null}

      <div className="app-toolbar">
        <Button
          type="button"
          disabled={pending || inShopping}
          onClick={() => run(() => generateAutoList())}
        >
          Generar desde stock bajo
        </Button>
        {tripId && !inShopping ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await startShoppingTrip(tripId)
                if (r.error) {
                  toast.error(r.error)
                  return
                }
                toast.success('Modo supermercado')
                router.push('/supermarket')
                router.refresh()
              })
            }
          >
            Ir al supermercado
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Agregar producto</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex max-w-xl flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label className="app-field-label" htmlFor="product-select">
                Producto
              </label>
              <select
                id="product-select"
                className="app-input"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
              >
                <option value="">Seleccionar…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-full sm:w-28">
              <label className="app-field-label" htmlFor="qty">
                Cantidad
              </label>
              <Input
                id="qty"
                type="number"
                min={0.01}
                step={0.01}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="glass-panel-subtle border-white/10"
              />
            </div>
            <Button
              type="button"
              disabled={pending || !productId || inShopping}
              onClick={() =>
                run(async () => addItemToList(productId, Number(qty) || 1))
              }
            >
              Añadir
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="app-data-table-wrap">
        <table className="app-data-table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Pasillo</th>
              <th className="w-36">Cantidad</th>
              <th className="w-24 text-right"> </th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-muted-foreground">
                  Sin ítems. Usa generación automática o añade productos.
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr key={row.id}>
                  <td className="font-medium">{row.products?.name ?? '—'}</td>
                  <td className="text-muted-foreground">
                    {row.products?.sections?.name ?? '—'}
                  </td>
                  <td>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      defaultValue={row.quantity_planned}
                      disabled={pending || inShopping}
                      className="glass-panel-subtle h-9 border-white/10"
                      onBlur={(e) => {
                        const v = Number(e.target.value)
                        if (Number.isNaN(v)) return
                        run(() => updateListItemPlanned(row.id, v))
                      }}
                    />
                  </td>
                  <td className="text-right">
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={pending || inShopping}
                      onClick={() => run(() => removeListItem(row.id))}
                    >
                      Quitar
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
