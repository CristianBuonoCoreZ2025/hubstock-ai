import type { Metadata } from 'next'
import {
  Barlow,
  Bricolage_Grotesque,
  DM_Sans,
  Fredoka,
  Inter,
  Manrope,
  Nunito,
  Oswald,
  Quicksand,
  Sora,
  Space_Grotesk,
  Syne,
  Unbounded,
} from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/providers'
import { NodusAppLayout } from '@/components/layout/NodusAppLayout'

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
})

const oswald = Oswald({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-oswald',
  display: 'swap',
})

const barlow = Barlow({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-barlow',
  display: 'swap',
})

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-dm-sans',
  display: 'swap',
})

const sora = Sora({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  variable: '--font-sora',
  display: 'swap',
})

const quicksand = Quicksand({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-quicksand',
  display: 'swap',
})

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-manrope',
  display: 'swap',
})

const nunito = Nunito({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-nunito',
  display: 'swap',
})

const fredoka = Fredoka({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-fredoka',
  display: 'swap',
})

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
})

const syne = Syne({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-syne',
  display: 'swap',
})

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-bricolage',
  display: 'swap',
})

const unbounded = Unbounded({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-unbounded',
  display: 'swap',
})

const fontVariables = [
  inter.variable,
  oswald.variable,
  barlow.variable,
  dmSans.variable,
  sora.variable,
  quicksand.variable,
  manrope.variable,
  nunito.variable,
  fredoka.variable,
  spaceGrotesk.variable,
  syne.variable,
  bricolage.variable,
  unbounded.variable,
].join(' ')

export const metadata: Metadata = {
  title: 'StockCasa AI',
  description: 'Inventario doméstico, compras y boletas con IA',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" className={fontVariables} suppressHydrationWarning>
      <body className="min-h-dvh font-sans antialiased text-foreground">
        <Providers>
          <NodusAppLayout>{children}</NodusAppLayout>
        </Providers>
      </body>
    </html>
  )
}
