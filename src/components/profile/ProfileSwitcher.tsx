'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { setActiveProfileId } from '@/app/actions/profile'
import type { ProfileOption } from '@/lib/profile/context'
import { cn } from '@/lib/utils'

type Props = {
  profiles: ProfileOption[]
  activeProfileId: string | null
  className?: string
}

export function ProfileSwitcher({ profiles, activeProfileId, className }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  if (profiles.length === 0) {
    return null
  }

  const value =
    activeProfileId && profiles.some((p) => p.id === activeProfileId)
      ? activeProfileId
      : profiles[0].id

  return (
    <label className={cn('flex min-w-0 flex-col gap-1 text-sm', className)}>
      <span className="text-muted-foreground sr-only sm:not-sr-only">Ubicación</span>
      <select
        className="max-w-[180px] truncate rounded-md border border-input bg-background px-2 py-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        disabled={pending}
        value={value}
        onChange={(e) => {
          const id = e.target.value
          startTransition(async () => {
            await setActiveProfileId(id)
            router.refresh()
          })
        }}
      >
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  )
}
