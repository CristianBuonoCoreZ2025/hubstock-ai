'use client'

import { useId } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { UI_STYLE_IDS, UI_STYLE_META, type UiStyleId } from '@/lib/ui-styles'

type Props = {
  value: UiStyleId
  onValueChange: (v: UiStyleId) => void
  className?: string
  id?: string
}

export function UiStyleDevSelect({
  value,
  onValueChange,
  className,
  id,
}: Props) {
  const autoId = useId()
  const triggerId = id ?? autoId

  return (
    <Select
      value={value}
      onValueChange={(v) => onValueChange(v as UiStyleId)}
    >
      <SelectTrigger
        id={triggerId}
        size="sm"
        className={cn('w-full min-w-0 justify-between text-left', className)}
        aria-label="Piel de interfaz (solo desarrollo)"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        position="popper"
        align="start"
        className="max-h-[min(70vh,28rem)] w-(--radix-select-trigger-width) min-w-48"
      >
        {UI_STYLE_IDS.map((styleId) => {
          const meta = UI_STYLE_META[styleId]
          return (
            <SelectItem
              key={styleId}
              value={styleId}
              title={`${meta.tagline} — ${meta.mood}`}
            >
              {meta.label}
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}
