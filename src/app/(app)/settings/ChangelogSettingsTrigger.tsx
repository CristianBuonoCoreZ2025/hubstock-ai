'use client'

import { useState } from 'react'
import { BookOpen, ChevronRight } from 'lucide-react'
import { ChangelogModal } from '@/components/changelog-modal'

export default function ChangelogSettingsTrigger() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-left transition-colors hover:bg-muted/50"
      >
        <div className="flex items-center gap-2.5">
          <BookOpen className="h-4 w-4 text-primary" />
          <div>
            <p className="text-sm font-semibold">Historial de versiones</p>
            <p className="text-[12px] text-muted-foreground">
              Cambios, mejoras y correcciones del sistema
            </p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </button>
      <ChangelogModal open={open} onOpenChange={setOpen} />
    </>
  )
}
