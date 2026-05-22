'use server'

import { createServiceRoleClient } from '@/server/supabase-admin'
import { getUserFriendlyErrorMessage } from '@/lib/user-friendly-errors'

export type ChangelogRow = {
  id: string
  version: string
  module: string
  description: string
  files_changed: string[]
  author: string | null
  commit_hash: string | null
  tags: string[]
  created_at: string
}

export async function getAppChangelogAction(): Promise<
  { ok: true; rows: ChangelogRow[] } | { ok: false; error: string }
> {
  try {
    const admin = createServiceRoleClient()
    const { data, error } = await admin
      .from('app_changelog')
      .select('id, version, module, description, files_changed, author, commit_hash, tags, created_at')
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
    }

    return { ok: true, rows: (data ?? []) as ChangelogRow[] }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}
