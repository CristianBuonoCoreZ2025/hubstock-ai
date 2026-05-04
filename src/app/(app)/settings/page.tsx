'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function SettingsPage() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function signOut() {
    setPending(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
    setPending(false)
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Configuración</h1>
        <p className="text-sm text-muted-foreground">
          Preferencias de la app y sesión.
        </p>
      </div>

      <section className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">Apariencia</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Prueba más de diez pieles de interfaz y el modo día / noche en el laboratorio.
        </p>
        <Link
          href="/style-lab"
          className="mt-3 inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Abrir laboratorio de estilos
        </Link>
      </section>

      <section className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">Cuenta</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Cierra sesión en este dispositivo.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() => void signOut()}
          className="mt-3 inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm hover:bg-muted disabled:opacity-50"
        >
          {pending ? 'Saliendo…' : 'Cerrar sesión'}
        </button>
      </section>

      <p className="text-sm text-muted-foreground">
        <Link href="/menu" className="font-medium text-primary underline-offset-4 hover:underline">
          Volver al menú
        </Link>
      </p>
    </div>
  )
}
