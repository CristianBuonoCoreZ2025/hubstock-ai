'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  checkShoppingItem,
  finishShoppingTrip,
  updateItemBoughtQuantity,
} from '@/app/actions/shopping'

export type SupermarketRow = {
  id: string
  quantity_planned: number
  quantity_bought: number | null
  unit_price_paid: number | null
  is_checked: boolean
  products: {
    name: string
    sections: { name: string } | null
  } | null
}

type Props = {
  tripId: string
  grouped: { sectionName: string; rows: SupermarketRow[] }[]
}

export function SupermarketClient({ tripId, grouped }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function run(fn: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      const res = await fn()
      if (res.error) toast.error(res.error)
      else {
        router.refresh()
      }
    })
  }

  return (
    <div className="app-page">
      <header className="app-page-header">
        <h1 className="app-page-title">Supermercado</h1>
        <p className="app-page-lead">
          Marca lo que llevas al carrito. Al finalizar se suma al inventario y se registra la compra.
        </p>
      </header>

      <div className="app-toolbar">
        <Button type="button" variant="secondary" asChild>
          <Link href="/shopping-list">Volver a la lista</Link>
        </Button>
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await finishShoppingTrip(tripId)
              if (r.error) {
                toast.error(r.error)
                return
              }
              toast.success('Viaje finalizado')
              router.push('/shopping-list')
              router.refresh()
            })
          }
        >
          Finalizar compra
        </Button>
      </div>

      <div className="flex flex-col gap-8">
        {grouped.map((group) => (
          <section key={group.sectionName}>
            <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
              {group.sectionName}
            </h2>
            <div className="flex flex-col gap-3">
              {group.rows.map((row) => (
                <div
                  key={row.id}
                  className="glass-panel flex flex-col gap-3 rounded-xl border-border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <label className="flex cursor-pointer items-start gap-3 sm:min-w-0 sm:flex-1">
                    <input
                      type="checkbox"
                      className="mt-1 size-5 rounded border-white/20 bg-slate-900/80"
                      checked={row.is_checked}
                      disabled={pending}
                      onChange={(e) =>
                        run(() =>
                          checkShoppingItem(row.id, e.target.checked, row.unit_price_paid ?? undefined)
                        )
                      }
                    />
                    <span>
                      <span className="block text-[14px] font-semibold text-foreground">
                        {row.products?.name ?? '—'}
                      </span>
                      <span className="text-xs font-medium text-muted-foreground">
                        Planificado: {row.quantity_planned}
                      </span>
                    </span>
                  </label>

                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">Comprado</span>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        defaultValue={row.quantity_bought ?? row.quantity_planned}
                        disabled={pending}
                        className="glass-panel-subtle h-9 w-24 border-white/10"
                        onBlur={(e) => {
                          const v = Number(e.target.value)
                          if (Number.isNaN(v)) return
                          run(() => updateItemBoughtQuantity(row.id, v))
                        }}
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">$/u</span>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        placeholder="—"
                        defaultValue={row.unit_price_paid ?? ''}
                        disabled={pending}
                        className="glass-panel-subtle h-9 w-24 border-white/10"
                        onBlur={(e) => {
                          const raw = e.target.value
                          if (raw === '') {
                            run(() => checkShoppingItem(row.id, row.is_checked, null))
                            return
                          }
                          const v = Number(raw)
                          if (Number.isNaN(v)) return
                          run(() => checkShoppingItem(row.id, row.is_checked, v))
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
