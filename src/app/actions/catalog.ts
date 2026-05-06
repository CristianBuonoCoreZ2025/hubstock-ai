'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type CopyCatalogResult =
  | { ok: true; inserted: number }
  | { ok: false; error: string }

/**
 * Copia el catálogo maestro global al perfil activo (solo admin/editor).
 * Idempotente: no duplica filas ya vinculadas por catalog_product_id.
 * La RPC inserta `stock_current = 0` (ver migración `copy_catalog_products_to_profile`); no crea `stock_movements` en la copia.
 */
export async function copyCatalogProductsToProfile(
  profileId: string
): Promise<CopyCatalogResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, error: 'no_session' }
  }

  const { data, error } = await supabase.rpc('copy_catalog_products_to_profile', {
    p_profile_id: profileId,
    p_created_by: user.id,
  })

  if (error) {
    if (error.message.includes('not_allowed')) {
      return { ok: false, error: 'not_allowed' }
    }
    return { ok: false, error: error.message }
  }

  const inserted = typeof data === 'number' ? data : Number(data ?? 0)
  revalidatePath('/inventory')
  revalidatePath('/catalog')
  return { ok: true, inserted: Number.isFinite(inserted) ? inserted : 0 }
}
