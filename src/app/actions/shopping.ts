'use server'

import { revalidatePath } from 'next/cache'
import { getActionContextWithGate } from '@/lib/action-context'
import { TRIP_PHASE_DRAFT, TRIP_PHASE_SHOPPING } from '@/lib/shopping-phase'

function parsePhase(notes: string | null): 'draft' | 'shopping' {
  return notes === TRIP_PHASE_SHOPPING ? 'shopping' : 'draft'
}

export async function getOrCreateActiveShoppingTrip() {
  const ctx = await getActionContextWithGate('editor')
  if (!ctx.ok) {
    return { data: null, error: ctx.error, phase: null as 'draft' | 'shopping' | null }
  }
  const { supabase, activeProfileId } = ctx

  const { data: existing } = await supabase
    .from('shopping_trips')
    .select('id, notes, completed_at, started_at')
    .eq('profile_id', activeProfileId)
    .is('completed_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) {
    return {
      data: existing,
      error: null,
      phase: parsePhase(existing.notes),
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { data: null, error: 'Not authenticated', phase: null }
  }

  const { data: created, error } = await supabase
    .from('shopping_trips')
    .insert({
      profile_id: activeProfileId,
      notes: TRIP_PHASE_DRAFT,
      created_by: user.id,
    })
    .select('id, notes, completed_at, started_at')
    .single()

  if (error) {
    return { data: null, error: error.message, phase: null }
  }

  return { data: created, error: null, phase: 'draft' as const }
}

export async function generateAutoList() {
  const ctx = await getActionContextWithGate('editor')
  if (!ctx.ok) return { error: ctx.error }
  const { supabase, activeProfileId } = ctx

  const tripRes = await getOrCreateActiveShoppingTrip()
  if (tripRes.error || !tripRes.data) return { error: tripRes.error ?? 'Trip error' }
  if (tripRes.phase === 'shopping') {
    return { error: 'Termina el viaje en curso antes de regenerar la lista.' }
  }

  const tripId = tripRes.data.id

  const { data: lowStock, error: prodErr } = await supabase
    .from('products')
    .select('id, stock_current, stock_min, stock_ideal')
    .eq('profile_id', activeProfileId)
    .eq('active', true)
    .not('stock_min', 'is', null)

  if (prodErr) return { error: prodErr.message }

  let added = 0
  for (const p of lowStock ?? []) {
    const min = Number(p.stock_min ?? 0)
    const cur = Number(p.stock_current)
    if (min <= 0 || cur > min) continue

    const ideal = p.stock_ideal != null ? Number(p.stock_ideal) : min
    const suggested = Math.max(1, Math.ceil(ideal - cur))

    const { error: upsertErr } = await supabase.from('shopping_trip_items').upsert(
      {
        trip_id: tripId,
        product_id: p.id,
        quantity_planned: suggested,
        sort_order: added,
      },
      { onConflict: 'trip_id,product_id' }
    )
    if (!upsertErr) added += 1
  }

  revalidatePath('/shopping-list')
  return { success: true, added }
}

export async function addItemToList(productId: string, quantity: number) {
  const ctx = await getActionContextWithGate('editor')
  if (!ctx.ok) return { error: ctx.error }
  const { supabase } = ctx

  const tripRes = await getOrCreateActiveShoppingTrip()
  if (tripRes.error || !tripRes.data) return { error: tripRes.error ?? 'Trip error' }

  const qty = Math.max(0.01, quantity)
  const { error } = await supabase.from('shopping_trip_items').upsert(
    {
      trip_id: tripRes.data.id,
      product_id: productId,
      quantity_planned: qty,
    },
    { onConflict: 'trip_id,product_id' }
  )

  if (error) return { error: error.message }
  revalidatePath('/shopping-list')
  return { success: true }
}

export async function updateListItemPlanned(itemId: string, quantityPlanned: number) {
  const ctx = await getActionContextWithGate('editor')
  if (!ctx.ok) return { error: ctx.error }
  const { supabase } = ctx

  const q = Math.max(0, quantityPlanned)
  const { error } = await supabase
    .from('shopping_trip_items')
    .update({ quantity_planned: q })
    .eq('id', itemId)

  if (error) return { error: error.message }
  revalidatePath('/shopping-list')
  revalidatePath('/supermarket')
  return { success: true }
}

export async function removeListItem(itemId: string) {
  const ctx = await getActionContextWithGate('editor')
  if (!ctx.ok) return { error: ctx.error }
  const { supabase, activeProfileId } = ctx

  const { data: row } = await supabase.from('shopping_trip_items').select('trip_id').eq('id', itemId).single()
  if (!row) return { error: 'Ítem no encontrado' }
  const { data: trip } = await supabase
    .from('shopping_trips')
    .select('profile_id')
    .eq('id', row.trip_id)
    .single()
  if (!trip || trip.profile_id !== activeProfileId) return { error: 'Sin permiso' }

  const { error } = await supabase.from('shopping_trip_items').delete().eq('id', itemId)
  if (error) return { error: error.message }
  revalidatePath('/shopping-list')
  revalidatePath('/supermarket')
  return { success: true }
}

export async function startShoppingTrip(tripId: string) {
  const ctx = await getActionContextWithGate('editor')
  if (!ctx.ok) return { error: ctx.error }
  const { supabase, activeProfileId } = ctx

  const { error } = await supabase
    .from('shopping_trips')
    .update({ notes: TRIP_PHASE_SHOPPING })
    .eq('id', tripId)
    .eq('profile_id', activeProfileId)
    .is('completed_at', null)

  if (error) return { error: error.message }
  revalidatePath('/shopping-list')
  revalidatePath('/supermarket')
  return { success: true }
}

export async function checkShoppingItem(
  itemId: string,
  isChecked: boolean,
  unitPricePaid?: number | null
) {
  const ctx = await getActionContextWithGate('editor')
  if (!ctx.ok) return { error: ctx.error }
  const { supabase, activeProfileId } = ctx

  const { data: row, error: fetchErr } = await supabase
    .from('shopping_trip_items')
    .select('id, quantity_planned, trip_id')
    .eq('id', itemId)
    .single()

  if (fetchErr || !row) return { error: fetchErr?.message ?? 'Item no encontrado' }

  const { data: trip, error: tripErr } = await supabase
    .from('shopping_trips')
    .select('profile_id, completed_at')
    .eq('id', row.trip_id)
    .single()

  if (tripErr || !trip || trip.profile_id !== activeProfileId || trip.completed_at) {
    return { error: 'Viaje no válido' }
  }

  const planned = Number(row.quantity_planned)
  const patch: Record<string, unknown> = {
    is_checked: isChecked,
  }

  if (isChecked) {
    patch.quantity_bought = planned
    if (unitPricePaid !== undefined && unitPricePaid !== null && !Number.isNaN(Number(unitPricePaid))) {
      patch.unit_price_paid = Number(unitPricePaid)
    }
  } else {
    patch.quantity_bought = null
    patch.unit_price_paid = null
  }

  const { error } = await supabase.from('shopping_trip_items').update(patch as never).eq('id', itemId)

  if (error) return { error: error.message }
  revalidatePath('/supermarket')
  return { success: true }
}

export async function updateItemBoughtQuantity(itemId: string, quantityBought: number) {
  const ctx = await getActionContextWithGate('editor')
  if (!ctx.ok) return { error: ctx.error }
  const { supabase } = ctx

  const q = Math.max(0, quantityBought)
  const { error } = await supabase
    .from('shopping_trip_items')
    .update({ quantity_bought: q })
    .eq('id', itemId)

  if (error) return { error: error.message }
  revalidatePath('/supermarket')
  return { success: true }
}

export async function finishShoppingTrip(tripId: string) {
  const ctx = await getActionContextWithGate('editor')
  if (!ctx.ok) return { error: ctx.error }
  const { supabase, activeProfileId } = ctx

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: trip, error: te } = await supabase
    .from('shopping_trips')
    .select('id, profile_id, completed_at')
    .eq('id', tripId)
    .eq('profile_id', activeProfileId)
    .single()

  if (te || !trip || trip.completed_at) {
    return { error: 'Viaje no encontrado o ya cerrado' }
  }

  const { data: items, error: ie } = await supabase
    .from('shopping_trip_items')
    .select('id, product_id, quantity_planned, quantity_bought, is_checked')
    .eq('trip_id', tripId)

  if (ie) return { error: ie.message }

  for (const item of items ?? []) {
    const planned = Number(item.quantity_planned)
    let bought = item.quantity_bought != null ? Number(item.quantity_bought) : 0
    if (bought <= 0 && item.is_checked) {
      bought = planned
    }
    if (bought <= 0) continue

    const { data: product, error: pe } = await supabase
      .from('products')
      .select('stock_current')
      .eq('id', item.product_id)
      .eq('profile_id', activeProfileId)
      .single()

    if (pe || !product) continue

    const prev = Number(product.stock_current)
    const newStock = prev + bought

    const { error: ue } = await supabase
      .from('products')
      .update({ stock_current: newStock })
      .eq('id', item.product_id)
      .eq('profile_id', activeProfileId)

    if (ue) continue

    await supabase.from('stock_movements').insert({
      profile_id: activeProfileId,
      product_id: item.product_id,
      delta: bought,
      movement_type: 'purchase',
      note: `shopping_trip:${tripId}`,
      reference_id: tripId,
      created_by: user.id,
    })
  }

  const { error: ce } = await supabase
    .from('shopping_trips')
    .update({
      completed_at: new Date().toISOString(),
      notes: null,
    })
    .eq('id', tripId)

  if (ce) return { error: ce.message }

  revalidatePath('/supermarket')
  revalidatePath('/shopping-list')
  revalidatePath('/inventory')
  revalidatePath('/history')
  revalidatePath('/dashboard')
  return { success: true }
}
