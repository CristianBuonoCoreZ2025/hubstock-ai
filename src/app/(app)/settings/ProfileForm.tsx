'use client'

import { useRef, useState } from 'react'
import { updateActiveProfileSettings } from '@/app/actions/profile'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'

type Props = {
  name: string
  description: string | null
  canEdit: boolean
}

export function ProfileForm({ name, description, canEdit }: Props) {
  const formRef = useRef<HTMLFormElement>(null)
  const [saving, setSaving] = useState(false)

  if (!canEdit) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Datos de la ubicación</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Solo los administradores pueden editar el nombre y la descripción de la ubicación.
          </p>
        </CardContent>
      </Card>
    )
  }

  async function handleSubmit(formData: FormData) {
    setSaving(true)
    try {
      const result = await updateActiveProfileSettings(formData)
      if (result.ok) {
        toast.success('Perfil actualizado')
      } else {
        toast.error(result.error ?? 'No se pudo guardar el perfil.')
      }
    } catch {
      toast.error('Ocurrió un error inesperado')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Datos de la ubicación</CardTitle>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={handleSubmit} className="flex max-w-lg flex-col gap-4">
          <div>
            <label className="app-field-label" htmlFor="name">
              Nombre
            </label>
            <input
              id="name"
              name="name"
              required
              minLength={2}
              defaultValue={name}
              className="app-input"
            />
          </div>
          <div>
            <label className="app-field-label" htmlFor="description">
              Descripción
            </label>
            <textarea
              id="description"
              name="description"
              rows={3}
              defaultValue={description ?? ''}
              className="app-input min-h-[88px] resize-y"
            />
          </div>
          <div className="app-form-actions">
            <Button type="submit" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
