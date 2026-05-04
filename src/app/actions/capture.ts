'use server'

import { revalidatePath } from 'next/cache'
import { getProfileContext } from '@/lib/profile/context'
import { assertProfileMembership } from '@/lib/profile/membership'
import { getPublicUploadBucket } from '@/lib/storage-bucket'
import { createClient } from '@/lib/supabase/server'

export type CaptureProductResult =
  | { ok: true }
  | { ok: false; error: string }

export async function addProductFromCapture(
  formData: FormData
): Promise<CaptureProductResult> {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return { ok: false, error: 'Sin perfil activo' }
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
    return { ok: false, error: 'Faltan nombre, categoría o sección' }
  }

  const image = formData.get('image')
  let image_url: string | null = null
  let storage_path: string | null = null

  if (image instanceof File && image.size > 0) {
    const bucket = getPublicUploadBucket()
    const ext =
      image.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '') || 'jpg'
    const path = `${activeProfileId}/products/${crypto.randomUUID()}.${ext}`
    const buffer = Buffer.from(await image.arrayBuffer())
    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(path, buffer, {
        contentType: image.type || 'image/jpeg',
        upsert: false,
      })
    if (!upErr) {
      storage_path = path
      const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path)
      image_url = pub.publicUrl
    }
  }

  const { data: product, error: insErr } = await supabase
    .from('products')
    .insert({
      profile_id: activeProfileId,
      name,
      category_id,
      section_id,
      brand: brandRaw.length > 0 ? brandRaw : null,
      format: formatRaw.length > 0 ? formatRaw : null,
      unit: unitRaw.length > 0 ? unitRaw : null,
      stock_current,
      stock_min,
      reference_price,
      image_url,
      created_by: userData.user.id,
      active: true,
    })
    .select('id')
    .single()

  if (insErr || !product) {
    return { ok: false, error: insErr?.message ?? 'No se pudo crear el producto' }
  }

  if (storage_path) {
    await supabase.from('product_images').insert({
      profile_id: activeProfileId,
      product_id: product.id,
      storage_path,
      sort_order: 0,
      created_by: userData.user.id,
    })
  }

  revalidatePath('/inventory')
  revalidatePath('/capture')
  return { ok: true }
}
