'use client'

import { useState, useTransition } from 'react'
import { copyCatalogProductsToProfile } from '@/app/actions/catalog'

type Props = {
  profileId: string
}

export function CopyCatalogButton({ profileId }: Props) {
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleClick() {
    setMessage(null)
    setError(null)
    startTransition(async () => {
      const result = await copyCatalogProductsToProfile(profileId)
      if (result.ok) {
        setMessage(
          result.inserted === 0
            ? 'Tu inventario ya tenía todos los ítems del catálogo maestro.'
            : `Se agregaron ${result.inserted} productos al inventario desde el catálogo maestro.`
        )
      } else if (result.error === 'not_allowed') {
        setError('Solo administradores o editores pueden copiar el catálogo.')
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-2 sm:max-w-xs">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? 'Copiando…' : 'Copiar catálogo al inventario'}
      </button>
      {message != null ? (
        <p className="text-xs text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
      {error != null ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
