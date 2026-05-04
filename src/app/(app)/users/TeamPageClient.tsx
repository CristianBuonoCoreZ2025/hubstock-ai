'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  createInvitation,
  deactivateMember,
  updateMemberRole,
} from '@/app/actions/team'
import type { ProfileMemberRole } from '@/types/database'

type Member = {
  id: string
  user_id: string
  role: ProfileMemberRole
  status: string
}

type Invitation = {
  id: string
  email: string
  role: ProfileMemberRole
  status: string
  expires_at: string
}

type Props = {
  members: Member[]
  invitations: Invitation[]
  isAdmin: boolean
}

const roles: ProfileMemberRole[] = ['admin', 'editor', 'viewer']

export function TeamPageClient({ members, invitations, isAdmin }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <div className="app-page">
      <header className="app-page-header">
        <h1 className="app-page-title">Equipo</h1>
        <p className="app-page-lead">
          Miembros del hogar (perfil activo). Las invitaciones requieren rol administrador.
        </p>
      </header>

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Invitar</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex max-w-lg flex-col gap-3 sm:flex-row sm:items-end"
              action={async (fd) => {
                startTransition(async () => {
                  const r = await createInvitation(fd)
                  if (r.error) toast.error(r.error)
                  else {
                    toast.success('Invitación creada')
                    router.refresh()
                  }
                })
              }}
            >
              <div className="min-w-0 flex-1">
                <label className="app-field-label" htmlFor="email">
                  Correo
                </label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  className="glass-panel-subtle border-white/10"
                />
              </div>
              <div>
                <label className="app-field-label" htmlFor="role">
                  Rol
                </label>
                <select id="role" name="role" className="app-input h-9" defaultValue="editor">
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={pending}>
                Enviar
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <div className="app-data-table-wrap">
        <table className="app-data-table">
          <thead>
            <tr>
              <th>Usuario (id)</th>
              <th>Rol</th>
              <th>Estado</th>
              {isAdmin ? <th className="text-right">Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td className="font-mono text-xs text-slate-300">{m.user_id}</td>
                <td>
                  {isAdmin ? (
                    <select
                      className="app-input h-9 min-w-32"
                      defaultValue={m.role}
                      disabled={pending}
                      onChange={(e) => {
                        const role = e.target.value as ProfileMemberRole
                        startTransition(async () => {
                          const r = await updateMemberRole(m.id, role)
                          if (r.error) toast.error(r.error)
                          else {
                            toast.success('Rol actualizado')
                            router.refresh()
                          }
                        })
                      }}
                    >
                      {roles.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    m.role
                  )}
                </td>
                <td>{m.status}</td>
                {isAdmin ? (
                  <td className="text-right">
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        startTransition(async () => {
                          const r = await deactivateMember(m.id)
                          if (r.error) toast.error(r.error)
                          else {
                            toast.success('Miembro desactivado')
                            router.refresh()
                          }
                        })
                      }}
                    >
                      Desactivar
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {invitations.length > 0 ? (
        <section>
          <h2 className="mb-2 text-lg font-bold">Invitaciones pendientes</h2>
          <div className="app-data-table-wrap">
            <table className="app-data-table">
              <thead>
                <tr>
                  <th>Correo</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th>Expira</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((i) => (
                  <tr key={i.id}>
                    <td>{i.email}</td>
                    <td>{i.role}</td>
                    <td>{i.status}</td>
                    <td className="text-sm text-muted-foreground">
                      {new Date(i.expires_at).toLocaleDateString('es')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  )
}
