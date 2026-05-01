'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ProfileOption } from '@/lib/profile/context'
import { desktopNavItems, mobileBottomNavItems } from '@/lib/navigation'
import { ProfileSwitcher } from '@/components/profile/ProfileSwitcher'

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
    <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[260px_1fr]">
      <div className="hidden border-r border-border bg-muted/30 md:block">
        <div className="flex h-full max-h-screen flex-col gap-2">
          <div className="flex h-14 flex-col gap-2 border-b px-4 py-3 lg:h-auto lg:px-6">
            <Link href="/dashboard" className="font-semibold tracking-tight">
              StockCasa AI
            </Link>
            <ProfileSwitcher
              profiles={profiles}
              activeProfileId={activeProfileId}
              className="w-full"
            />
          </div>
          <nav className="flex flex-1 flex-col gap-0.5 px-2 text-sm font-medium lg:px-3">
            {desktopNavItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted hover:text-foreground ${
                  pathname === item.href
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground'
                }`}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.name}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <div className="flex min-h-screen flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
        <header className="sticky top-0 z-30 flex min-h-14 flex-wrap items-center justify-between gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:static md:border-0 md:bg-transparent md:px-6 md:py-4">
          <span className="text-lg font-semibold md:hidden">StockCasa AI</span>
          <div className="flex items-center gap-2 md:hidden">
            <ProfileSwitcher profiles={profiles} activeProfileId={activeProfileId} />
          </div>
        </header>

        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
          {needsProfileSetup ? (
            <div
              className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
              role="status"
            >
              <p className="font-medium">Crea tu primer hogar (perfil)</p>
              <p className="mt-1 text-amber-900/80 dark:text-amber-100/80">
                Los datos de inventario se separan por perfil.{' '}
                <Link href="/profiles/new" className="font-semibold underline underline-offset-2">
                  Crear perfil
                </Link>
              </p>
            </div>
          ) : null}
          {children}
        </main>

        <nav
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] pt-1 backdrop-blur md:hidden"
          aria-label="Navegación principal"
        >
          <ul className="flex items-stretch justify-around">
            {mobileBottomNavItems.map((item) => (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  className={`flex flex-col items-center gap-0.5 px-1 py-2 text-[11px] font-medium ${
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
