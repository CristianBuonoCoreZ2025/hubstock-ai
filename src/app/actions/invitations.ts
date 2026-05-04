import { createServiceRoleClient } from '@/server/supabase-admin'
import { withErrorHandling } from '@/lib/error-handler'

export async function inviteUserToProfile(
  email: string,
  profileId: string,
  role: 'admin' | 'editor' | 'viewer',
  adminUserId: string
) {
  return withErrorHandling(async () => {
    const supabase = createServiceRoleClient()

    // 1. Verificar si el usuario ya existe en auth.users
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers()
    if (listError) throw listError
    
    const existingUser = users.find(u => u.email === email)

    if (!existingUser) {
      // 2. Si no existe, crear usuario con password genérica
      const { error: createError } = await supabase.auth.admin.createUser({
        email,
        password: 'PasswordGenerica123!',
        email_confirm: true,
      })
      if (createError) throw createError
    }

    // 3. Crear invitación
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: inviteError } = await (supabase as any)
      .from('invitations')
      .insert([
        {
          profile_id: profileId,
          email,
          role,
          status: 'pending',
          token: crypto.randomUUID(),
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          invited_by: adminUserId
        }
      ])
    if (inviteError) throw inviteError

    return { ok: true }
  }, { actionName: 'inviteUserToProfile', userId: adminUserId })
}
