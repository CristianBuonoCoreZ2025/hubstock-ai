import { updateActiveProfileSettings } from '@/app/actions/profile'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Props = {
  name: string
  description: string | null
  canEdit: boolean
}

export function ProfileForm({ name, description, canEdit }: Props) {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Datos de la ubicación</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={updateActiveProfileSettings} className="flex max-w-lg flex-col gap-4">
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
            <Button type="submit">Guardar</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
