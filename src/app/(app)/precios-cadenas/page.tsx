/*
 * Ruta: /app/(app)/precios-cadenas
 * Nombre de la pagina: PreciosCadenasPage
 * Legacy: redirige a /captura-cadenas-2
 */

import { redirect } from 'next/navigation'

export const metadata = {
  title: 'Precios Cadenas | HubStock AI',
}

export default function PreciosCadenasPage() {
  redirect('/captura-cadenas-2')
}
