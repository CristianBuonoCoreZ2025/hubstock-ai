import { PremiumBackground } from '@/components/ui/background-beams'

/**
 * Marco raíz: lienzo premium + contenido. Compatible tema claro / oscuro.
 */
export function NodusAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="sc-app relative min-h-dvh w-full overflow-x-hidden text-foreground antialiased">
      <PremiumBackground />
      <div className="relative z-10 min-h-dvh">{children}</div>
    </div>
  )
}
