'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ProfileOption } from '@/lib/profile/context'
import { desktopNavItems, mobileBottomNavItems } from '@/lib/navigation'
import { ProfileSwitcher } from '@/components/profile/ProfileSwitcher'
import { MotionFadeIn } from '@/components/motion/motion-fade-in'
import { ThemeToggle } from '@/components/theme/ThemeToggle'

type Props = {
  children: React.ReactNode
  profiles: ProfileOption[]
  activeProfileId: string | null
  needsProfileSetup?: boolean
}

export default function AppShell({
  children,
  profiles,
  activeProfileId,
  needsProfileSetup,
}: Props) {
  const pathname = usePathname()

  return (
    <div className="grid min-h-screen w-full md:grid-cols-[240px_1fr] lg:grid-cols-[260px_1fr]">
      <aside className="glass-panel hidden flex-col border-r border-border md:flex">
        <div className="flex h-full max-h-screen flex-col">
          <div className="flex flex-col gap-3 border-b border-border px-5 py-5">
            <div className="flex items-center justify-between gap-2">
              <Link href="/dashboard" className="text-[13px] font-semibold tracking-tight text-foreground">
                StockCasa
              </Link>
              <ThemeToggle />
            </div>
            <ProfileSwitcher
              profiles={profiles}
              activeProfileId={activeProfileId}
              className="w-full"
            />
          </div>
          <nav className="flex flex-1 flex-col gap-0.5 px-2 py-3 text-[13px] font-medium lg:px-3">
            {desktopNavItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-muted hover:text-foreground ${
                  pathname === item.href
                    ? 'bg-muted font-semibold text-foreground'
                    : 'text-muted-foreground'
                }`}
              >
                <item.icon className="h-4 w-4 shrink-0 opacity-80" />
                {item.name}
              </Link>
            ))}
          </nav>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
        <header className="sticky top-0 z-30 flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur-md md:static md:border-0 md:bg-transparent md:px-6 md:py-5">
          <span className="text-[13px] font-semibold tracking-tight md:hidden">StockCasa</span>
          <div className="flex flex-1 items-center justify-end gap-2 md:hidden">
            <ThemeToggle />
            <ProfileSwitcher profiles={profiles} activeProfileId={activeProfileId} />
          </div>
        </header>

        <main className="flex flex-1 flex-col px-4 py-5 lg:px-8 lg:py-8">
          <MotionFadeIn className="flex flex-1 flex-col gap-6 lg:gap-8">
            {needsProfileSetup ? (
              <div className="app-alert-warn" role="status">
                <p className="font-semibold">Crea tu primer hogar (perfil)</p>
                <p className="mt-1 text-[13px] opacity-90">
                  Los datos de inventario se separan por perfil.{' '}
                  <Link href="/profiles/new" className="font-semibold underline underline-offset-2">
                    Crear perfil
                  </Link>
                </p>
              </div>
            ) : null}
            {children}
          </MotionFadeIn>
        </main>

        <nav
          className="glass-panel fixed inset-x-0 bottom-0 z-40 rounded-none border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] pt-1 md:hidden"
          aria-label="Navegación principal"
        >
          <ul className="flex items-stretch justify-around">
            {mobileBottomNavItems.map((item) => (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  className={`flex flex-col items-center gap-0.5 px-1 py-2 text-[10px] font-semibold uppercase tracking-wide ${
                    pathname === item.href ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  <item.icon className="h-5 w-5" aria-hidden />
                  <span className="truncate">{item.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  )
}
