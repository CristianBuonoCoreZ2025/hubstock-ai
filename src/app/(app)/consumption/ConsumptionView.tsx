'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Minus } from 'lucide-react'
import { AppSearchBox } from '@/components/search/app-search-box'
import { Button } from '@/components/ui/button'
import { consumeProduct } from '@/app/actions/inventory'
import { filterBySearch, normalizeSearchText } from '@/lib/search'
import { requestLogger } from '@/lib/request-logger'

export type ConsumptionProduct = {
  id: string
  name: string
  stock_current: number
}

type Props = {
  products: ConsumptionProduct[]
}

export function ConsumptionView({ products }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [searchDraft, setSearchDraft] = useState('')
  const [searchSubmitted, setSearchSubmitted] = useState('')

  const filtered = useMemo(() => {
    if (!normalizeSearchText(searchSubmitted)) return products
    return filterBySearch(products, searchSubmitted, (p) => p.name)
  }, [products, searchSubmitted])

  function runConsume(id: string, qty: number) {
    startTransition(async () => {
      const res = await requestLogger.traceAsyncMethod('runConsume', async () => consumeProduct(id, qty), { id, qty })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(`Descontado: ${res.applied ?? qty}`)
      router.refresh()
    })
  }

  if (products.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay productos en el inventario. Agrega productos en la pantalla de inventario.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="glass-panel rounded-xl p-4">
        <label className="mb-2 block text-xs font-medium text-muted-foreground" htmlFor="consumption-search">
          Buscar producto
        </label>
        <div className="max-w-md">
          <AppSearchBox
            id="consumption-search"
            ariaLabel="Buscar producto para consumo"
            placeholder="Nombre (Enter o lupa)"
            value={searchDraft}
            onChange={setSearchDraft}
            onSubmit={() => setSearchSubmitted(searchDraft.trim())}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((p) => (
          <div
            key={p.id}
            className="glass-panel flex flex-col gap-3 rounded-xl p-4"
          >
            <div>
              <p className="font-medium leading-snug">{p.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Stock actual: <span className="tabular-nums font-medium text-foreground">{p.stock_current}</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="lg"
                className="min-h-12 flex-1 gap-2 text-base sm:flex-initial"
                disabled={pending || p.stock_current <= 0}
                onClick={() => runConsume(p.id, 1)}
              >
                <Minus className="size-5" aria-hidden />
                −1
              </Button>
              <Button
                type="button"
                size="lg"
                variant="secondary"
                className="min-h-12 flex-1 gap-2 text-base sm:flex-initial"
                disabled={pending || p.stock_current < 2}
                onClick={() => runConsume(p.id, 2)}
              >
                −2
              </Button>
              <Button
                type="button"
                size="lg"
                variant="outline"
                className="min-h-12 flex-1 gap-2 text-base sm:flex-initial"
                disabled={pending || p.stock_current <= 0}
                onClick={() => runConsume(p.id, p.stock_current)}
              >
                Todo
              </Button>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ningún producto coincide con la búsqueda.</p>
      ) : null}
    </div>
  )
}
