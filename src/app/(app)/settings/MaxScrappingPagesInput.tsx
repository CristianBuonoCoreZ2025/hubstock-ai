'use client'

import { useEffect, useState } from 'react'
import { getMaxScrappingPages, setMaxScrappingPages } from '@/lib/max-scrapping-pages'

export default function MaxScrappingPagesInput() {
  const [value, setValue] = useState<number>(getMaxScrappingPages())

  useEffect(() => {
    setMaxScrappingPages(value)
  }, [value])

  return (
    <section className="app-panel">
      <h2 className="text-sm font-semibold">Límite de páginas de scrapping</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Número máximo de páginas que el barrido intentará descubrir. Una vez alcanzado,
        deja de ampliar la cola y solo procesa las páginas ya encontradas.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <input
          type="number"
          min={100}
          max={50000}
          step={100}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n) && n >= 100) setValue(n)
          }}
          className="h-9 w-28 rounded-md border border-input bg-background px-3 text-sm tabular-nums"
        />
        <span className="text-sm text-muted-foreground">páginas</span>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Valor por defecto: {getMaxScrappingPages().toLocaleString('es-CL')}. Rango sugerido: 1.000 – 10.000.
      </p>
    </section>
  )
}
