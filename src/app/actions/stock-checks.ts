'use server'

import { revalidatePath } from 'next/cache'
import { getActionContext, getActionContextWithGate } from '@/lib/action-context'
import { getPublicUploadBucket } from '@/lib/storage-bucket'
import { createClient } from '@/lib/supabase/server'
import { getUserFriendlyErrorMessage } from '@/lib/user-friendly-errors'
import type { Json, StockCheckStatus } from '@/types/database'
import type { StockCheckAiMeta } from '@/types/stock-check-ai-meta'
import type { VisionAnalysisMeta } from '@/types/vision-meta'

/** Mensaje más claro cuando falla RLS en Supabase */
function explainStockChecksRls(message: string | undefined): string {
  if (!message) return 'Error al guardar'
  if (/row-level security/i.test(message)) {
    return 'Política de seguridad (RLS): solo editores o administradores del hogar pueden crear chequeos; el rol “viewer” no. Si ya tienes rol editor, en Supabase ejecuta la migración `20260502100000_fix_stock_checks_insert_rls`.'
  }
  return message
}

/** Líneas editables si el chequeo aún no se cerró aplicando al inventario. */
function stockCheckAllowsLineEdits(status: string): boolean {
  return status !== 'completed'
}

const ALLOWED_ZONES = new Set([
  'alacena',
  'refrigerador',
  'congelador',
  'bano',
  'bodega',
  'otro',
])

export async function getStockChecksList() {
  const ctx = await getActionContext()
  if (!ctx.ok) {
    return { data: [] as const, error: null as string | null }
  }
  const { supabase, activeProfileId } = ctx
  const { data, error } = await supabase
    .from('stock_checks')
    .select('id, zone, status, created_at, ai_meta')
    .eq('profile_id', activeProfileId)
    .order('created_at', { ascending: false })
    .limit(100)

  return { data: data ?? [], error: error?.message ?? null }
}

type DetectedItem = {
  nameGuess?: string
  brandGuess?: string | null
  productType?: string | null
  presentation?: string | null
  netQuantity?: number | null
  netUnit?: string | null
  quantityGuess?: number | null
  confidence?: number | null
  notes?: string | null
}

/** El modelo a veces devuelve snake_case; unifica antes de persistir en Postgres. */
function pickOptionalString(
  record: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const k of keys) {
    const v = record[k]
    if (typeof v === 'string') {
      const t = v.trim()
      if (t.length > 0) return t
    }
  }
  return null
}

function pickOptionalNumber(
  record: Record<string, unknown>,
  keys: string[]
): number | null {
  for (const k of keys) {
    const v = record[k]
    if (typeof v === 'number' && !Number.isNaN(v)) return v
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(String(v).trim().replace(',', '.'))
      if (!Number.isNaN(n)) return n
    }
  }
  return null
}

/** Fila `stock_check_detected_items` desde un elemento de `analysis.detected[]`. */
function mapDetectedRawToInsertRow(
  raw: unknown,
  stockCheckId: string
): Record<string, unknown> {
  const d =
    raw && typeof raw === 'object'
      ? (raw as Record<string, unknown>)
      : {}

  const name =
    pickOptionalString(d, ['nameGuess', 'name_guess']) ?? 'Producto'

  return {
    stock_check_id: stockCheckId,
    product_id: null,
    name_guess: name,
    brand_guess: pickOptionalString(d, ['brandGuess', 'brand_guess']),
    product_type_guess: pickOptionalString(d, [
      'productType',
      'product_type',
    ]),
    presentation_guess: pickOptionalString(d, [
      'presentation',
      'presentation_guess',
      'presentationGuess',
    ]),
    net_quantity: pickOptionalNumber(d, ['netQuantity', 'net_quantity']),
    net_unit: pickOptionalString(d, ['netUnit', 'net_unit']),
    notes: pickOptionalString(d, ['notes']),
    quantity_guess: pickOptionalNumber(d, [
      'quantityGuess',
      'quantity_guess',
    ]),
    confidence: pickOptionalNumber(d, ['confidence']),
    marked_invalid: false,
    accepted: null,
  }
}

type StockCheckAnalysisShape = {
  detected?: DetectedItem[]
}

function buildStockCheckAiMeta(
  vision: VisionAnalysisMeta | null,
  analysis: StockCheckAnalysisShape
): Json | null {
  if (!vision) return null
  const detected = Array.isArray(analysis.detected) ? analysis.detected : []
  const confs = detected
    .map((raw) => {
      const d =
        raw && typeof raw === 'object'
          ? (raw as Record<string, unknown>)
          : {}
      return pickOptionalNumber(d, ['confidence'])
    })
    .filter((c): c is number => c != null && !Number.isNaN(c))
  const detectedCount = detected.length
  const confidenceAvg =
    confs.length > 0
      ? confs.reduce((a, b) => a + b, 0) / confs.length
      : null
  const confidenceMin = confs.length > 0 ? Math.min(...confs) : null
  const confidenceCoverage =
    detectedCount > 0 ? confs.length / detectedCount : null

  const meta: StockCheckAiMeta = {
    vision,
    confidenceAvg,
    confidenceMin,
    detectedCount,
    confidenceCoverage,
  }
  return meta as unknown as Json
}

export async function saveStockCheckFromAnalysis(
  formData: FormData
): Promise<{ ok: boolean; error?: string; checkId?: string }> {
  const ctx = await getActionContextWithGate('editor')
  if (!ctx.ok) {
    return { ok: false, error: ctx.error }
  }
  const { supabase, activeProfileId } = ctx

  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { ok: false, error: 'Sesión requerida' }
  }

  const zone = String(formData.get('zone') ?? '').trim()
  if (!ALLOWED_ZONES.has(zone)) {
    return { ok: false, error: 'Zona inválida' }
  }

  let analysis: StockCheckAnalysisShape
  try {
    analysis = JSON.parse(
      String(formData.get('analysis_json') ?? '{}')
    ) as StockCheckAnalysisShape
  } catch {
    return { ok: false, error: 'JSON de análisis inválido' }
  }

  let visionPayload: VisionAnalysisMeta | null = null
  try {
    const rawVision = String(formData.get('vision_json') ?? '').trim()
    if (rawVision.length > 0) {
      const parsed = JSON.parse(rawVision) as unknown
      if (
        parsed &&
        typeof parsed === 'object' &&
        'provider' in parsed &&
        'model' in parsed &&
        'providerLabel' in parsed
      ) {
        visionPayload = parsed as VisionAnalysisMeta
      }
    }
  } catch {
    return { ok: false, error: 'JSON de metadatos de IA inválido' }
  }

  const aiMeta = buildStockCheckAiMeta(visionPayload, analysis)

  const { data: checkRow, error: cErr } = await supabase
    .from('stock_checks')
    .insert({
      profile_id: activeProfileId,
      zone,
      status: 'awaiting_confirmation',
      created_by: userData.user.id,
      ai_meta: aiMeta,
    })
    .select('id')
    .single()

  if (cErr || !checkRow) {
    return {
      ok: false,
      error: explainStockChecksRls(cErr?.message) ?? 'No se pudo crear el chequeo',
    }
  }

  const image = formData.get('image')
  if (image instanceof File && image.size > 0) {
    const bucket = getPublicUploadBucket()
    const ext =
      image.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '') || 'jpg'
    const path = `${activeProfileId}/stock-checks/${checkRow.id}/${crypto.randomUUID()}.${ext}`
    const buffer = Buffer.from(await image.arrayBuffer())
    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(path, buffer, {
        contentType: image.type || 'image/jpeg',
        upsert: false,
      })
    if (!upErr) {
      const { error: phErr } = await supabase.from('stock_check_photos').insert({
        stock_check_id: checkRow.id,
        storage_path: path,
        sort_order: 0,
      })
      if (phErr) {
        return { ok: false, error: explainStockChecksRls(phErr.message) }
      }
    }
  }

  const detected = Array.isArray(analysis.detected) ? analysis.detected : []
  if (detected.length > 0) {
    const rows = detected.map((raw) =>
      mapDetectedRawToInsertRow(raw, checkRow.id)
    )
    const { error: dErr } = await supabase
      .from('stock_check_detected_items')
      .insert(rows)
    if (dErr) {
      return { ok: false, error: explainStockChecksRls(dErr.message) }
    }
  }

  revalidatePath('/stock-checks')
  return { ok: true, checkId: checkRow.id }
}

export type StockCheckDetailItem = {
  id: string
  name_guess: string
  brand_guess: string | null
  product_type_guess: string | null
  presentation_guess: string | null
  net_quantity: number | null
  net_unit: string | null
  notes: string | null
  quantity_guess: number | null
  confidence: number | null
  product_id: string | null
  accepted: boolean | null
  marked_invalid?: boolean
}

export type ProfileBrandRow = { id: string; name: string }

export async function listProfileBrands(): Promise<{
  data: ProfileBrandRow[]
  error: string | null
}> {
  const ctx = await getActionContext()
  if (!ctx.ok) {
    return { data: [], error: null }
  }
  const { supabase, activeProfileId } = ctx
  const { data, error } = await supabase
    .from('profile_brands')
    .select('id, name')
    .eq('profile_id', activeProfileId)
    .order('name', { ascending: true })
    .limit(500)

  return {
    data: (data ?? []) as ProfileBrandRow[],
    error: error?.message ?? null,
  }
}

/** Guarda marca para autocompletado (ignora duplicados exactos). */
export async function saveProfileBrand(
  name: string
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = name.trim()
  if (trimmed.length < 1) {
    return { ok: false, error: 'Nombre vacío' }
  }

  const ctx = await getActionContextWithGate('editor')
  if (!ctx.ok) {
    return { ok: false, error: ctx.error }
  }
  const { supabase, activeProfileId } = ctx

  const { error } = await supabase.from('profile_brands').insert({
    profile_id: activeProfileId,
    name: trimmed,
  })

  if (error) {
    if (/duplicate key|unique constraint/i.test(error.message)) {
      return { ok: true }
    }
    console.error('saveProfileBrand: falló inserción:', error)
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'brand') }
  }

  revalidatePath('/stock-checks')
  return { ok: true }
}

export type ProfileCatalogRow = { id: string; name: string }

export type MeasureUnitRow = {
  id: string
  code: string
  label: string
  sort_order: number
}

export type NetContentOptionRow = {
  id: string
  label: string
  net_quantity: number
  unit_code: string
  sort_order: number
}

/** Si la tabla no existe en la BD remota, devuelve lista vacía y mensaje orientativo. */
function softCatalogRead<T>(
  data: T[] | null,
  error: { message: string } | null
): { data: T[]; error: string | null } {
  if (!error) return { data: data ?? [], error: null }
  const missingTable =
    /does not exist|schema cache|relation/i.test(error.message)
  return {
    data: [],
    error: missingTable
      ? 'Faltan tablas de catálogo (migración stock_scan_dropdown_catalogs). La página sigue funcionando con texto libre donde aplique.'
      : error.message,
  }
}

export async function listMeasureUnits(): Promise<{
  data: MeasureUnitRow[]
  error: string | null
}> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('stock_measure_units')
    .select('id, code, label, sort_order')
    .order('sort_order', { ascending: true })
    .limit(200)

  return softCatalogRead((data ?? []) as MeasureUnitRow[], error)
}

export async function listNetContentOptions(): Promise<{
  data: NetContentOptionRow[]
  error: string | null
}> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('stock_net_content_options')
    .select('id, label, net_quantity, unit_code, sort_order')
    .order('sort_order', { ascending: true })
    .limit(200)

  return softCatalogRead((data ?? []) as NetContentOptionRow[], error)
}

export async function listProfileProductTypes(): Promise<{
  data: ProfileCatalogRow[]
  error: string | null
}> {
  const ctx = await getActionContext()
  if (!ctx.ok) {
    return { data: [], error: null }
  }
  const { supabase, activeProfileId } = ctx
  const { data, error } = await supabase
    .from('profile_product_types')
    .select('id, name')
    .eq('profile_id', activeProfileId)
    .order('name', { ascending: true })
    .limit(500)

  return softCatalogRead((data ?? []) as ProfileCatalogRow[], error)
}

export async function listProfilePresentations(): Promise<{
  data: ProfileCatalogRow[]
  error: string | null
}> {
  const ctx = await getActionContext()
  if (!ctx.ok) {
    return { data: [], error: null }
  }
  const { supabase, activeProfileId } = ctx
  const { data, error } = await supabase
    .from('profile_presentations')
    .select('id, name')
    .eq('profile_id', activeProfileId)
    .order('name', { ascending: true })
    .limit(500)

  return softCatalogRead((data ?? []) as ProfileCatalogRow[], error)
}

export async function saveProfileProductType(
  name: string
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = name.trim()
  if (trimmed.length < 1) {
    return { ok: false, error: 'Nombre vacío' }
  }

  const ctx = await getActionContextWithGate('editor')
  if (!ctx.ok) {
    return { ok: false, error: ctx.error }
  }
  const { supabase, activeProfileId } = ctx

  const { error } = await supabase.from('profile_product_types').insert({
    profile_id: activeProfileId,
    name: trimmed,
  })

  if (error) {
    if (/duplicate key|unique constraint/i.test(error.message)) {
      return { ok: true }
    }
    console.error('saveProfileProductType: falló inserción:', error)
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  }

  revalidatePath('/stock-checks')
  return { ok: true }
}

export async function saveProfilePresentation(
  name: string
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = name.trim()
  if (trimmed.length < 1) {
    return { ok: false, error: 'Nombre vacío' }
  }

  const ctx = await getActionContextWithGate('editor')
  if (!ctx.ok) {
    return { ok: false, error: ctx.error }
  }
  const { supabase, activeProfileId } = ctx

  const { error } = await supabase.from('profile_presentations').insert({
    profile_id: activeProfileId,
    name: trimmed,
  })

  if (error) {
    if (/duplicate key|unique constraint/i.test(error.message)) {
      return { ok: true }
    }
    console.error('saveProfilePresentation: falló inserción:', error)
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  }

  revalidatePath('/stock-checks')
  return { ok: true }
}

export type StockCheckDetailHeader = {
  id: string
  zone: string
  status: StockCheckStatus
  created_at: string
  ai_meta: Json | null
}

export async function getStockCheckDetail(checkId: string) {
  const ctx = await getActionContext()
  if (!ctx.ok) {
    return {
      check: null as StockCheckDetailHeader | null,
      items: [] as StockCheckDetailItem[],
      error: 'Sin perfil',
    }
  }
  const { supabase, activeProfileId } = ctx
  const { data: check, error: cErr } = await supabase
    .from('stock_checks')
    .select('id, zone, status, created_at, ai_meta')
    .eq('id', checkId)
    .eq('profile_id', activeProfileId)
    .maybeSingle()

  if (cErr || !check) {
    return {
      check: null,
      items: [],
      error: cErr?.message ?? 'Chequeo no encontrado',
    }
  }

  const { data: items, error: iErr } = await supabase
    .from('stock_check_detected_items')
    .select(
      'id, name_guess, brand_guess, product_type_guess, presentation_guess, net_quantity, net_unit, notes, quantity_guess, confidence, product_id, accepted, marked_invalid'
    )
    .eq('stock_check_id', checkId)
    .order('created_at', { ascending: true })

  return {
    check: check as StockCheckDetailHeader,
    items: (items ?? []) as StockCheckDetailItem[],
    error: iErr?.message ?? null,
  }
}

export type UpdateStockCheckDetectedInput = {
  productId?: string | null
  accepted?: boolean | null
  quantityGuess?: number | null
  nameGuess?: string
  brandGuess?: string | null
  productTypeGuess?: string | null
  presentationGuess?: string | null
  netQuantity?: number | null
  netUnit?: string | null
  notes?: string | null
  markedInvalid?: boolean
}

export async function updateStockCheckDetectedItem(
  itemId: string,
  input: UpdateStockCheckDetectedInput
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getActionContextWithGate('editor')
  if (!ctx.ok) {
    return { ok: false, error: ctx.error }
  }
  const { supabase, activeProfileId } = ctx

  const { data: row, error: rowErr } = await supabase
    .from('stock_check_detected_items')
    .select('id, stock_check_id')
    .eq('id', itemId)
    .maybeSingle()

  if (rowErr || !row) {
    return { ok: false, error: 'Ítem no encontrado' }
  }

  const { data: chk } = await supabase
    .from('stock_checks')
    .select('id, status')
    .eq('id', row.stock_check_id)
    .eq('profile_id', activeProfileId)
    .maybeSingle()

  if (!chk || !stockCheckAllowsLineEdits(chk.status)) {
    return {
      ok: false,
      error:
        chk?.status === 'completed'
          ? 'Este chequeo ya se aplicó al inventario; no se pueden editar líneas.'
          : 'Chequeo no encontrado',
    }
  }

  if (input.productId) {
    const { data: prod } = await supabase
      .from('products')
      .select('id')
      .eq('id', input.productId)
      .eq('profile_id', activeProfileId)
      .maybeSingle()
    if (!prod) {
      return { ok: false, error: 'Producto inválido' }
    }
  }

  const patch: Record<string, unknown> = {}
  if (input.productId !== undefined) patch.product_id = input.productId
  if (input.accepted !== undefined) patch.accepted = input.accepted
  if (input.quantityGuess !== undefined) patch.quantity_guess = input.quantityGuess
  if (input.nameGuess !== undefined) patch.name_guess = input.nameGuess.trim()
  if (input.brandGuess !== undefined) patch.brand_guess = input.brandGuess
  if (input.productTypeGuess !== undefined) {
    patch.product_type_guess = input.productTypeGuess
  }
  if (input.presentationGuess !== undefined) {
    patch.presentation_guess = input.presentationGuess
  }
  if (input.netQuantity !== undefined) patch.net_quantity = input.netQuantity
  if (input.netUnit !== undefined) patch.net_unit = input.netUnit
  if (input.notes !== undefined) patch.notes = input.notes
  if (input.markedInvalid !== undefined) {
    patch.marked_invalid = input.markedInvalid
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true }
  }

  const { error: upErr } = await supabase
    .from('stock_check_detected_items')
    .update(patch)
    .eq('id', itemId)

  if (upErr) {
    return { ok: false, error: explainStockChecksRls(upErr.message) }
  }

  revalidatePath('/stock-checks')
  return { ok: true }
}

export async function deleteStockCheckDetectedItem(
  itemId: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getActionContextWithGate('editor')
  if (!ctx.ok) {
    return { ok: false, error: ctx.error }
  }
  const { supabase, activeProfileId } = ctx

  const { data: row, error: rowErr } = await supabase
    .from('stock_check_detected_items')
    .select('id, stock_check_id')
    .eq('id', itemId)
    .maybeSingle()

  if (rowErr || !row) {
    return { ok: false, error: 'Ítem no encontrado' }
  }

  const { data: chk } = await supabase
    .from('stock_checks')
    .select('id, status')
    .eq('id', row.stock_check_id)
    .eq('profile_id', activeProfileId)
    .maybeSingle()

  if (!chk || !stockCheckAllowsLineEdits(chk.status)) {
    return {
      ok: false,
      error:
        chk?.status === 'completed'
          ? 'Este chequeo ya se aplicó al inventario; no se pueden eliminar líneas.'
          : 'Chequeo no encontrado',
    }
  }

  const { error: delErr } = await supabase
    .from('stock_check_detected_items')
    .delete()
    .eq('id', itemId)

  if (delErr) {
    return { ok: false, error: explainStockChecksRls(delErr.message) }
  }

  revalidatePath('/stock-checks')
  return { ok: true }
}

export async function applyStockCheckToInventory(
  checkId: string
): Promise<{ ok: boolean; error?: string; rowsApplied?: number }> {
  const ctx = await getActionContextWithGate('editor')
  if (!ctx.ok) {
    return { ok: false, error: ctx.error }
  }
  const { supabase, activeProfileId } = ctx

  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { ok: false, error: 'Sesión requerida' }
  }

  const { data: chk, error: cErr } = await supabase
    .from('stock_checks')
    .select('id, status')
    .eq('id', checkId)
    .eq('profile_id', activeProfileId)
    .maybeSingle()

  if (cErr || !chk) {
    return { ok: false, error: 'Chequeo no encontrado' }
  }
  if (chk.status !== 'awaiting_confirmation') {
    return { ok: false, error: 'El chequeo ya fue aplicado o no está pendiente' }
  }

  const { data: rows, error: rErr } = await supabase
    .from('stock_check_detected_items')
    .select('id, product_id, quantity_guess, accepted, marked_invalid')
    .eq('stock_check_id', checkId)
    .eq('accepted', true)
    .not('product_id', 'is', null)

  if (rErr) {
    return { ok: false, error: rErr.message }
  }

  // marked_invalid null o false = incluir; TRUE = excluir (no usar .eq(false): excluye NULL)
  const toApply = (rows ?? [])
    .filter((r) => r.marked_invalid !== true)
    .filter(
      (r): r is typeof r & { product_id: string } =>
        typeof r.product_id === 'string'
    )

  if (toApply.length === 0) {
    return {
      ok: false,
      error: 'Marca al menos un ítem como aceptado y asígnale un producto',
    }
  }

  for (const row of toApply) {
    const targetRaw = row.quantity_guess
    const target =
      typeof targetRaw === 'number' && !Number.isNaN(targetRaw) && targetRaw >= 0
        ? targetRaw
        : null

    if (target === null) {
      return {
        ok: false,
        error: 'Indica cantidad para todos los ítems aceptados',
      }
    }

    const { data: product, error: pErr } = await supabase
      .from('products')
      .select('id, stock_current')
      .eq('id', row.product_id)
      .eq('profile_id', activeProfileId)
      .eq('active', true)
      .maybeSingle()

    if (pErr || !product) {
      return { ok: false, error: 'Producto no válido en el chequeo' }
    }

    const prev = Number(product.stock_current)
    const delta = target - prev

    if (delta === 0) {
      continue
    }

    const { error: uErr } = await supabase
      .from('products')
      .update({ stock_current: target })
      .eq('id', row.product_id)
      .eq('profile_id', activeProfileId)

    if (uErr) {
      return { ok: false, error: uErr.message }
    }

    const { error: mErr } = await supabase.from('stock_movements').insert({
      profile_id: activeProfileId,
      product_id: row.product_id,
      delta,
      movement_type: 'inventory_count',
      note: `Chequeo de stock ${checkId}`,
      reference_id: checkId,
      created_by: userData.user.id,
    })

    if (mErr) {
      return { ok: false, error: mErr.message }
    }
  }

  const { error: finErr } = await supabase
    .from('stock_checks')
    .update({ status: 'completed' })
    .eq('id', checkId)
    .eq('profile_id', activeProfileId)

  if (finErr) {
    return { ok: false, error: finErr.message }
  }

  revalidatePath('/stock-checks')
  revalidatePath('/inventory')
  revalidatePath('/history')
  return { ok: true, rowsApplied: toApply.length }
}
