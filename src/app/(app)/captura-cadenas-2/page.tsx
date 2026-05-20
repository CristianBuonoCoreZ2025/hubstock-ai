import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CapturaCadenas2Client } from './CapturaCadenas2Client'

/** Presupuesto de ejecución de server actions desde esta ruta (seg.). El hosting puede imponer un tope menor. */
export const maxDuration = 3600

export const metadata = {
  title: 'Captura de cadenas 2 | HubStock AI',
}

export default async function CapturaCadenas2Page() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="app-page">
      <header className="app-page-header">
        <h1 className="app-page-title">Captura de cadenas 2</h1>
        <p className="app-page-lead">
          Scraping masivo de productos Lider hacia la tabla <code className="rounded bg-muted px-1">scrapping</code>{' '}
          (URL completa, nombre, marca, precio, cadena, fecha de extracción). Sin taxonomía ni homologación en
          esta pantalla: primero capturamos todo; el análisis viene después.
        </p>
      </header>

      <CapturaCadenas2Client />
    </div>
  )
}
