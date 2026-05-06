'use client'

import Link from 'next/link'
import { useSyncExternalStore } from 'react'
import MiniSkinPreview from '@/components/style-lab/MiniSkinPreview'
import ColorModeControl from '@/components/theme/ColorModeControl'
import { UI_STYLE_IDS, UI_STYLE_META, type UiStyleId } from '@/lib/ui-styles'
import {
  getUiStyleServerSnapshot,
  getUiStyleSnapshot,
  persistUiStyleChoice,
  subscribeUiStyle,
} from '@/lib/ui-style-client-store'
import { PAGE_LEADS } from '@/lib/domain'

export default function StyleLabPage() {
  const active = useSyncExternalStore(
    subscribeUiStyle,
    getUiStyleSnapshot,
    getUiStyleServerSnapshot,
  )

  function applyStyle(id: UiStyleId) {
    persistUiStyleChoice(id)
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Laboratorio de estilos</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
          {PAGE_LEADS.styleLabDev} Siete pieles (tipografía, color, modales y grillas). Funcionan en
          modo claro y oscuro. Elige una para toda la app; el interruptor de abajo sirve para comparar
          día y noche.
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
        <h2 className="mb-4 text-sm font-semibold">7 propuestas (vista previa)</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
