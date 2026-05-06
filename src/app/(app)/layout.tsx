import { Suspense } from 'react'
import AppShell from '@/components/layout/AppShell'
import { getProfileContext } from '@/lib/profile/context'

interface AppLayoutProps {
  children: React.ReactNode
}

export default async function AppLayout({ children }: AppLayoutProps) {
  const { profiles, activeProfileId } = await getProfileContext()

  return (
    <Suspense fallback={<div className="min-h-screen w-full bg-background" aria-hidden />}>
      <AppShell
        profiles={profiles}
        activeProfileId={activeProfileId}
        needsProfileSetup={profiles.length === 0}
      >
        {children}
      </AppShell>
    </Suspense>
  )
}
