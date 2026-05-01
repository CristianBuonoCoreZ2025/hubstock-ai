export default function UsersPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Gestión de usuarios</h1>
      <p className="text-sm text-muted-foreground">
        Invitaciones y roles por perfil (<code className="rounded bg-muted px-1 py-0.5 text-xs">profile_members</code>,{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">invitations</code>). Solo administradores.
      </p>
    </div>
  )
}
