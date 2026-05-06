'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { Users, Mail, Home, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  createInvitation,
  deactivateMember,
  revokeInvitation,
  syncInvitationExtraProfiles,
  updateMemberRole,
} from '@/app/actions/team'
import type { TeamInvitationRow } from '@/app/actions/team'
import type { ProfileMemberRole } from '@/types/database'
import type { ProfileOption } from '@/lib/profile/context'

type Member = {
  id: string
  user_id: string
  role: ProfileMemberRole
  status: string
}

type Props = {
  profiles: ProfileOption[]
  activeProfileId: string | null
  adminProfileIds: string[]
  members: Member[]
  invitations: TeamInvitationRow[]
  isAdmin: boolean
}

const roles: ProfileMemberRole[] = ['admin', 'editor', 'viewer']

function roleLabel(role: ProfileMemberRole): string {
  if (role === 'admin') return 'Administrador'
  if (role === 'editor') return 'Editor'
  return 'Lector'
}

function shortUserId(uid: string): string {
  if (!uid || uid.length <= 14) return uid
  return `${uid.slice(0, 8)}…${uid.slice(-4)}`
}

function invitationExtraIds(inv: TeamInvitationRow): string[] {
  const rows = inv.invitation_targets ?? []
  return rows.map((r) => r.profile_id).filter(Boolean)
}

export function TeamPageClient({
  profiles,
  activeProfileId,
  adminProfileIds,
  members,
  invitations,
  isAdmin,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [manageOpen, setManageOpen] = useState(false)
  const [activeInvitation, setActiveInvitation] = useState<TeamInvitationRow | null>(null)
  const [extrasDraft, setExtrasDraft] = useState<Record<string, boolean>>({})

  const adminSet = useMemo(() => new Set(adminProfileIds), [adminProfileIds])

  const profileNameById = useMemo(() => {
    const m = new Map<string, string>()
    profiles.forEach((p) => m.set(p.id, p.name))
    return m
  }, [profiles])

  const anchorName =
    activeProfileId && profileNameById.has(activeProfileId)
      ? profileNameById.get(activeProfileId)
      : 'Perfil activo'

  const selectableExtraProfiles = useMemo(() => {
    const anchor = activeProfileId
    return profiles.filter((p) => anchor && p.id !== anchor && adminSet.has(p.id))
  }, [profiles, activeProfileId, adminSet])

  function openManage(inv: TeamInvitationRow) {
    const draft: Record<string, boolean> = {}
    invitationExtraIds(inv).forEach((id) => {
      draft[id] = true
    })
    selectableExtraProfiles.forEach((p) => {
      if (!(p.id in draft)) draft[p.id] = false
    })
    setExtrasDraft(draft)
    setActiveInvitation(inv)
    setManageOpen(true)
  }

  async function submitManage() {
    if (!activeInvitation) return
    const extras = Object.entries(extrasDraft).filter(([, v]) => v).map(([id]) => id)

    startTransition(async () => {
      const r = await syncInvitationExtraProfiles(activeInvitation.id, extras)
      if (r.error) toast.error(r.error)
      else {
        toast.success('Hogares enlazados actualizados')
        setManageOpen(false)
        router.refresh()
      }
    })
  }

  return (
    <div className="app-page">
      <header className="app-page-header">
        <h1 className="app-page-title">Administración</h1>
        <p className="app-page-lead">
          Administración del hogar activo: personas (miembros), invitaciones enviadas y envío de nuevas
          invitaciones cuando aplica. Vista actual:{' '}
          <span className="font-medium text-foreground">{anchorName ?? '—'}</span>.
        </p>
      </header>

      <div className="flex flex-col gap-10">
        {isAdmin ? (
          <section className="rounded-2xl border border-border/80 bg-card/40 p-6 shadow-sm backdrop-blur-sm">
            <div className="mb-5 flex items-center gap-2">
              <Mail className="h-5 w-5 text-muted-foreground" aria-hidden />
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Invitar persona</h2>
                <p className="text-[13px] text-muted-foreground">
                  Una sola invitación; después asocias más hogares en el listado.
                </p>
              </div>
            </div>
            <form
              className="grid gap-4 sm:grid-cols-[1fr,minmax(8rem,10rem),auto]"
              action={async (fd) => {
                startTransition(async () => {
                  const r = await createInvitation(fd)
                  if ('error' in r && r.error) toast.error(r.error)
                  else {
                    toast.success('Invitación creada. Enlaza hogares en el listado de abajo si aplica.')
                    router.refresh()
                  }
                })
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="email">Correo</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  placeholder="nombre@ejemplo.com"
                  autoComplete="email"
                  className="h-11 rounded-xl border-white/12 bg-background/60"
                  disabled={pending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Rol</Label>
                <select
                  id="role"
                  name="role"
                  className="app-input flex h-11 w-full items-center rounded-xl border-white/12 bg-background/60 px-3 text-[13px]"
                  defaultValue="editor"
                  disabled={pending}
                >
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <Button type="submit" className="h-11 w-full rounded-xl sm:w-auto" disabled={pending}>
                  Enviar invitación
                </Button>
              </div>
            </form>
          </section>
        ) : null}

        {isAdmin ? (
          <section id="admin-invitaciones" className="scroll-mt-24">
            <div className="mb-4 flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" aria-hidden />
              <h2 className="text-lg font-semibold tracking-tight">Invitaciones pendientes</h2>
            </div>
            {invitations.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                No hay invitaciones vigentes para este hogar. Crea una arriba.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {invitations.map((inv) => {
                  const extra = invitationExtraIds(inv)
                  const linkedLabels = [
                    `${profileNameById.get(inv.profile_id) ?? 'Hogar'} (principal)` ,
                    ...extra.map((pid) => profileNameById.get(pid) ?? shortUserId(pid)),
                  ]

                  return (
                    <li
                      key={inv.id}
                      className="flex flex-col gap-4 rounded-2xl border border-border/80 bg-card/50 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="truncate font-medium text-foreground">{inv.email}</span>
                          <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-primary">
                            {roleLabel(inv.role)}
                          </span>
                          <span className="text-[12px] text-muted-foreground">
                            Caduca {new Date(inv.expires_at).toLocaleDateString('es')}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {linkedLabels.map((label, i) => (
                            <span
                              key={`${inv.id}-${i}-${label}`}
                              className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-background/40 px-2 py-1 text-[12px] text-muted-foreground"
                            >
                              <Home className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                              {label}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="rounded-xl"
                          disabled={pending}
                          onClick={() => openManage(inv)}
                        >
                          Hogares enlazados
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-xl text-destructive hover:bg-destructive/10"
                          disabled={pending}
                          onClick={() => {
                            startTransition(async () => {
                              const r = await revokeInvitation(inv.id)
                              if ('error' in r && r.error) toast.error(r.error)
                              else {
                                toast.success('Invitación revocada')
                                router.refresh()
                              }
                            })
                          }}
                        >
                          <Trash2 className="mr-1.5 h-4 w-4" aria-hidden />
                          Revocar
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        ) : null}

        <section id="admin-personas" className="scroll-mt-24">
          <div className="mb-4 flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" aria-hidden />
            <h2 className="text-lg font-semibold tracking-tight">Miembros de este hogar</h2>
          </div>
          {members.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
              No hay miembros listados.
            </p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border/80">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-border/80 bg-muted/30">
                  <tr>
                    <th className="px-4 py-3 font-medium">Usuario</th>
                    <th className="px-4 py-3 font-medium">Rol</th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                    {isAdmin ? <th className="px-4 py-3 text-right font-medium">Acciones</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {members.map((m) => (
                    <tr key={m.id} className="bg-card/30">
                      <td className="px-4 py-3">
                        <div className="font-mono text-[12px] text-foreground/90">{shortUserId(m.user_id)}</div>
                        <div className="text-[11px] text-muted-foreground">ID de cuenta</div>
                      </td>
                      <td className="px-4 py-3">
                        {isAdmin ? (
                          <select
                            className="app-input h-9 min-w-36 rounded-lg border-white/12 bg-background/60 px-2"
                            defaultValue={m.role}
                            disabled={pending}
                            aria-label={`Rol de ${m.user_id}`}
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
                                {roleLabel(r)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          roleLabel(m.role)
                        )}
                      </td>
                      <td className="px-4 py-3 capitalize">{m.status}</td>
                      {isAdmin ? (
                        <td className="px-4 py-3 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="rounded-lg text-destructive hover:bg-destructive/10"
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
          )}
        </section>
      </div>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>Hogares enlazados a la invitación</DialogTitle>
            <DialogDescription>
              El hogar activo al enviar la invitación queda como principal. Marca otros hogares donde también eres
              administrador; la persona aceptará acceso a todos con un inicio de sesión.
            </DialogDescription>
          </DialogHeader>
          {activeInvitation ? (
            <div className="space-y-3">
              <p className="text-[13px] font-medium text-foreground">{activeInvitation.email}</p>
              <div className="rounded-xl border border-border/70 bg-muted/15 p-3 text-[12px] text-muted-foreground">
                <span className="font-medium text-foreground">Principal: </span>
                {profileNameById.get(activeInvitation.profile_id) ?? 'Hogar actual'}
              </div>
              {selectableExtraProfiles.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">
                  No tienes otros hogares con rol administrador para enlazar. Crea otro perfil y vuelve aquí.
                </p>
              ) : (
                <ul className="max-h-56 space-y-2 overflow-y-auto pr-1">
                  {selectableExtraProfiles.map((p) => (
                    <li key={p.id}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-transparent px-2 py-2 hover:border-border/60 hover:bg-muted/20">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-border accent-primary"
                          checked={Boolean(extrasDraft[p.id])}
                          disabled={pending}
                          onChange={(e) =>
                            setExtrasDraft((prev) => ({ ...prev, [p.id]: e.target.checked }))
                          }
                        />
                        <span className="text-[13px]">{p.name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setManageOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" disabled={pending || !activeInvitation} onClick={() => void submitManage()}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
