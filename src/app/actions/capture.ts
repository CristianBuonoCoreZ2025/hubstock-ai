'use server'

import {
  createCatalogProductRow,
  ensureCatalogBrandIdForName,
  findExistingCatalogProductId,
  type CatalogProductInput,
} from '@/app/actions/catalog'
import { captureTrace } from '@/lib/capture-trace'
import { revalidatePath } from 'next/cache'
import { getProfileContext } from '@/lib/profile/context'
import { assertProfileMembership } from '@/lib/profile/membership'
import { createClient } from '@/lib/supabase/server'
import { getUserFriendlyErrorMessage } from '@/lib/user-friendly-errors'

export type CaptureProductResult =
  | { ok: true }
  | { ok: false; error: string }

export async function addProductFromCapture(
  formData: FormData
): Promise<CaptureProductResult> {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return { ok: false, error: 'Sin ubicación activa' }
  }

  const supabase = await createClient()
  const gate = await assertProfileMembership(supabase, activeProfileId, {
    minRole: 'editor',
  })
  if (!gate.ok) {
    return { ok: false, error: 'Sin permiso para crear productos' }
  }

  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { ok: false, error: 'Sesión requerida' }
  }

  const name = String(formData.get('name') ?? '').trim()
  const category_id = String(formData.get('category_id') ?? '')
  const section_id = String(formData.get('section_id') ?? '')
  const locationRaw = String(formData.get('location') ?? '').trim()
  const location = locationRaw.length > 0 ? locationRaw : null
  const brandRaw = String(formData.get('brand') ?? '').trim()
  const formatRaw = String(formData.get('format') ?? '').trim()
  const unitRaw = String(formData.get('unit') ?? '').trim()
  const stock_current = Number(formData.get('stock_current') || 0)
  const stock_min_raw = formData.get('stock_min')
  const stock_min =
    stock_min_raw !== null && String(stock_min_raw).trim() !== ''
      ? Number(stock_min_raw)
      : null
  const reference_price = formData.get('reference_price')
    ? Number(formData.get('reference_price'))
    : null

  if (!name || !category_id || !section_id) {
    return { ok: false, error: 'Faltan nombre, categoría de catálogo o sección' }
  }

  const image = formData.get('image')

  /**
   * Política: no subir la foto completa de la escena. Solo tendría sentido un recorte por producto
   * (cuando la IA o el usuario definan bbox por ítem). Si llega archivo, se registra en traza y se omite.
   */
  if (image instanceof File && image.size > 0) {
    console.info('[capture] server: archivo en FormData ignorado (política sin escena completa)', {
      size: image.size,
      type: image.type || null,
    })
    captureTrace('server_save_image_ignored', {
      reason: 'full_scene_policy',
      reportedSize: image.size,
      reportedType: image.type || null,
    })
  }

  const existingCatalogId = await findExistingCatalogProductId({
    category_id,
    name,
  })

  let catalog_product_id: string

  if (existingCatalogId) {
    catalog_product_id = existingCatalogId
  } else {
    const brandEnsure = await ensureCatalogBrandIdForName(brandRaw)
    if (!brandEnsure.ok) {
      return { ok: false, error: brandEnsure.error }
    }

    const catalogInput: CatalogProductInput = {
      name,
      section_id,
      category_id,
      brand_id: brandEnsure.brand_id,
      brand: brandRaw.length > 0 ? brandRaw : null,
      format: formatRaw.length > 0 ? formatRaw : null,
      unit: unitRaw.length > 0 ? unitRaw : null,
      default_reference_price: reference_price,
      active: true,
    }

    const catalogCreated = await createCatalogProductRow(catalogInput)
    if (!catalogCreated.ok) {
      return { ok: false, error: catalogCreated.error }
    }
    catalog_product_id = catalogCreated.id
  }

  const { data: existingInv } = await supabase
    .from('products')
    .select('id, stock_current')
    .eq('profile_id', activeProfileId)
    .eq('catalog_product_id', catalog_product_id)
    .maybeSingle()

  if (existingInv) {
    const addQty = Math.max(0, Math.round(Number(stock_current) || 0))
    const prev = Number(existingInv.stock_current)
    const nextStock = prev + addQty

    const { error: upErr } = await supabase
      .from('products')
      .update({
        stock_current: nextStock,
        ...(location != null ? { location } : {}),
      })
      .eq('id', existingInv.id)
      .eq('profile_id', activeProfileId)

    if (upErr) {
      return {
        ok: false,
        error: getUserFriendlyErrorMessage(upErr, 'product'),
      }
    }

    if (addQty > 0) {
      const { error: movErr } = await supabase.from('stock_movements').insert({
        profile_id: activeProfileId,
        product_id: existingInv.id,
        delta: addQty,
        movement_type: 'import',
        note: 'Carga por fotos (captura) — suma a inventario existente',
        reference_id: null,
        created_by: userData.user.id,
      })
      if (movErr) {
        const { error: revertErr } = await supabase
          .from('products')
          .update({ stock_current: prev })
          .eq('id', existingInv.id)
          .eq('profile_id', activeProfileId)
        if (revertErr) {
          console.error('Revertir stock tras fallo de movimiento (captura, merge):', revertErr)
          return {
            ok: false,
            error:
              'No se registró el movimiento de stock; no se pudo revertir el inventario. Intenta de nuevo.',
          }
        }
        return {
          ok: false,
          error: getUserFriendlyErrorMessage(movErr, 'generic'),
        }
      }
    }
  } else {
    const { data: product, error: insErr } = await supabase
      .from('products')
      .insert({
        profile_id: activeProfileId,
        name,
        category_id,
        section_id,
        location,
        brand: brandRaw.length > 0 ? brandRaw : null,
        format: formatRaw.length > 0 ? formatRaw : null,
        unit: unitRaw.length > 0 ? unitRaw : null,
        stock_current,
        stock_min,
        reference_price,
        catalog_product_id,
        image_url: null,
        created_by: userData.user.id,
        active: true,
      })
      .select('id')
      .single()

    if (insErr || !product) {
      return {
        ok: false,
        error: getUserFriendlyErrorMessage(insErr, 'product'),
      }
    }

    if (stock_current > 0) {
      const { error: movErr } = await supabase.from('stock_movements').insert({
        profile_id: activeProfileId,
        product_id: product.id,
        delta: stock_current,
        movement_type: 'import',
        note: 'Carga por fotos (captura)',
        reference_id: null,
        created_by: userData.user.id,
      })
      if (movErr) {
        const { error: revertErr } = await supabase
          .from('products')
          .update({ stock_current: 0 })
          .eq('id', product.id)
          .eq('profile_id', activeProfileId)
        if (revertErr) {
          console.error('Revertir stock tras fallo de movimiento (captura):', revertErr)
          return {
            ok: false,
            error:
              'No se registró el movimiento de stock y no se pudo revertir el inventario. Intenta de nuevo.',
          }
        }
        return {
          ok: false,
          error: getUserFriendlyErrorMessage(movErr, 'generic'),
        }
      }
    }
  }

  revalidatePath('/catalog')
  revalidatePath('/inventory')
  revalidatePath('/capture')
  revalidatePath('/history')
  return { ok: true }
}
