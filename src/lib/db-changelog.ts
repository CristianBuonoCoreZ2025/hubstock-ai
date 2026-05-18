/**
 * Changelog persistente en base de datos.
 * Registra cambios arquitectónicos para auditoría y trazabilidad.
 * BEVECOHO: La base guarda TODO.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type ChangelogEntry = {
  version: string
  module: string
  description: string
  filesChanged?: string[]
  author?: string
  commitHash?: string
  tags?: string[]
}

/**
 * Registra un cambio arquitectónico en app_changelog.
 * Silencioso: si falla, no lanza error.
 */
export async function writeChangelog(
  admin: SupabaseClient,
  entry: ChangelogEntry,
): Promise<void> {
  try {
    const { error } = await admin.from('app_changelog').insert({
      version: entry.version,
      module: entry.module,
      description: entry.description,
      files_changed: entry.filesChanged ?? [],
      author: entry.author ?? null,
      commit_hash: entry.commitHash ?? null,
      tags: entry.tags ?? [],
    } as never)
    if (error) {
      console.error('[db-changelog] falló escritura:', error.message)
    }
  } catch {
    // Silencioso
  }
}
