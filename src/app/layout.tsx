import type { Metadata } from 'next'
import {
  DM_Sans,
  Fraunces,
  Inter,
  JetBrains_Mono,
  Lora,
  Nunito,
  Outfit,
  Playfair_Display,
  Space_Grotesk,
  Syne,
} from 'next/font/google'
import ThemeClientProvider from '@/components/theme/ThemeClientProvider'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  display: 'swap',
})

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
})

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
})

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
})

const syne = Syne({
  subsets: ['latin'],
  variable: '--font-syne',
  display: 'swap',
})

const nunito = Nunito({
  subsets: ['latin'],
  variable: '--font-nunito',
  display: 'swap',
})

const lora = Lora({
  subsets: ['latin'],
  variable: '--font-lora',
  display: 'swap',
})

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

const fontVariables = [
  inter.variable,
  outfit.variable,
  dmSans.variable,
  playfair.variable,
  spaceGrotesk.variable,
  syne.variable,
  nunito.variable,
  lora.variable,
  fraunces.variable,
  jetbrainsMono.variable,
].join(' ')

export const metadata: Metadata = {
  title: 'StockCasa AI',
  description: 'Inventario doméstico, compras y boletas con IA',
}

const themeInitScript = `(function(){try{var k='stockcasa-theme',d=document.documentElement;var m=localStorage.getItem(k);if(m==='dark')d.classList.add('dark');else if(m==='light')d.classList.remove('dark');else if(window.matchMedia('(prefers-color-scheme: dark)').matches)d.classList.add('dark');var s=localStorage.getItem('stockcasa-ui-style');if(s)d.dataset.uiStyle=s;}catch(e){}})();`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" className={fontVariables} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={inter.className}>
        <ThemeClientProvider>{children}</ThemeClientProvider>
      </body>
    </html>
  )
}
