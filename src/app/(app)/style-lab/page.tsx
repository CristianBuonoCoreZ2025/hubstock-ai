'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import MiniSkinPreview from '@/components/style-lab/MiniSkinPreview'
import ColorModeControl from '@/components/theme/ColorModeControl'
import {
  DEFAULT_UI_STYLE,
  UI_STYLE_IDS,
  UI_STYLE_META,
  UI_STYLE_STORAGE_KEY,
  isUiStyleId,
  type UiStyleId,
} from '@/lib/ui-styles'

export default function StyleLabPage() {
  const [active, setActive] = useState<UiStyleId>(DEFAULT_UI_STYLE)

  useEffect(() => {
    const raw = localStorage.getItem(UI_STYLE_STORAGE_KEY)
    if (isUiStyleId(raw)) {
      setActive(raw)
    }
  }, [])

  function applyStyle(id: UiStyleId) {
    setActive(id)
    document.documentElement.dataset.uiStyle = id
    localStorage.setItem(UI_STYLE_STORAGE_KEY, id)
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Laboratorio de estilos</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
          Doce pieles distintas (tipografía, color y forma). Todas funcionan en modo claro y oscuro.
          Elige una para aplicarla a toda la app; usa el interruptor de abajo para comparar el mismo
          estilo de día y de noche.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card/40 p-4 shadow-sm md:p-6">
        <h2 className="text-sm font-semibold">Aspecto global</h2>
        <p className="mt-1 text-sm text-muted-foreground">Modo claro, oscuro o según el sistema.</p>
        <div className="mt-4">
          <ColorModeControl />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card/40 p-4 shadow-sm md:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">Estilo activo en la app</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Actualmente:{' '}
              <span className="font-medium text-foreground">{UI_STYLE_META[active].label}</span>
            </p>
          </div>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Ver en el dashboard
          </Link>
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-sm font-semibold">12 propuestas (vista previa)</h2>
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {UI_STYLE_IDS.map((id) => (
            <MiniSkinPreview key={id} styleId={id} selected={active === id} onSelect={() => applyStyle(id)} />
          ))}
        </div>
      </section>

      <p className="text-sm text-muted-foreground">
        <Link href="/settings" className="font-medium text-primary underline-offset-4 hover:underline">
          Configuración
        </Link>{' '}
        ·{' '}
        <Link href="/menu" className="font-medium text-primary underline-offset-4 hover:underline">
          Menú
        </Link>
      </p>
    </div>
  )
}
