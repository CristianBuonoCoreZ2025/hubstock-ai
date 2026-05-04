'use client'

import type { UiStyleId } from '@/lib/ui-styles'
import { UI_STYLE_META } from '@/lib/ui-styles'
import { Package } from 'lucide-react'

type Props = {
  styleId: UiStyleId
  selected: boolean
  onSelect: () => void
}

export default function MiniSkinPreview({ styleId, selected, onSelect }: Props) {
  const meta = UI_STYLE_META[styleId]

  return (
    <button
      type="button"
      onClick={onSelect}
      data-ui-style-skin={styleId}
      className={`w-full max-w-[280px] text-left outline-none transition-[box-shadow,transform] focus-visible:ring-2 focus-visible:ring-ring ${
        selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'hover:opacity-95'
      }`}
      style={{
        fontFamily: 'var(--font-app-sans)',
        borderRadius: 'var(--radius)',
      }}
    >
      <span className="sr-only">Seleccionar estilo {meta.label}</span>
      <div
        className="overflow-hidden border shadow-sm"
        style={{
          borderColor: 'var(--border)',
          borderRadius: 'var(--radius)',
          background: 'var(--background)',
        }}
      >
        {/* Barra tipo sidebar */}
        <div
          className="flex gap-2 border-b p-2.5"
          style={{
            background: 'var(--sidebar)',
            borderColor: 'var(--border)',
            color: 'var(--sidebar-foreground)',
          }}
        >
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-primary-foreground"
            style={{ background: 'var(--sidebar-primary)' }}
          >
            <Package className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
            <div
              className="h-2 w-[72%] max-w-full rounded-full"
              style={{ background: 'var(--muted-foreground)', opacity: 0.35 }}
            />
            <div
              className="h-2 w-[48%] max-w-full rounded-full"
              style={{ background: 'var(--muted-foreground)', opacity: 0.22 }}
            />
          </div>
        </div>
        {/* Contenido */}
        <div className="space-y-2 p-2.5" style={{ background: 'var(--background)' }}>
          <p
            className="text-[11px] font-semibold leading-tight tracking-tight"
            style={{
              fontFamily: 'var(--font-app-heading)',
              color: 'var(--foreground)',
            }}
          >
            {meta.label}
          </p>
          <div className="flex gap-1.5">
            <span
              className="inline-flex h-6 items-center rounded-md px-2 text-[9px] font-medium text-primary-foreground"
              style={{ background: 'var(--primary)', borderRadius: 'calc(var(--radius) * 0.65)' }}
            >
              Acción
            </span>
            <span
              className="inline-flex h-6 items-center rounded-md border px-2 text-[9px] font-medium"
              style={{
                borderColor: 'var(--border)',
                color: 'var(--muted-foreground)',
                borderRadius: 'calc(var(--radius) * 0.65)',
              }}
            >
              Secundario
            </span>
          </div>
          <div
            className="rounded-md border p-2 text-[9px] leading-snug"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--card)',
              color: 'var(--muted-foreground)',
              borderRadius: 'calc(var(--radius) * 0.85)',
            }}
          >
            {meta.tagline}
          </div>
        </div>
      </div>
      <p className="mt-1.5 px-0.5 text-[10px] text-muted-foreground">{meta.mood}</p>
    </button>
  )
}
