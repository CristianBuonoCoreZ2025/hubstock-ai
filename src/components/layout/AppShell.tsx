'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ProfileOption } from '@/lib/profile/context'
import {
  mobileBottomNavItems,
  navLinkIsActive,
  navigationTree,
  type NavNode,
} from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { ProfileSwitcher } from '@/components/profile/ProfileSwitcher'
import { MotionFadeIn } from '@/components/motion/motion-fade-in'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { UiStyleDevSelect } from '@/components/layout/UiStyleDevSelect'
import {
  getUiStyleServerSnapshot,
  getUiStyleSnapshot,
  persistUiStyleChoice,
  subscribeUiStyle,
} from '@/lib/ui-style-client-store'
import { isUiStyleDevToolbarEnabled } from '@/lib/ui-style-dev'

function renderNavNode(
  node: NavNode,
  pathname: string,
  locationHash: string
): ReactNode {
  if (node.type === 'link') {
    const active = navLinkIsActive(pathname, locationHash, node.href)
    return (
      <Link
        key={node.href}
        href={node.href}
        className={cn(
          'flex items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-muted hover:text-foreground',
          active ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground'
        )}
      >
        <node.icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
        {node.name}
      </Link>
    )
  }

  return (
    <div key={node.name} className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2 px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <node.icon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        {node.name}
      </div>
      {node.children.map((child) => {
        const active = navLinkIsActive(pathname, locationHash, child.href)
        return (
          <Link
            key={`${node.name}-${child.name}-${child.href}`}
            href={child.href}
            className={cn(
              'flex items-center gap-3 rounded-xl py-1.5 pl-8 pr-3 text-[12px] transition-colors hover:bg-muted hover:text-foreground',
              active ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground'
            )}
          >
            <child.icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
            {child.name}
          </Link>
        )
      })}
    </div>
  )
}

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
  const [locationHash, setLocationHash] = useState('')
  useEffect(() => {
    const sync = () => setLocationHash(typeof window !== 'undefined' ? window.location.hash : '')
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [pathname])

  const activeUiStyle = useSyncExternalStore(
    subscribeUiStyle,
    getUiStyleSnapshot,
    getUiStyleServerSnapshot
  )

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
            {navigationTree.map((node) => renderNavNode(node, pathname, locationHash))}
          </nav>
          {isUiStyleDevToolbarEnabled ? (
            <div className="mt-auto border-t border-border px-3 py-4 lg:px-4">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Piel de UI (dev)
              </p>
              <p className="mb-2 text-[10px] leading-snug text-muted-foreground/90">
                Las 7 pieles de{' '}
                <Link href="/style-lab" className="font-medium text-primary underline-offset-2 hover:underline">
                  Laboratorio
                </Link>
                .
              </p>
              <UiStyleDevSelect value={activeUiStyle} onValueChange={persistUiStyleChoice} />
            </div>
          ) : null}
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

        {isUiStyleDevToolbarEnabled ? (
          <div className="border-b border-border bg-muted/50 px-4 py-2 md:hidden">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Piel de UI (dev) · 7 estilos
            </p>
            <UiStyleDevSelect value={activeUiStyle} onValueChange={persistUiStyleChoice} />
          </div>
        ) : null}

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
            {mobileBottomNavItems.map((item) => {
              const active = navLinkIsActive(pathname, locationHash, item.href)
              return (
                <li key={item.name} className="flex-1">
                  <Link
                    href={item.href}
                    className={`flex flex-col items-center gap-0.5 px-1 py-2 text-[10px] font-semibold uppercase tracking-wide ${
                      active ? 'text-primary' : 'text-muted-foreground'
                    }`}
                  >
                    <item.icon className="h-5 w-5" aria-hidden />
                    <span className="truncate">{item.name}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      </div>
    </div>
  )
}
