'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

export default function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setLoading(true)
    const supabase = createClient()
    const origin = window.location.origin
    const { error: signError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=/profiles/new`,
      },
    })
    setLoading(false)
    if (signError) {
      setError(signError.message)
      return
    }
    setInfo(
      'Revisa tu correo para confirmar la cuenta si tu proyecto Supabase exige verificación de email.'
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="space-y-2">
        <p className="auth-brand">Cuenta</p>
        <h1 className="auth-title">Crea tu cuenta</h1>
        <p className="auth-subtitle">Mismo estilo y claridad que el inicio de sesión.</p>
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
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            className="app-input"
          />
          <p className="text-[12px] text-muted-foreground">Mínimo 8 caracteres.</p>
        </div>

        {error ? (
          <p className="text-[13px] text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {info ? (
          <p className="text-[13px] text-muted-foreground" role="status">
            {info}
          </p>
        ) : null}

        <Button type="submit" disabled={loading} size="lg" className="h-11 w-full">
          {loading ? 'Creando…' : 'Registrarse'}
        </Button>
      </form>

      <p className="text-center text-[13px] text-muted-foreground">
        ¿Ya tienes cuenta?{' '}
        <Link href="/login" className="font-semibold text-foreground underline-offset-4 hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  )
}
