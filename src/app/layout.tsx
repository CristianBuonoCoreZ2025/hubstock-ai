import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';
import { NodusAppLayout } from '@/components/layout/NodusAppLayout';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plus-jakarta',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'StockCasa AI',
  description: 'Inventario doméstico, compras y boletas con IA',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={plusJakarta.variable} suppressHydrationWarning>
      <body className={`${plusJakarta.className} font-sans font-medium`}>
        <Providers>
          <NodusAppLayout>{children}</NodusAppLayout>
        </Providers>
      </body>
    </html>
  );
}
