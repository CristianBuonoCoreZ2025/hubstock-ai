'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function SignOutPanel() {
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
    <Card>
      <CardHeader>
        <CardTitle>Cuenta</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">Cierra sesión en este dispositivo.</p>
        <div className="app-form-actions">
          <Button type="button" variant="secondary" disabled={pending} onClick={() => void signOut()}>
            {pending ? 'Saliendo…' : 'Cerrar sesión'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
