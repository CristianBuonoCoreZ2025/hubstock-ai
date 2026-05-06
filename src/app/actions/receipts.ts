'use server'

import { revalidatePath } from 'next/cache'
import type { Json } from '@/types/database'
import { getProfileContext } from '@/lib/profile/context'
import { assertProfileMembership } from '@/lib/profile/membership'
import { getPublicUploadBucket } from '@/lib/storage-bucket'
import { createClient } from '@/lib/supabase/server'
import { createProductStockZeroForReceiptLine } from '@/app/actions/inventory'

/** Marca en `stock_movements.note` para idempotencia por línea de boleta (Etapa 4). */
const PURCHASE_RECEIPT_ITEM_NOTE_PREFIX = 'purchase_receipt_item:' as const

function purchaseReceiptItemNote(lineId: string) {
  return `${PURCHASE_RECEIPT_ITEM_NOTE_PREFIX}${lineId}`
}

export async function getPurchaseReceipts() {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return { data: [] as const, error: null as string | null }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('purchase_receipts')
    .select('id, store_name, purchased_at, total, status, created_at')
    .eq('profile_id', activeProfileId)
    .order('created_at', { ascending: false })
    .limit(100)

  return { data: data ?? [], error: error?.message ?? null }
}

type ReceiptLine = {
  nameRaw: string
  quantity?: number | null
  unitPrice?: number | null
  lineTotal?: number | null
}

type ReceiptAnalysisShape = {
  storeName?: string | null
  purchasedAt?: string | null
  total?: number | null
  items?: ReceiptLine[]
}

export async function savePurchaseReceiptDraft(
  formData: FormData
): Promise<{ ok: boolean; error?: string; receiptId?: string }> {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return { ok: false, error: 'Sin perfil activo' }
  }

  const supabase = await createClient()
  const gate = await assertProfileMembership(supabase, activeProfileId, {
    minRole: 'editor',
  })
  if (!gate.ok) {
    return { ok: false, error: 'Sin permiso' }
  }

  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { ok: false, error: 'Sesión requerida' }
  }

  let analysis: ReceiptAnalysisShape
  try {
    analysis = JSON.parse(
      String(formData.get('analysis_json') ?? '{}')
    ) as ReceiptAnalysisShape
  } catch {
    return { ok: false, error: 'JSON de análisis inválido' }
  }

  const store_name =
    String(formData.get('store_name') ?? '').trim() ||
    (typeof analysis.storeName === 'string' ? analysis.storeName : null) ||
    null
  const purchased_at_raw = String(formData.get('purchased_at') ?? '').trim()
  const purchased_at =
    purchased_at_raw ||
    (typeof analysis.purchasedAt === 'string' ? analysis.purchasedAt : null) ||
    null
  const total_raw = formData.get('total')
  const total =
    total_raw !== null && String(total_raw).trim() !== ''
      ? Number(total_raw)
      : typeof analysis.total === 'number'
        ? analysis.total
        : null

  const image = formData.get('image')
  let image_storage_path: string | null = null

  if (image instanceof File && image.size > 0) {
    const bucket = getPublicUploadBucket()
    const ext =
      image.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '') || 'jpg'
    const path = `${activeProfileId}/receipts/${crypto.randomUUID()}.${ext}`
    const buffer = Buffer.from(await image.arrayBuffer())
    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(path, buffer, {
        contentType: image.type || 'image/jpeg',
        upsert: false,
      })
    if (!upErr) {
      image_storage_path = path
    }
  }

  const raw_analysis = analysis as unknown as Json

  // Solo borrador: no modifica stock ni inserts en stock_movements hasta confirmar la boleta.

  const { data: receipt, error: rErr } = await supabase
    .from('purchase_receipts')
    .insert({
      profile_id: activeProfileId,
      store_name,
      purchased_at,
      total,
      image_storage_path,
      raw_analysis,
      status: 'pending_review',
      created_by: userData.user.id,
    })
    .select('id')
    .single()

  if (rErr || !receipt) {
    return { ok: false, error: rErr?.message ?? 'No se pudo guardar la boleta' }
  }

  const items = Array.isArray(analysis.items) ? analysis.items : []
  if (items.length > 0) {
    const rows = items.map((it, i) => ({
      receipt_id: receipt.id,
      product_id: null,
      name_raw: it.nameRaw || 'Ítem',
      quantity: it.quantity ?? null,
      unit_price: it.unitPrice ?? null,
      line_total: it.lineTotal ?? null,
      sort_order: i,
    }))
    const { error: iErr } = await supabase
      .from('purchase_receipt_items')
      .insert(rows)
    if (iErr) {
      return { ok: false, error: iErr.message }
    }
  }

  revalidatePath('/receipts')
  return { ok: true, receiptId: receipt.id }
}

export type ReceiptDetailItem = {
  id: string
  name_raw: string
  quantity: number | null
  unit_price: number | null
  line_total: number | null
  product_id: string | null
  sort_order: number
  linked_product_name: string | null
}

export async function getReceiptDetail(receiptId: string) {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return { receipt: null as null, items: [] as ReceiptDetailItem[], error: 'Sin perfil' }
  }

  const supabase = await createClient()
  const { data: receipt, error: rErr } = await supabase
    .from('purchase_receipts')
    .select('id, store_name, purchased_at, total, status, created_at')
    .eq('id', receiptId)
    .eq('profile_id', activeProfileId)
    .maybeSingle()

  if (rErr || !receipt) {
    return { receipt: null, items: [], error: rErr?.message ?? 'Boleta no encontrada' }
  }

  const { data: items, error: iErr } = await supabase
    .from('purchase_receipt_items')
    .select('id, name_raw, quantity, unit_price, line_total, product_id, sort_order')
    .eq('receipt_id', receiptId)
    .order('sort_order', { ascending: true })

  if (iErr) {
    return { receipt, items: [], error: iErr.message }
  }

  const rawItems = items ?? []
  const productIds = [
    ...new Set(
      rawItems
        .map((row) => row.product_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    ),
  ]

  let nameByProductId = new Map<string, string>()
  if (productIds.length > 0) {
    const { data: prods } = await supabase
      .from('products')
      .select('id, name')
      .eq('profile_id', activeProfileId)
      .in('id', productIds)

    nameByProductId = new Map((prods ?? []).map((p) => [p.id, p.name]))
  }

  const mapped: ReceiptDetailItem[] = rawItems.map((row) => ({
    ...row,
    linked_product_name: row.product_id
      ? nameByProductId.get(row.product_id) ?? null
      : null,
  }))

  return {
    receipt,
    items: mapped,
    error: null as string | null,
  }
}

export type CatalogSearchRow = {
  id: string
  name: string
  brand: string | null
  format: string | null
  unit: string | null
}

/** Búsqueda por nombre en catálogo maestro (solo lectura). No usa alias; ver PAGE_LEADS / RECEIPT_HELP. */
export async function searchCatalogProductsForReceipt(
  query: string
): Promise<{ data: CatalogSearchRow[]; error: string | null }> {
  const q = query.trim()
  if (q.length < 2) {
    return { data: [], error: null }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('catalog_products')
    .select('id, name, brand, format, unit')
    .eq('active', true)
    .ilike('name', `%${q}%`)
    .order('name')
    .limit(25)

  return {
    data: (data ?? []) as CatalogSearchRow[],
    error: error?.message ?? null,
  }
}

/**
 * Crea o reutiliza un producto del perfil vinculado al ítem de catálogo y lo asigna a la línea.
 */
export async function linkPurchaseReceiptLineFromCatalog(
  lineId: string,
  catalogProductId: string
): Promise<{ ok: boolean; error?: string; productId?: string }> {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return { ok: false, error: 'Sin perfil' }
  }

  const supabase = await createClient()
  const gate = await assertProfileMembership(supabase, activeProfileId, {
    minRole: 'editor',
  })
  if (!gate.ok) {
    return { ok: false, error: 'Sin permiso' }
  }

  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { ok: false, error: 'Sesión requerida' }
  }

  const { data: line, error: lineErr } = await supabase
    .from('purchase_receipt_items')
    .select('id, receipt_id')
    .eq('id', lineId)
    .maybeSingle()

  if (lineErr || !line) {
    return { ok: false, error: 'Línea no encontrada' }
  }

  const { data: rec } = await supabase
    .from('purchase_receipts')
    .select('id, status')
    .eq('id', line.receipt_id)
    .eq('profile_id', activeProfileId)
    .maybeSingle()

  if (!rec || rec.status !== 'pending_review') {
    return { ok: false, error: 'La boleta no se puede editar' }
  }

  const { data: existing } = await supabase
    .from('products')
    .select('id')
    .eq('profile_id', activeProfileId)
    .eq('catalog_product_id', catalogProductId)
    .maybeSingle()

  let profileProductId: string | null = existing?.id ?? null

  if (!profileProductId) {
    const { data: cp, error: cpErr } = await supabase
      .from('catalog_products')
      .select(
        'id, name, brand, format, unit, section_id, category_id, default_reference_price, brand_id, active'
      )
      .eq('id', catalogProductId)
      .eq('active', true)
      .maybeSingle()

    if (cpErr || !cp) {
      return { ok: false, error: 'Ítem de catálogo no encontrado' }
    }

    let brandLabel = cp.brand
    if (cp.brand_id) {
      const { data: br } = await supabase
        .from('catalog_brands')
        .select('name')
        .eq('id', cp.brand_id)
        .maybeSingle()
      if (br?.name) {
        brandLabel = br.name
      }
    }

    const { data: thumb } = await supabase
      .from('catalog_product_media')
      .select('public_url')
      .eq('catalog_product_id', cp.id)
      .eq('kind', 'thumbnail')
      .limit(1)
      .maybeSingle()

    const { data: inserted, error: insErr } = await supabase
      .from('products')
      .insert({
        profile_id: activeProfileId,
        section_id: cp.section_id,
        category_id: cp.category_id,
        name: cp.name,
        brand: brandLabel,
        format: cp.format,
        unit: cp.unit,
        stock_current: 0,
        stock_min: null,
        stock_ideal: null,
        reference_price: cp.default_reference_price,
        last_price: null,
        location: null,
        image_url: thumb?.public_url ?? null,
        active: true,
        catalog_product_id: cp.id,
        created_by: userData.user.id,
      })
      .select('id')
      .single()

    if (insErr || !inserted) {
      console.error('linkPurchaseReceiptLineFromCatalog insert:', insErr)
      return { ok: false, error: insErr?.message ?? 'No se pudo crear el producto desde catálogo' }
    }

    profileProductId = inserted.id
    revalidatePath('/inventory')
  }

  if (!profileProductId) {
    return { ok: false, error: 'No se pudo obtener el producto del hogar' }
  }

  const linkRes = await setReceiptLineProduct(lineId, profileProductId)
  if (!linkRes.ok) {
    return { ok: false, error: linkRes.error }
  }

  return { ok: true, productId: profileProductId }
}

export async function createAndLinkProductFromReceiptLine(input: {
  lineId: string
  name: string
  categoryId: string
  sectionId: string
  referencePrice: number | null
}): Promise<{ ok: boolean; error?: string; productId?: string }> {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return { ok: false, error: 'Sin perfil' }
  }

  const supabase = await createClient()
  const gate = await assertProfileMembership(supabase, activeProfileId, {
    minRole: 'editor',
  })
  if (!gate.ok) {
    return { ok: false, error: 'Sin permiso' }
  }

  const { data: line, error: lineErr } = await supabase
    .from('purchase_receipt_items')
    .select('id, receipt_id')
    .eq('id', input.lineId)
    .maybeSingle()

  if (lineErr || !line) {
    return { ok: false, error: 'Línea no encontrada' }
  }

  const { data: rec } = await supabase
    .from('purchase_receipts')
    .select('status')
    .eq('id', line.receipt_id)
    .eq('profile_id', activeProfileId)
    .maybeSingle()

  if (!rec || rec.status !== 'pending_review') {
    return { ok: false, error: 'La boleta no se puede editar' }
  }

  const created = await createProductStockZeroForReceiptLine(
    input.name,
    input.categoryId,
    input.sectionId,
    input.referencePrice
  )

  if (created.error || !created.data) {
    return { ok: false, error: created.error ?? 'No se pudo crear el producto' }
  }

  const linkRes = await setReceiptLineProduct(input.lineId, created.data.id)
  if (!linkRes.ok) {
    return { ok: false, error: linkRes.error }
  }

  return { ok: true, productId: created.data.id }
}

export type ProductPickerRow = {
  id: string
  name: string
  brand: string | null
  format: string | null
  unit: string | null
}

export async function listProductsPicker() {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return {
      data: [] as ProductPickerRow[],
      error: null as string | null,
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('products')
    .select('id, name, brand, format, unit')
    .eq('profile_id', activeProfileId)
    .eq('active', true)
    .order('name')
    .limit(2000)

  return { data: (data ?? []) as ProductPickerRow[], error: error?.message ?? null }
}

export async function setReceiptLineProduct(
  lineId: string,
  productId: string | null
): Promise<{ ok: boolean; error?: string }> {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return { ok: false, error: 'Sin perfil' }
  }

  const supabase = await createClient()
  const gate = await assertProfileMembership(supabase, activeProfileId, {
    minRole: 'editor',
  })
  if (!gate.ok) {
    return { ok: false, error: 'Sin permiso' }
  }

  const { data: line, error: lineErr } = await supabase
    .from('purchase_receipt_items')
    .select('id, receipt_id')
    .eq('id', lineId)
    .maybeSingle()

  if (lineErr || !line) {
    return { ok: false, error: 'Línea no encontrada' }
  }

  const { data: rec } = await supabase
    .from('purchase_receipts')
    .select('id, status')
    .eq('id', line.receipt_id)
    .eq('profile_id', activeProfileId)
    .maybeSingle()

  if (!rec || rec.status !== 'pending_review') {
    return { ok: false, error: 'La boleta no se puede editar' }
  }

  if (productId) {
    const { data: prod } = await supabase
      .from('products')
      .select('id')
      .eq('id', productId)
      .eq('profile_id', activeProfileId)
      .maybeSingle()
    if (!prod) {
      return { ok: false, error: 'Producto inválido' }
    }
  }

  const { error: upErr } = await supabase
    .from('purchase_receipt_items')
    .update({ product_id: productId })
    .eq('id', lineId)

  if (upErr) {
    return { ok: false, error: upErr.message }
  }

  revalidatePath('/receipts')
  return { ok: true }
}

export async function confirmPurchaseReceipt(
  receiptId: string
): Promise<{ ok: boolean; error?: string; linesApplied?: number }> {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return { ok: false, error: 'Sin perfil' }
  }

  const supabase = await createClient()
  const gate = await assertProfileMembership(supabase, activeProfileId, {
    minRole: 'editor',
  })
  if (!gate.ok) {
    return { ok: false, error: 'Sin permiso' }
  }

  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { ok: false, error: 'Sesión requerida' }
  }

  const { data: receipt, error: rErr } = await supabase
    .from('purchase_receipts')
    .select('id, status')
    .eq('id', receiptId)
    .eq('profile_id', activeProfileId)
    .maybeSingle()

  if (rErr || !receipt) {
    return { ok: false, error: 'Boleta no encontrada' }
  }
  if (receipt.status !== 'pending_review') {
    return { ok: false, error: 'La boleta ya fue procesada' }
  }

  const { data: lines, error: lErr } = await supabase
    .from('purchase_receipt_items')
    .select('id, product_id, quantity, unit_price')
    .eq('receipt_id', receiptId)

  if (lErr) {
    return { ok: false, error: lErr.message }
  }

  const linesList = lines ?? []
  if (linesList.length === 0) {
    return { ok: false, error: 'Esta boleta no tiene líneas para confirmar' }
  }

  if (linesList.some((l) => l.product_id == null)) {
    return {
      ok: false,
      error:
        'Vincula todas las líneas a un producto del inventario antes de confirmar',
    }
  }

  const toApply = linesList as Array<{
    id: string
    product_id: string
    quantity: number | null
    unit_price: number | null
  }>

  for (const line of toApply) {
    const idemNote = purchaseReceiptItemNote(line.id)

    const { data: existingMove } = await supabase
      .from('stock_movements')
      .select('id')
      .eq('profile_id', activeProfileId)
      .eq('reference_id', receiptId)
      .eq('product_id', line.product_id)
      .eq('movement_type', 'purchase')
      .eq('note', idemNote)
      .maybeSingle()

    if (existingMove) {
      continue
    }

    const qtyRaw = line.quantity
    const qty =
      typeof qtyRaw === 'number' && !Number.isNaN(qtyRaw) && qtyRaw > 0
        ? qtyRaw
        : 1

    const { data: product, error: pErr } = await supabase
      .from('products')
      .select('id, stock_current, last_price')
      .eq('id', line.product_id)
      .eq('profile_id', activeProfileId)
      .eq('active', true)
      .maybeSingle()

    if (pErr || !product) {
      return { ok: false, error: `Producto no válido en línea ${line.id}` }
    }

    const prev = Number(product.stock_current)
    const prevLastPrice = product.last_price
    const nextStock = prev + qty

    const upPayload: {
      stock_current: number
      last_price?: number | null
    } = { stock_current: nextStock }
    if (typeof line.unit_price === 'number' && !Number.isNaN(line.unit_price)) {
      upPayload.last_price = line.unit_price
    }

    const { error: uErr } = await supabase
      .from('products')
      .update(upPayload)
      .eq('id', line.product_id)
      .eq('profile_id', activeProfileId)

    if (uErr) {
      return { ok: false, error: uErr.message }
    }

    const { error: mErr } = await supabase.from('stock_movements').insert({
      profile_id: activeProfileId,
      product_id: line.product_id,
      delta: qty,
      movement_type: 'purchase',
      note: idemNote,
      reference_id: receiptId,
      created_by: userData.user.id,
    })

    if (mErr) {
      console.error('stock_movements tras compra por boleta:', mErr)
      const { error: revErr } = await supabase
        .from('products')
        .update({ stock_current: prev, last_price: prevLastPrice })
        .eq('id', line.product_id)
        .eq('profile_id', activeProfileId)

      if (revErr) {
        console.error('Revertir stock tras fallo de movimiento (boleta):', revErr)
        return {
          ok: false,
          error: `No se registró el movimiento de compra y no se pudo revertir el stock: ${revErr.message} (movimiento: ${mErr.message})`,
        }
      }
      return {
        ok: false,
        error: `No se pudo registrar el movimiento de compra; el stock quedó como antes de esta línea. ${mErr.message}`,
      }
    }
  }

  const { data: statusRows, error: stErr } = await supabase
    .from('purchase_receipts')
    .update({ status: 'confirmed' })
    .eq('id', receiptId)
    .eq('profile_id', activeProfileId)
    .eq('status', 'pending_review')
    .select('id')

  if (stErr) {
    return { ok: false, error: stErr.message }
  }

  if (!statusRows?.length) {
    const { data: recAgain } = await supabase
      .from('purchase_receipts')
      .select('status')
      .eq('id', receiptId)
      .eq('profile_id', activeProfileId)
      .maybeSingle()

    if (recAgain?.status === 'confirmed') {
      revalidatePath('/receipts')
      revalidatePath('/inventory')
      revalidatePath('/history')
      return { ok: true, linesApplied: toApply.length }
    }

    return {
      ok: false,
      error:
        'No se pudo marcar la boleta como confirmada; vuelve a intentar o revisa el estado en el listado.',
    }
  }

  revalidatePath('/receipts')
  revalidatePath('/inventory')
  revalidatePath('/history')
  return { ok: true, linesApplied: toApply.length }
}
