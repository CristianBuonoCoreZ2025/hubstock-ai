'use server'

import { createClient } from '@/lib/supabase/server'
import { getProfileContext } from '@/lib/profile/context'
import { revalidatePath } from 'next/cache'
import { getUserFriendlyErrorMessage } from '@/lib/user-friendly-errors'
import { createCatalogProductRow, type CatalogProductInput } from '@/app/actions/catalog'

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
    return { error: 'Necesitas un perfil activo para agregar productos al inventario.' }
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { error: 'No tienes sesión activa.' }
  }

  const catalog_product_id_raw = formData.get('catalog_product_id')
  const catalog_product_id =
    catalog_product_id_raw !== null && String(catalog_product_id_raw).trim() !== ''
      ? String(catalog_product_id_raw)
      : null
  const category_id = formData.get('category_id') as string
  const section_id = formData.get('section_id') as string
  const stock_current = Number(formData.get('stock_current') || 0)
  const stock_min_raw = formData.get('stock_min')
  const stock_min =
    stock_min_raw !== null && String(stock_min_raw).trim() !== ''
      ? Number(stock_min_raw)
      : null
  const reference_price = formData.get('reference_price') ? Number(formData.get('reference_price')) : null

  if (!category_id || !section_id) {
    return { error: 'Completa los campos obligatorios antes de guardar.' }
  }

  if (!catalog_product_id) {
    return {
      error:
        'Selecciona un producto del catálogo. El inventario solo registra productos que ya existen en el catálogo global.',
    }
  }

  const { data: cp, error: cpErr } = await supabase
    .from('catalog_products')
    .select('name')
    .eq('id', catalog_product_id)
    .maybeSingle()
  if (cpErr) return { error: getUserFriendlyErrorMessage(cpErr, 'generic') }
  if (!cp?.name) {
    return { error: 'No se encontró ese producto en el catálogo.' }
  }
  const finalName = cp.name

  const { data, error } = await supabase
    .from('products')
    .insert({
      profile_id: activeProfileId,
      name: finalName,
      category_id,
      section_id,
      stock_current,
      stock_min,
      reference_price,
      catalog_product_id,
      created_by: userData.user.id,
      active: true
    })
    .select()
    .single()

  if (error) {
    console.error('Error adding product:', error)
    return { error: getUserFriendlyErrorMessage(error, 'product') }
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
          error: 'No se pudo completar la acción. Intenta nuevamente.',
        }
      }
      return {
        error: 'No se pudo completar la acción. Intenta nuevamente.',
      }
    }
  }

  revalidatePath('/inventory')
  revalidatePath('/history')
  return { data }
}

/**
 * Crea primero el producto maestro en el catálogo global y luego el ítem en el inventario del perfil.
 * Un solo nombre estándar; requiere los mismos permisos que crear en catálogo (editor en el perfil).
 */
export async function addProductCreatingCatalogMaster(formData: FormData) {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return { error: 'Necesitas un perfil activo para agregar productos al inventario.' }
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { error: 'No tienes sesión activa.' }
  }

  const standardNameRaw = formData.get('standard_name')
  const standardName =
    standardNameRaw !== null && String(standardNameRaw).trim() !== ''
      ? String(standardNameRaw).trim()
      : ''

  const category_id = formData.get('category_id') as string
  const section_id = formData.get('section_id') as string
  const stock_current = Number(formData.get('stock_current') || 0)
  const stock_min_raw = formData.get('stock_min')
  const stock_min =
    stock_min_raw !== null && String(stock_min_raw).trim() !== ''
      ? Number(stock_min_raw)
      : null
  const reference_price = formData.get('reference_price') ? Number(formData.get('reference_price')) : null

  if (!category_id || !section_id) {
    return { error: 'Completa los campos obligatorios antes de guardar.' }
  }

  if (!standardName) {
    return { error: 'Escribe el nombre estándar del producto para crearlo en el catálogo y en el inventario.' }
  }

  const catalogInput: CatalogProductInput = {
    name: standardName,
    section_id,
    category_id,
    brand_id: null,
    brand: null,
    format: null,
    unit: null,
    default_reference_price: reference_price,
    active: true,
  }

  const created = await createCatalogProductRow(catalogInput)
  if (!created.ok) {
    return { error: created.error }
  }

  const catalog_product_id = created.id

  const { data, error } = await supabase
    .from('products')
    .insert({
      profile_id: activeProfileId,
      name: standardName,
      category_id,
      section_id,
      stock_current,
      stock_min,
      reference_price,
      catalog_product_id,
      created_by: userData.user.id,
      active: true,
    })
    .select()
    .single()

  if (error) {
    console.error('Error adding product after catalog create:', error)
    return { error: getUserFriendlyErrorMessage(error, 'product') }
  }

  if (data && stock_current > 0) {
    const { error: movErr } = await supabase.from('stock_movements').insert({
      profile_id: activeProfileId,
      product_id: data.id,
      delta: stock_current,
      movement_type: 'import',
      note: 'Alta manual (inventario, producto nuevo en catálogo)',
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
        return {
          error: 'No se pudo completar la acción. Intenta nuevamente.',
        }
      }
      return {
        error: 'No se pudo completar la acción. Intenta nuevamente.',
      }
    }
  }

  revalidatePath('/catalog')
  revalidatePath('/inventory')
  revalidatePath('/history')
  return { data }
}

export async function updateProduct(id: string, formData: FormData) {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return { error: 'Necesitas un perfil activo para editar productos.' }
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { error: 'No tienes sesión activa.' }
  }

  const catalog_product_id_raw = formData.get('catalog_product_id')
  const catalog_product_id_from_form =
    catalog_product_id_raw !== null && String(catalog_product_id_raw).trim() !== ''
      ? String(catalog_product_id_raw)
      : null
  const category_id = formData.get('category_id') as string
  const section_id = formData.get('section_id') as string
  const stock_current = Number(formData.get('stock_current') || 0)
  const stock_min_raw = formData.get('stock_min')
  const stock_min =
    stock_min_raw !== null && String(stock_min_raw).trim() !== ''
      ? Number(stock_min_raw)
      : null
  const reference_price = formData.get('reference_price') ? Number(formData.get('reference_price')) : null

  if (!category_id || !section_id) {
    return { error: 'Completa los campos obligatorios antes de guardar.' }
  }

  const { data: priorRow } = await supabase
    .from('products')
    .select('stock_current, catalog_product_id')
    .eq('id', id)
    .eq('profile_id', activeProfileId)
    .maybeSingle()

  const prevStock = Number(priorRow?.stock_current ?? 0)
  const priorCatalogId = priorRow?.catalog_product_id ?? null

  // No se permite inventar nombre: el vínculo al catálogo define el producto.
  const effectiveCatalogId = priorCatalogId ?? catalog_product_id_from_form
  if (!effectiveCatalogId) {
    return {
      error:
        'Selecciona un producto del catálogo. Si este ítem es antiguo sin vínculo, elige el producto maestro correcto para continuar.',
    }
  }

  const { data: cp, error: cpErr } = await supabase
    .from('catalog_products')
    .select('name')
    .eq('id', effectiveCatalogId)
    .maybeSingle()
  if (cpErr) return { error: getUserFriendlyErrorMessage(cpErr, 'generic') }
  if (!cp?.name) {
    return { error: 'No se encontró ese producto en el catálogo.' }
  }
  const finalName = cp.name

  const { data, error } = await supabase
    .from('products')
    .update({
      name: finalName,
      category_id,
      section_id,
      stock_current,
      stock_min,
      reference_price,
      catalog_product_id: effectiveCatalogId,
    })
    .eq('id', id)
    .eq('profile_id', activeProfileId)
    .select()
    .single()

  if (error) {
    console.error('Error updating product:', error)
    return { error: getUserFriendlyErrorMessage(error, 'product') }
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
          error: 'No se pudo completar la acción. Intenta nuevamente.',
        }
      }
      return {
        error: 'No se pudo completar la acción. Intenta nuevamente.',
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
    return { error: 'Necesitas un perfil activo para desactivar productos.' }
  }

  const supabase = await createClient()
  
  const { error } = await supabase
    .from('products')
    .update({ active: false })
    .eq('id', id)
    .eq('profile_id', activeProfileId)

  if (error) {
    console.error('Error deleting product:', error)
    return { error: getUserFriendlyErrorMessage(error, 'product') }
  }

  revalidatePath('/inventory')
  return { success: true }
}

export async function consumeProduct(productId: string, quantity: number) {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return { error: 'Necesitas un perfil activo para descontar stock.' }
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { error: 'No tienes sesión activa.' }
  }

  const qty = Math.max(0, quantity)
  if (qty <= 0) {
    return { error: 'Ingresa una cantidad válida.' }
  }

  const { data: product, error: fetchError } = await supabase
    .from('products')
    .select('id, stock_current')
    .eq('id', productId)
    .eq('profile_id', activeProfileId)
    .eq('active', true)
    .single()

  if (fetchError || !product) {
    return { error: 'No se encontró el producto en este perfil.' }
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
    return { error: getUserFriendlyErrorMessage(updateError, 'product') }
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
    return { error: getUserFriendlyErrorMessage(movementError, 'generic') }
  }

  revalidatePath('/consumption')
  revalidatePath('/inventory')
  revalidatePath('/history')
  return { success: true, applied, newStock }
}
