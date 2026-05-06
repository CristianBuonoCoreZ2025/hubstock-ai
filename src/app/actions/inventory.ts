'use server'

import { createClient } from '@/lib/supabase/server'
import { getProfileContext } from '@/lib/profile/context'
import { revalidatePath } from 'next/cache'

export async function getProducts() {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return { data: null, error: new Error('No active profile') }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('products')
    .select(`
      *,
      category:categories(id, name),
      section:sections(id, name)
    `)
    .eq('profile_id', activeProfileId)
    .eq('active', true)
    .order('name')

  return { data, error }
}

export async function getCategoriesAndSections() {
  const supabase = await createClient()
  
  const [categoriesRes, sectionsRes] = await Promise.all([
    supabase.from('categories').select('id, name, section_id, sort_order').order('sort_order'),
    supabase.from('sections').select('id, name, sort_order').order('sort_order'),
  ])

  return {
    categories: categoriesRes.data || [],
    sections: sectionsRes.data || [],
    error: categoriesRes.error || sectionsRes.error
  }
}

export async function addProduct(formData: FormData) {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return { error: 'No active profile' }
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { error: 'Not authenticated' }
  }

  const name = formData.get('name') as string
  const category_id = formData.get('category_id') as string
  const section_id = formData.get('section_id') as string
  const stock_current = Number(formData.get('stock_current') || 0)
  const stock_min_raw = formData.get('stock_min')
  const stock_min =
    stock_min_raw !== null && String(stock_min_raw).trim() !== ''
      ? Number(stock_min_raw)
      : null
  const reference_price = formData.get('reference_price') ? Number(formData.get('reference_price')) : null

  if (!name || !category_id || !section_id) {
    return { error: 'Missing required fields' }
  }

  const { data, error } = await supabase
    .from('products')
    .insert({
      profile_id: activeProfileId,
      name,
      category_id,
      section_id,
      stock_current,
      stock_min,
      reference_price,
      created_by: userData.user.id,
      active: true
    })
    .select()
    .single()

  if (error) {
    console.error('Error adding product:', error)
    return { error: error.message }
  }

  if (data && stock_current > 0) {
    const { error: movErr } = await supabase.from('stock_movements').insert({
      profile_id: activeProfileId,
      product_id: data.id,
      delta: stock_current,
      movement_type: 'import',
      note: 'Alta manual (inventario)',
      reference_id: null,
      created_by: userData.user.id,
    })
    if (movErr) {
      console.error('stock_movements tras alta de producto:', movErr)
      const { error: revertErr } = await supabase
        .from('products')
        .update({ stock_current: 0 })
        .eq('id', data.id)
        .eq('profile_id', activeProfileId)
      if (revertErr) {
        console.error('Revertir stock tras fallo de movimiento (alta):', revertErr)
        return {
          error: `No se registró el movimiento de stock y no se pudo dejar la cantidad en 0: ${revertErr.message} (movimiento: ${movErr.message})`,
        }
      }
      return {
        error: `No se pudo registrar el movimiento de stock; la cantidad del producto quedó en 0. ${movErr.message}`,
      }
    }
  }

  revalidatePath('/inventory')
  revalidatePath('/history')
  return { data }
}

export async function updateProduct(id: string, formData: FormData) {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return { error: 'No active profile' }
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { error: 'Not authenticated' }
  }

  const name = formData.get('name') as string
  const category_id = formData.get('category_id') as string
  const section_id = formData.get('section_id') as string
  const stock_current = Number(formData.get('stock_current') || 0)
  const stock_min_raw = formData.get('stock_min')
  const stock_min =
    stock_min_raw !== null && String(stock_min_raw).trim() !== ''
      ? Number(stock_min_raw)
      : null
  const reference_price = formData.get('reference_price') ? Number(formData.get('reference_price')) : null

  if (!name || !category_id || !section_id) {
    return { error: 'Missing required fields' }
  }

  const { data: priorRow } = await supabase
    .from('products')
    .select('stock_current')
    .eq('id', id)
    .eq('profile_id', activeProfileId)
    .maybeSingle()

  const prevStock = Number(priorRow?.stock_current ?? 0)

  const { data, error } = await supabase
    .from('products')
    .update({
      name,
      category_id,
      section_id,
      stock_current,
      stock_min,
      reference_price,
    })
    .eq('id', id)
    .eq('profile_id', activeProfileId)
    .select()
    .single()

  if (error) {
    console.error('Error updating product:', error)
    return { error: error.message }
  }

  const delta = stock_current - prevStock
  if (delta !== 0) {
    const { error: movErr } = await supabase.from('stock_movements').insert({
      profile_id: activeProfileId,
      product_id: id,
      delta,
      movement_type: 'adjustment',
      note: 'Ajuste manual (edición en inventario)',
      reference_id: null,
      created_by: userData.user.id,
    })
    if (movErr) {
      console.error('stock_movements tras edición de producto:', movErr)
      const { error: revertErr } = await supabase
        .from('products')
        .update({ stock_current: prevStock })
        .eq('id', id)
        .eq('profile_id', activeProfileId)
      if (revertErr) {
        console.error('Revertir stock tras fallo de movimiento (edición):', revertErr)
        return {
          error: `Falló el movimiento de stock y no se pudo restaurar la cantidad anterior: ${revertErr.message} (movimiento: ${movErr.message})`,
        }
      }
      return {
        error: `No se pudo registrar el movimiento de stock; la cantidad volvió al valor anterior. ${movErr.message}`,
      }
    }
  }

  revalidatePath('/inventory')
  revalidatePath('/history')
  return { data }
}

export async function deleteProduct(id: string) {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return { error: 'No active profile' }
  }

  const supabase = await createClient()
  
  const { error } = await supabase
    .from('products')
    .update({ active: false })
    .eq('id', id)
    .eq('profile_id', activeProfileId)

  if (error) {
    console.error('Error deleting product:', error)
    return { error: error.message }
  }

  revalidatePath('/inventory')
  return { success: true }
}

export async function consumeProduct(productId: string, quantity: number) {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return { error: 'No active profile' }
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { error: 'Not authenticated' }
  }

  const qty = Math.max(0, quantity)
  if (qty <= 0) {
    return { error: 'Invalid quantity' }
  }

  const { data: product, error: fetchError } = await supabase
    .from('products')
    .select('id, stock_current')
    .eq('id', productId)
    .eq('profile_id', activeProfileId)
    .eq('active', true)
    .single()

  if (fetchError || !product) {
    return { error: fetchError?.message ?? 'Product not found' }
  }

  const prev = Number(product.stock_current)
  const applied = Math.min(qty, prev)
  const newStock = prev - applied

  const { error: updateError } = await supabase
    .from('products')
    .update({ stock_current: newStock })
    .eq('id', productId)
    .eq('profile_id', activeProfileId)

  if (updateError) {
    return { error: updateError.message }
  }

  const { error: movementError } = await supabase.from('stock_movements').insert({
    profile_id: activeProfileId,
    product_id: productId,
    delta: -applied,
    movement_type: 'consumption',
    note: null,
    reference_id: null,
    created_by: userData.user.id,
  })

  if (movementError) {
    return { error: movementError.message }
  }

  revalidatePath('/consumption')
  revalidatePath('/inventory')
  revalidatePath('/history')
  return { success: true, applied, newStock }
}
