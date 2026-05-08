'use server'

import { revalidatePath } from 'next/cache'
import type { Json } from '@/types/database'
import { getProfileContext } from '@/lib/profile/context'
import { assertProfileMembership } from '@/lib/profile/membership'
import { getPublicUploadBucket } from '@/lib/storage-bucket'
import { createClient } from '@/lib/supabase/server'

/** Marca en `stock_movements.note` para idempotencia por línea de boleta (Etapa 4). */
const PURCHASE_RECEIPT_ITEM_NOTE_PREFIX = 'purchase_receipt_item:' as const

function purchaseReceiptItemNote(lineId: string) {
  return `${PURCHASE_RECEIPT_ITEM_NOTE_PREFIX}${lineId}`
}

/** Cantidad válida para persistir; la BD puede exigir NOT NULL aunque el análisis omita cantidad. */
function receiptLineQuantity(value: unknown): number {
  const n =
    typeof value === 'number' ? value : value != null && value !== '' ? Number(value) : NaN
  if (Number.isFinite(n) && n > 0) return n
  return 1
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
      profile_id: activeProfileId,
      product_id: null,
      name_raw: it.nameRaw || 'Ítem',
      quantity: receiptLineQuantity(it.quantity),
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

  return {
    receipt,
    items: (items ?? []) as ReceiptDetailItem[],
    error: iErr?.message ?? null,
  }
}

export type ProductPickerRow = {
  id: string
  name: string
  brand: string | null
  format: string | null
  unit: string | null
  /** Último precio registrado en inventario; ayuda a sugerir emparejos con la boleta. */
  last_price: number | null
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
    .select('id, name, brand, format, unit, last_price')
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
    .not('product_id', 'is', null)

  if (lErr) {
    return { ok: false, error: lErr.message }
  }

  const toApply = (lines ?? []).filter(
    (row): row is typeof row & { product_id: string } =>
      typeof row.product_id === 'string'
  )

  if (toApply.length === 0) {
    return { ok: false, error: 'Empareja al menos una línea con un producto' }
  }

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
