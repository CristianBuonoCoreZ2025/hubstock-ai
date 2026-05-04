import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { appGlassCardClass } from '@/components/ui/card'

type QuickActionCardProps = {
  title: string
  description: string
  icon: LucideIcon
  href?: string
  actionLabel?: string
  actionText?: string
  onClick?: () => void
}

export default function QuickActionCard({
  title,
  description,
  href,
  icon: Icon,
  actionLabel,
  actionText,
  onClick,
}: QuickActionCardProps) {
  const label = actionText ?? actionLabel ?? 'Abrir'

  const content = (
    <div className="flex items-start gap-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-accent-foreground transition group-hover:border-primary/20">
        <Icon className="h-5 w-5" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-[13px] leading-relaxed font-medium text-muted-foreground">{description}</p>
        <p className="mt-3 text-[13px] font-semibold text-primary">{label}</p>
      </div>
    </div>
  )

  const interactiveClass = cn(
    appGlassCardClass,
    'group block w-full p-5 text-left transition hover:border-white/15 hover:shadow-[0_12px_40px_rgba(0,0,0,0.45)]'
  )

  if (href) {
    return (
      <Link href={href} className={interactiveClass}>
        {content}
      </Link>
    )
  }

  return (
    <button type="button" onClick={onClick} className={interactiveClass}>
      {content}
    </button>
  )
}
