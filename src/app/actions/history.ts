'use server'

import { getActionContext } from '@/lib/action-context'

export async function getStockMovements(limit = 150) {
  const ctx = await getActionContext()
  if (!ctx.ok) {
    return { data: [], error: null as string | null }
  }
  const { supabase, activeProfileId } = ctx
  const { data, error } = await supabase
    .from('stock_movements')
    .select(
      `
      id,
      created_at,
      delta,
      movement_type,
      note,
      created_by,
      product_id,
      products ( name )
    `
    )
    .eq('profile_id', activeProfileId)
    .order('created_at', { ascending: false })
    .limit(limit)

  return { data, error: error?.message ?? null }
}
