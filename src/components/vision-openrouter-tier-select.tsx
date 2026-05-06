'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { OpenRouterStockCheckTier } from '@/types/open-router-stock-check-tier'

export function VisionOpenRouterTierSelect({
  value,
  onValueChange,
  disabled,
  /** Boletas por texto usan variables `OPENROUTER_DOCUMENT_MODEL*` si las defines. */
  hintVariant = 'vision',
}: {
  value: OpenRouterStockCheckTier
  onValueChange: (next: OpenRouterStockCheckTier) => void
  disabled?: boolean
  hintVariant?: 'vision' | 'document'
}) {
  const hint =
    hintVariant === 'document' ? (
      <>
        Listas <strong>solo para texto</strong> (PDF/pegar), independientes de la visión:{' '}
        <code className="rounded bg-muted px-1 text-[11px]">
          OPENROUTER_DOCUMENT_MODEL_FREE
        </code>{' '}
        y{' '}
        <code className="rounded bg-muted px-1 text-[11px]">
          OPENROUTER_DOCUMENT_MODEL
        </code>
        . Si no las defines, el servidor usa una línea por defecto solo documento (orden = intentos). Varios ids
        separados por coma.
      </>
    ) : (
      <>
        Prioridad de modelos en{' '}
        <code className="rounded bg-muted px-1 text-[11px]">
          OPENROUTER_VISION_MODEL_FREE
        </code>{' '}
        y{' '}
        <code className="rounded bg-muted px-1 text-[11px]">
          OPENROUTER_VISION_MODEL
        </code>{' '}
        (varios ids separados por coma en cada variable).
      </>
    )

  return (
    <div className="space-y-1.5">
      <span className="app-field-label">Modelos OpenRouter</span>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(v) => onValueChange(v as OpenRouterStockCheckTier)}
      >
        <SelectTrigger className="app-input w-full border-input">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="free_first">
            Gratis primero, luego de pago (recomendado)
          </SelectItem>
          <SelectItem value="free_only">Solo modelos gratuitos</SelectItem>
          <SelectItem value="paid_only">Solo modelo de pago (saldo)</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-[12px] text-muted-foreground">{hint}</p>
    </div>
  )
}
