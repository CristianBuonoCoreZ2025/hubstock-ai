'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams.get('next') ?? '/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const supabase = createClient()
    const { error: signError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    setLoading(false)
    if (signError) {
      setError(signError.message)
      return
    }
    router.refresh()
    router.push(nextPath.startsWith('/') ? nextPath : '/dashboard')
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="space-y-2">
        <p className="auth-brand">Acceso</p>
        <h1 className="auth-title">
          Inicia sesión en{' '}
          <span className="text-gradient-warm">StockCasa</span>
        </h1>
        <p className="auth-subtitle">Inventario del hogar con listas inteligentes y boletas.</p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <div className="space-y-2">
          <label htmlFor="email" className="app-field-label">
            Correo
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            className="app-input"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className="app-field-label">
            Contraseña
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            className="app-input"
          />
        </div>

        {error ? (
          <p className="text-[13px] text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={loading} size="lg" className="h-11 w-full">
          {loading ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>

      <p className="text-center text-[13px] text-muted-foreground">
        ¿Sin cuenta?{' '}
        <Link
          href="/register"
          className="font-semibold text-foreground underline-offset-4 hover:underline"
        >
          Crear cuenta
        </Link>
      </p>
    </div>
  )
}
