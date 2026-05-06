import Link from 'next/link'
import { PAGE_LEADS } from '@/lib/domain'
import { createProfile } from '@/app/actions/profile'

const errorText: Record<string, string> = {
  invalid_name: 'El nombre debe tener al menos 2 caracteres.',
  insert_failed: 'No se pudo crear la ubicación. Revisa el esquema y RLS en Supabase.',
}

type PageProps = {
  searchParams: Promise<{ error?: string }>
}

export default async function NewProfilePage({ searchParams }: PageProps) {
  const { error: errorKey } = await searchParams
  const errorMessage = errorKey ? errorText[errorKey] ?? 'Error desconocido.' : null

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <div>
        <p className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
          Administración · Ubicación
        </p>
        <h1 className="mt-1 text-2xl font-bold">Nueva ubicación</h1>
        <p className="mt-1 text-sm text-muted-foreground">{PAGE_LEADS.profilesNew}</p>
      </div>

      {errorMessage ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <form action={createProfile} className="flex flex-col gap-4">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            Nombre del hogar
          </label>
          <input
            id="name"
            name="name"
            required
            minLength={2}
            placeholder="Ej. Casa centro"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="description" className="text-sm font-medium">
            Descripción (opcional)
          </label>
          <textarea
            id="description"
            name="description"
            rows={3}
            className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
          >
            Crear ubicación
          </button>
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm hover:bg-muted"
          >
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  )
}
