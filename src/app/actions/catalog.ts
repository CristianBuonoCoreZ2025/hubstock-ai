'use server'

import { revalidatePath } from 'next/cache'
import { assertProfileMembership } from '@/lib/profile/membership'
import { getProfileContext } from '@/lib/profile/context'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'
import { createServiceRoleClient } from '@/server/supabase-admin'
import { normalizeCatalogAlias } from '@/lib/catalog-alias'
import { CATALOG_GRID_PAGE_SIZE } from '@/lib/catalog-grid'
import {
  getSearchTermPairs,
  normalizeSearchText,
  searchTermsFromQuery,
} from '@/lib/search'
import { perfLog, withPerfTiming } from '@/lib/perf-log'
import {
  getUserFriendlyErrorMessage,
  isUniqueViolation,
} from '@/lib/user-friendly-errors'

type Tables = Database['public']['Tables']

/** RPC escalar uuid | null: supabase-js no infiere bien Args → segundo parámetro tipado como undefined. */
function rpcCatalogBrandIdForLabel(
  admin: ReturnType<typeof createServiceRoleClient>,
  label: string
) {
  return admin.rpc(
    'catalog_brand_id_for_label',
    { p_name: label } as never
  )
}

/** Evita conflicto de inferencia entre tipos generados y el cliente Supabase en inserts. */
function insertRow<T extends keyof Tables>(
  admin: ReturnType<typeof createServiceRoleClient>,
  table: T,
  row: Tables[T]['Insert']
) {
  return admin.from(table).insert(row as never)
}

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
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  }

  const inserted = typeof data === 'number' ? data : Number(data ?? 0)
  revalidatePath('/inventory')
  revalidatePath('/catalog')
  return { ok: true, inserted: Number.isFinite(inserted) ? inserted : 0 }
}

// --- Catálogo maestro global (escritura vía service_role: la BD solo otorga SELECT a authenticated) ---

type CatalogEditorOk = {
  ok: true
  admin: ReturnType<typeof createServiceRoleClient>
}

async function requireCatalogEditor(): Promise<
  CatalogEditorOk | { ok: false; error: string }
> {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return { ok: false, error: 'Sin perfil activo' }
  }

  const supabase = await createClient()
  const gate = await assertProfileMembership(supabase, activeProfileId, {
    minRole: 'editor',
  })
  if (!gate.ok) {
    return {
      ok: false,
      error: 'Se requiere rol editor o administrador en el perfil activo.',
    }
  }

  try {
    const admin = createServiceRoleClient()
    return { ok: true, admin }
  } catch {
    return {
      ok: false,
      error:
        'Para crear o editar el catálogo maestro configura SUPABASE_SERVICE_ROLE_KEY en el servidor. Sin ella, la base solo permite lectura del catálogo para usuarios autenticados.',
    }
  }
}

export async function createCatalogBrandAction(
  name: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCatalogEditor()
  if (!ctx.ok) return { ok: false, error: ctx.error }

  const label = name.trim()
  if (!label) return { ok: false, error: 'Nombre obligatorio' }

  const { data: existingBrandId } = await rpcCatalogBrandIdForLabel(
    ctx.admin,
    label
  )
  if (existingBrandId != null && String(existingBrandId).length > 0) {
    return {
      ok: false,
      error:
        'Ya existe una marca con ese nombre. Revisa la marca existente o usa otro nombre.',
    }
  }

  const { error } = await insertRow(ctx.admin, 'catalog_brands', { name: label })
  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'brand') }
  }

  revalidatePath('/catalog')
  return { ok: true }
}

/**
 * Resuelve el id de fila en `catalog_brands` para un nombre visible; si no existe, la crea.
 * La búsqueda usa la misma regla que el índice único `lower(trim(name))` (RPC en BD).
 */
export async function ensureCatalogBrandIdForName(
  rawName: string
): Promise<{ ok: true; brand_id: string | null } | { ok: false; error: string }> {
  const label = rawName.trim()
  if (!label) {
    return { ok: true, brand_id: null }
  }

  const ctx = await requireCatalogEditor()
  if (!ctx.ok) return { ok: false, error: ctx.error }

  const { data: resolvedId, error: rpcErr } = await rpcCatalogBrandIdForLabel(
    ctx.admin,
    label
  )

  if (rpcErr) {
    return { ok: false, error: getUserFriendlyErrorMessage(rpcErr, 'generic') }
  }

  if (resolvedId != null && String(resolvedId).length > 0) {
    return { ok: true, brand_id: String(resolvedId) }
  }

  const { data: inserted, error } = await ctx.admin
    .from('catalog_brands')
    .insert({ name: label } as never)
    .select('id')
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      const { data: afterRace } = await rpcCatalogBrandIdForLabel(
        ctx.admin,
        label
      )
      if (afterRace != null && String(afterRace).length > 0) {
        return { ok: true, brand_id: String(afterRace) }
      }
    }
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'brand') }
  }
  const row = inserted as { id: string } | null
  if (!row?.id) {
    return { ok: false, error: 'No se pudo completar la acción. Intenta nuevamente.' }
  }
  return { ok: true, brand_id: row.id }
}

/**
 * Busca un producto maestro ya existente en la misma categoría (nombre tipo Google).
 * Evita duplicar filas en `catalog_products` al cargar desde captura.
 */
export async function findExistingCatalogProductId(input: {
  category_id: string
  name: string
}): Promise<string | null> {
  const ctx = await requireCatalogEditor()
  if (!ctx.ok) return null

  const needle = normalizeSearchText(input.name)
  if (!needle) return null

  const { data: rows, error } = await ctx.admin
    .from('catalog_products')
    .select('id, name')
    .eq('category_id', input.category_id)
    .eq('active', true)
    .limit(8000)

  if (error || !rows?.length) return null

  for (const row of rows as { id: string; name: string }[]) {
    if (normalizeSearchText(row.name) === needle) {
      return row.id
    }
  }
  return null
}

export async function createSectionAction(
  name: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCatalogEditor()
  if (!ctx.ok) return { ok: false, error: ctx.error }

  const label = name.trim()
  if (!label) return { ok: false, error: 'Nombre obligatorio' }

  const { data: maxData } = await ctx.admin
    .from('sections')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const maxRow = maxData as { sort_order: number } | null
  const sort_order = (maxRow?.sort_order ?? -1) + 1

  const { error } = await insertRow(ctx.admin, 'sections', {
    name: label,
    sort_order,
  })

  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'section') }
  }

  revalidatePath('/catalog')
  return { ok: true }
}

export async function createCategoryAction(
  sectionId: string,
  name: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCatalogEditor()
  if (!ctx.ok) return { ok: false, error: ctx.error }

  const label = name.trim()
  if (!label) return { ok: false, error: 'Nombre obligatorio' }

  const { data: maxData } = await ctx.admin
    .from('categories')
    .select('sort_order')
    .eq('section_id', sectionId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const maxRow = maxData as { sort_order: number } | null
  const sort_order = (maxRow?.sort_order ?? -1) + 1

  const { error } = await insertRow(ctx.admin, 'categories', {
    section_id: sectionId,
    name: label,
    sort_order,
  })

  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'category') }
  }

  revalidatePath('/catalog')
  return { ok: true }
}

export type CatalogProductInput = {
  name: string
  section_id: string
  category_id: string
  brand_id: string | null
  brand: string | null
  format: string | null
  unit: string | null
  default_reference_price: number | null
  active: boolean
}

/**
 * Inserta un producto maestro en `catalog_products` y devuelve su id.
 * Requiere permisos de editor en el perfil y service role (igual que el resto de escrituras de catálogo).
 */
export async function createCatalogProductRow(
  input: CatalogProductInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requireCatalogEditor()
  if (!ctx.ok) return { ok: false, error: ctx.error }

  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Nombre obligatorio' }

  const { data: maxData } = await ctx.admin
    .from('catalog_products')
    .select('sort_order')
    .eq('category_id', input.category_id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const maxRow = maxData as { sort_order: number } | null
  const sort_order = (maxRow?.sort_order ?? -1) + 1

  const { data, error } = await ctx.admin
    .from('catalog_products')
    .insert({
      name,
      section_id: input.section_id,
      category_id: input.category_id,
      brand_id: input.brand_id,
      brand: input.brand,
      format: input.format,
      unit: input.unit,
      default_reference_price: input.default_reference_price,
      sort_order,
      active: input.active,
    } as never)
    .select('id')
    .single()

  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'product') }
  }

  const row = data as { id: string }
  if (!row?.id) {
    return { ok: false, error: 'No se pudo completar la acción. Intenta nuevamente.' }
  }
  return { ok: true, id: row.id }
}

export async function createCatalogProductAction(
  input: CatalogProductInput
): Promise<{ ok: boolean; error?: string }> {
  const created = await createCatalogProductRow(input)
  if (!created.ok) return { ok: false, error: created.error }

  revalidatePath('/catalog')
  return { ok: true }
}

export async function updateCatalogProductAction(
  id: string,
  input: CatalogProductInput
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCatalogEditor()
  if (!ctx.ok) return { ok: false, error: ctx.error }

  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Nombre obligatorio' }

  const { error } = await ctx.admin
    .from('catalog_products')
    .update({
      name,
      section_id: input.section_id,
      category_id: input.category_id,
      brand_id: input.brand_id,
      brand: input.brand,
      format: input.format,
      unit: input.unit,
      default_reference_price: input.default_reference_price,
      active: input.active,
    } as never)
    .eq('id', id)

  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'product') }
  }

  revalidatePath('/catalog')
  return { ok: true }
}

export async function setCatalogProductActiveAction(
  id: string,
  active: boolean
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCatalogEditor()
  if (!ctx.ok) return { ok: false, error: ctx.error }

  const { error } = await ctx.admin.from('catalog_products').update({ active } as never).eq('id', id)

  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  }

  revalidatePath('/catalog')
  return { ok: true }
}

export async function updateCatalogBrandAction(
  id: string,
  name: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCatalogEditor()
  if (!ctx.ok) return { ok: false, error: ctx.error }

  const label = name.trim()
  if (!label) return { ok: false, error: 'Nombre obligatorio' }

  const { data: rows } = await ctx.admin.from('catalog_brands').select('id, name')
  const brandRows = (rows ?? []) as { id: string; name: string }[]
  const target = normalizeSearchText(label)
  const dup = brandRows.some((r) => r.id !== id && normalizeSearchText(r.name) === target)
  if (dup) {
    return {
      ok: false,
      error:
        'Ya existe una marca con ese nombre. Revisa la marca existente o usa otro nombre.',
    }
  }

  const { error } = await ctx.admin.from('catalog_brands').update({ name: label } as never).eq('id', id)

  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'brand') }
  }

  revalidatePath('/catalog')
  return { ok: true }
}

/**
 * Une dos marcas canónicas: conserva una fila, reasigna productos maestros de la absorbida,
 * borra la absorbida y deja la superviviente con `unifiedName`.
 * La regla de nombre único es la misma que `catalog_brand_id_for_label` / índice en BD:
 * otro nombre resuelvable a ese id que no sea una de las dos marcas seleccionadas → error.
 */
export async function mergeCatalogBrandsAction(input: {
  survivorBrandId: string
  absorbedBrandId: string
  unifiedName: string
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCatalogEditor()
  if (!ctx.ok) return { ok: false, error: ctx.error }

  const survivor = input.survivorBrandId.trim()
  const absorbed = input.absorbedBrandId.trim()
  const label = input.unifiedName.trim()

  if (!survivor || !absorbed) {
    return { ok: false, error: 'Completa los campos obligatorios antes de guardar.' }
  }
  if (survivor === absorbed) {
    return { ok: false, error: 'Elige dos marcas distintas para unificar.' }
  }
  if (!label) {
    return { ok: false, error: 'El nombre final de la marca es obligatorio.' }
  }

  const { data: existRows, error: loadErr } = await ctx.admin
    .from('catalog_brands')
    .select('id')
    .in('id', [survivor, absorbed])

  if (loadErr) {
    return { ok: false, error: getUserFriendlyErrorMessage(loadErr, 'generic') }
  }
  const found = new Set((existRows ?? []).map((r) => String((r as { id: string }).id)))
  if (!found.has(survivor) || !found.has(absorbed)) {
    return { ok: false, error: 'No se encontró una de las marcas seleccionadas.' }
  }

  const { data: conflictingIdRaw, error: rpcErr } = await rpcCatalogBrandIdForLabel(
    ctx.admin,
    label
  )
  if (rpcErr) {
    return { ok: false, error: getUserFriendlyErrorMessage(rpcErr, 'generic') }
  }
  const conflictingId =
    conflictingIdRaw != null && String(conflictingIdRaw).length > 0 ?
      String(conflictingIdRaw)
    : ''

  if (conflictingId && conflictingId !== survivor && conflictingId !== absorbed) {
    return {
      ok: false,
      error:
        'Ya existe una marca con ese nombre. Revisa la marca existente o usa otro nombre.',
    }
  }

  const { error: migrateErr } = await ctx.admin
    .from('catalog_products')
    .update({
      brand_id: survivor,
      brand: label,
    } as never)
    .eq('brand_id', absorbed)

  if (migrateErr) {
    return { ok: false, error: getUserFriendlyErrorMessage(migrateErr, 'generic') }
  }

  const { error: delBrandErr } = await ctx.admin.from('catalog_brands').delete().eq('id', absorbed)

  if (delBrandErr) {
    return { ok: false, error: getUserFriendlyErrorMessage(delBrandErr, 'brand') }
  }

  const { error: renameErr } = await ctx.admin
    .from('catalog_brands')
    .update({ name: label } as never)
    .eq('id', survivor)

  if (renameErr) {
    return { ok: false, error: getUserFriendlyErrorMessage(renameErr, 'brand') }
  }

  const { error: alignTextErr } = await ctx.admin
    .from('catalog_products')
    .update({ brand: label } as never)
    .eq('brand_id', survivor)

  if (alignTextErr) {
    return { ok: false, error: getUserFriendlyErrorMessage(alignTextErr, 'generic') }
  }

  revalidatePath('/catalog')
  return { ok: true }
}

export async function updateSectionAction(
  id: string,
  name: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCatalogEditor()
  if (!ctx.ok) return { ok: false, error: ctx.error }

  const label = name.trim()
  if (!label) return { ok: false, error: 'Nombre obligatorio' }

  const { data: rows } = await ctx.admin.from('sections').select('id, name')
  const secRows = (rows ?? []) as { id: string; name: string }[]
  const target = normalizeSearchText(label)
  const dup = secRows.some((r) => r.id !== id && normalizeSearchText(r.name) === target)
  if (dup) {
    return {
      ok: false,
      error: 'Ya existe una sección con ese nombre.',
    }
  }

  const { error } = await ctx.admin.from('sections').update({ name: label } as never).eq('id', id)

  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'section') }
  }

  revalidatePath('/catalog')
  return { ok: true }
}

export async function updateCategoryAction(
  id: string,
  sectionId: string,
  name: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCatalogEditor()
  if (!ctx.ok) return { ok: false, error: ctx.error }

  const label = name.trim()
  if (!label) return { ok: false, error: 'Nombre obligatorio' }

  const { data: rows } = await ctx.admin
    .from('categories')
    .select('id, name, section_id')
    .eq('section_id', sectionId)
  const catRows = (rows ?? []) as { id: string; name: string }[]
  const target = normalizeSearchText(label)
  const dup = catRows.some((r) => r.id !== id && normalizeSearchText(r.name) === target)
  if (dup) {
    return {
      ok: false,
      error: 'Ya existe una categoría con ese nombre en esta sección.',
    }
  }

  const { error } = await ctx.admin
    .from('categories')
    .update({ name: label, section_id: sectionId } as never)
    .eq('id', id)

  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'category') }
  }

  revalidatePath('/catalog')
  return { ok: true }
}

export async function createCatalogAliasAction(
  catalogProductId: string,
  aliasRaw: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCatalogEditor()
  if (!ctx.ok) return { ok: false, error: ctx.error }

  const alias_normalized = normalizeCatalogAlias(aliasRaw)
  if (!alias_normalized) {
    return { ok: false, error: 'Alias vacío' }
  }

  const { error } = await insertRow(ctx.admin, 'catalog_product_aliases', {
    catalog_product_id: catalogProductId,
    alias_normalized,
  })

  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'alias') }
  }

  revalidatePath('/catalog')
  return { ok: true }
}

// --- Lecturas paginadas del catálogo (SELECT vía cliente autenticado + RLS) ---

function escapeIlikePattern(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

/** Límite de IDs candidatos en búsqueda acotada (sin cargar todo el catálogo). */
const CATALOG_SEARCH_MAX_IDS = 4500

export type CatalogProductGridRow = {
  id: string
  name: string
  brand: string | null
  brand_id: string | null
  brand_label: string | null
  format: string | null
  unit: string | null
  default_reference_price: number | null
  /** Última captura SQLite/import con vínculo retailer=lider */
  retail_price_lider: number | null
  /** Última captura SQLite/import con vínculo retailer=jumbo */
  retail_price_jumbo: number | null
  /** Última captura con vínculo retailer=central_mayorista (Central Mayorista) */
  retail_price_central_mayorista: number | null
  /** Origen del maestro (p. ej. lider_sqlite); usado solo como respaldo visual en columna Lider */
  source_system: string | null
  sort_order: number
  active: boolean
  section_id: string
  category_id: string
  thumb_url: string | null
}

export type FetchCatalogProductsPageParams = {
  page: number
  pageSize?: number
  includeInactive: boolean
  sectionId: string
  categoryId: string
  brandId: string
  /** Texto de búsqueda libre; resuelto en Postgres (`catalog_products_search_page`). */
  search: string
}

export type FetchCatalogProductsPageOk = {
  readonly ok: true
  items: CatalogProductGridRow[]
  total: number | null
  page: number
  pageSize: number
  hasNextPage: boolean
  truncated?: boolean
}

type RawProdMedia = { public_url: string; kind: string }
type RawProductRow = {
  id: string
  name: string
  brand: string | null
  brand_id: string | null
  format: string | null
  unit: string | null
  default_reference_price: number | null
  sort_order: number
  active: boolean
  section_id: string
  category_id: string
  source_system: string | null
  catalog_product_media: RawProdMedia[] | null
}

/** Fila mínima para rankear sin traer `catalog_product_media`. */
type LeanCatalogProductRow = Pick<
  RawProductRow,
  'id' | 'name' | 'brand' | 'brand_id' | 'format' | 'unit' | 'section_id' | 'category_id'
>

/** Fila devuelta por la RPC `catalog_products_search_page` (PostgREST). */
type CatalogSearchRpcRow = {
  id: string
  name: string
  brand: string | null
  brand_id: string | null
  format: string | null
  unit: string | null
  default_reference_price: number | null
  sort_order: number
  active: boolean
  section_id: string
  category_id: string
  thumb_url: string | null
  brand_label: string | null
  total_count: number | string | null
  source_system?: string | null
}

/** Booleanos desde Postgres/JSON en respuestas RPC ocasionales. */
function rpcBool(value: unknown): boolean {
  if (value === true) return true
  if (value === false) return false
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase()
    return s === 't' || s === 'true' || s === '1'
  }
  return false
}

/** Detecta una fila devuelta por una RPC `returns table` (PostgREST). */
function isProbablyRpcTableRow(o: Record<string, unknown>): boolean {
  if (typeof o.id === 'string') return true
  if (o.id != null && typeof o.name === 'string') return true
  return typeof o.name === 'string' && (o.section_id != null || o.total_count != null)
}

/**
 * PostgREST / cliente puede devolver:
 * - array de filas
 * - una sola fila como objeto (sin `[ ]`)
 * - objeto con claves `"0","1",…` **mezcladas con metadatos** (`length`, etc.): antes fallaba el chequeo
 *   `keys.every(numérico)` y se devolvía `[]` → grilla vacía.
 * - `{ data: [...] }` / `{ rows: [...] }`
 */
function rowsFromRpcTableData<T extends Record<string, unknown>>(data: unknown): T[] {
  if (data == null) return []

  if (Array.isArray(data)) {
    return data.filter((r): r is T => r != null && typeof r === 'object') as T[]
  }

  if (typeof data !== 'object') return []

  const o = data as Record<string, unknown>

  const nested = o.data ?? o.rows
  if (Array.isArray(nested)) {
    return nested.filter((r): r is T => r != null && typeof r === 'object') as T[]
  }

  const numericKeys = Object.keys(o).filter((k) => /^\d+$/.test(k))
  if (numericKeys.length > 0) {
    return numericKeys
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => o[k])
      .filter((r): r is T => r != null && typeof r === 'object') as T[]
  }

  if (isProbablyRpcTableRow(o)) {
    return [data as T]
  }

  return []
}

async function collectMatchedProductIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filterParams: {
    includeInactive: boolean
    sectionId: string | 'all'
    categoryId: string | 'all'
    brandId: string | 'all'
  },
  searchRaw: string
): Promise<{ ids: string[]; truncated: boolean }> {
  const norm = normalizeSearchText(searchRaw)
  const terms = searchTermsFromQuery(searchRaw)
  if (!norm || terms.length === 0) return { ids: [], truncated: false }
  // Evita consultas masivas para prefijos muy cortos.
  if (norm.length < 3) return { ids: [], truncated: false }

  const buildIdsOnly = () => {
    let q = supabase.from('catalog_products').select('id')
    if (!filterParams.includeInactive) q = q.eq('active', true)
    if (filterParams.sectionId !== 'all') q = q.eq('section_id', filterParams.sectionId)
    if (filterParams.categoryId !== 'all') q = q.eq('category_id', filterParams.categoryId)
    if (filterParams.brandId !== 'all') q = q.eq('brand_id', filterParams.brandId)
    return q
  }

  const idSet = new Set<string>()
  let truncated = false

  const take = (rows: { id: string }[] | null | undefined) => {
    for (const r of rows ?? []) {
      idSet.add(r.id)
      if (idSet.size >= CATALOG_SEARCH_MAX_IDS) {
        truncated = true
        return true
      }
    }
    return false
  }

  // Caso común (una palabra >= 3 chars): evitar múltiples round-trips.
  // Para búsquedas típicas ("mayo", "mostaza") basta con name/brand/format/unit + alias.
  if (terms.length === 1 && norm.length >= 3) {
    const t = escapeIlikePattern(terms[0] ?? norm)
    const orQuick = [
      `name.ilike.%${t}%`,
      `brand.ilike.%${t}%`,
      `format.ilike.%${t}%`,
      `unit.ilike.%${t}%`,
    ].join(',')
    const { data: q1 } = await buildIdsOnly().or(orQuick).limit(2200)
    if (take(q1 as { id: string }[])) return { ids: [...idSet], truncated }
  } else {
    const orName = terms.map((t) => `name.ilike.%${escapeIlikePattern(t)}%`).join(',')
    const orBrandCol = terms.map((t) => `brand.ilike.%${escapeIlikePattern(t)}%`).join(',')
    const [{ data: w1 }, { data: w2 }] = await Promise.all([
      buildIdsOnly().or(orName).limit(1800),
      buildIdsOnly().or(orBrandCol).limit(1200),
    ])
    if (take(w1 as { id: string }[])) return { ids: [...idSet], truncated }
    if (take(w2 as { id: string }[])) return { ids: [...idSet], truncated }
  }

  // Para /catalog priorizamos velocidad: no expandimos por coincidencias de tablas auxiliares
  // (sections/categories/catalog_brands). Si el usuario escribe exactamente el nombre de una sección/categoría,
  // igual encontrará productos relevantes por name/brand/alias y filtros explícitos.

  const orFmt = [
    ...terms.map((t) => `format.ilike.%${escapeIlikePattern(t)}%`),
    ...terms.map((t) => `unit.ilike.%${escapeIlikePattern(t)}%`),
  ].join(',')
  const likeAlias = `%${escapeIlikePattern(norm)}%`
  const [{ data: w6 }, { data: aliasRows }] = await Promise.all([
    buildIdsOnly().or(orFmt).limit(800),
    supabase
      .from('catalog_product_aliases')
      .select('catalog_product_id')
      .ilike('alias_normalized', likeAlias)
      .limit(800),
  ])
  if (take(w6 as { id: string }[])) return { ids: [...idSet], truncated }

  const aliasPids = [
    ...new Set((aliasRows ?? []).map((a: { catalog_product_id: string }) => a.catalog_product_id)),
  ]
  const CHUNK_IN = 120
  for (let i = 0; i < aliasPids.length; i += CHUNK_IN) {
    const chunk = aliasPids.slice(i, i + CHUNK_IN)
    const { data: w7 } = await buildIdsOnly().in('id', chunk).limit(1200)
    if (take(w7 as { id: string }[])) return { ids: [...idSet], truncated }
  }

  return { ids: [...idSet], truncated }
}

async function fetchLeanCatalogRowsForIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[]
): Promise<LeanCatalogProductRow[]> {
  const out: LeanCatalogProductRow[] = []
  const chunkSize = 400
  const selectLean =
    'id, name, brand, brand_id, format, unit, section_id, category_id'
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    const { data, error } = await supabase.from('catalog_products').select(selectLean).in('id', chunk)
    if (error) throw error
    out.push(...((data ?? []) as LeanCatalogProductRow[]))
  }
  return out
}

async function fetchAliasMapForProductIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[]
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  const chunkSize = 400
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    const { data } = await supabase
      .from('catalog_product_aliases')
      .select('catalog_product_id,alias_normalized')
      .in('catalog_product_id', chunk)
    for (const a of data ?? []) {
      const row = a as { catalog_product_id: string; alias_normalized: string }
      const arr = map.get(row.catalog_product_id) ?? []
      arr.push(row.alias_normalized)
      map.set(row.catalog_product_id, arr)
    }
  }
  return map
}

async function fetchRetailPricesForProductIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[]
): Promise<
  Map<
    string,
    { lider: number | null; jumbo: number | null; central_mayorista: number | null }
  >
> {
  const out = new Map<
    string,
    { lider: number | null; jumbo: number | null; central_mayorista: number | null }
  >()
  const chunkSize = 150
  for (let i = 0; i < ids.length; i += chunkSize) {
    const slice = ids.slice(i, i + chunkSize)
    const { data, error } = await supabase.rpc('catalog_retail_prices_for_products', {
      p_product_ids: slice,
    } as never)
    if (error) throw error
    for (const row of data ?? []) {
      const r = row as {
        catalog_product_id: string
        retail_price_lider: number | null
        retail_price_jumbo: number | null
        retail_price_central_mayorista: number | null
      }
      out.set(r.catalog_product_id, {
        lider: r.retail_price_lider != null ? Number(r.retail_price_lider) : null,
        jumbo: r.retail_price_jumbo != null ? Number(r.retail_price_jumbo) : null,
        central_mayorista:
          r.retail_price_central_mayorista != null
            ? Number(r.retail_price_central_mayorista)
            : null,
      })
    }
  }
  return out
}

/** Solo enriquece marca canónica y miniatura; los alias ya se usan en la ruta de búsqueda antes de paginar. */
async function hydrateCatalogProductRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rawRows: RawProductRow[]
): Promise<CatalogProductGridRow[]> {
  if (rawRows.length === 0) return []

  const brandIds = [...new Set(rawRows.map((r) => r.brand_id).filter(Boolean))] as string[]
  const brandNameById = new Map<string, string>()
  if (brandIds.length > 0) {
    const { data: br } = await supabase.from('catalog_brands').select('id,name').in('id', brandIds)
    for (const b of br ?? []) brandNameById.set(b.id, b.name)
  }

  let retailById = new Map<
    string,
    { lider: number | null; jumbo: number | null; central_mayorista: number | null }
  >()
  try {
    retailById = await fetchRetailPricesForProductIds(
      supabase,
      rawRows.map((r) => r.id)
    )
  } catch {
    /* RPC ausente hasta aplicar migración: la grilla sigue funcionando sin columnas retail. */
  }

  return rawRows.map((row) => {
    const thumb =
      row.catalog_product_media?.find((m) => m.kind === 'thumbnail')?.public_url ?? null
    const brand_label = row.brand_id ? brandNameById.get(row.brand_id) ?? null : null
    const rp = retailById.get(row.id)
    return {
      id: row.id,
      name: row.name,
      brand: row.brand,
      brand_id: row.brand_id,
      brand_label,
      format: row.format,
      unit: row.unit,
      default_reference_price: row.default_reference_price,
      retail_price_lider: rp?.lider ?? null,
      retail_price_jumbo: rp?.jumbo ?? null,
      retail_price_central_mayorista: rp?.central_mayorista ?? null,
      source_system: row.source_system ?? null,
      sort_order: row.sort_order,
      active: row.active,
      section_id: row.section_id,
      category_id: row.category_id,
      thumb_url: thumb,
    }
  })
}

/** Lista paginada de productos maestros. Sin búsqueda: `range` + conteo. Con búsqueda: RPC `catalog_products_search_page` en BD. */
export async function fetchCatalogProductsPage(
  params: FetchCatalogProductsPageParams
): Promise<FetchCatalogProductsPageOk | { ok: false; error: string }> {
  const reqId = globalThis.crypto?.randomUUID?.() ?? `req_${Date.now()}_${Math.random().toString(16).slice(2)}`
  const baseMeta = {
    reqId,
    feature: 'catalog_products_page',
    page: params.page,
    pageSize: params.pageSize ?? CATALOG_GRID_PAGE_SIZE,
    includeInactive: params.includeInactive,
    sectionId: params.sectionId,
    categoryId: params.categoryId,
    brandId: params.brandId,
    searchLen: params.search?.trim?.().length ?? 0,
  }
  perfLog('catalog.fetchCatalogProductsPage.start', baseMeta)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No hay sesión activa.' }

  const buildBase = (withCount: boolean) => {
    const opts = withCount ? ({ count: 'exact', head: false } as const) : ({ head: false } as const)
    let q = supabase.from('catalog_products').select(
      `id, name, brand, brand_id, format, unit, default_reference_price, sort_order, active, section_id, category_id, source_system,
        catalog_product_media(public_url, kind)`,
      opts
    )
    if (!params.includeInactive) q = q.eq('active', true)
    if (params.sectionId !== 'all') q = q.eq('section_id', params.sectionId)
    if (params.categoryId !== 'all') q = q.eq('category_id', params.categoryId)
    if (params.brandId !== 'all') q = q.eq('brand_id', params.brandId)
    q = q.order('id', { ascending: true })
    return q
  }

  const PAGE = params.pageSize ?? CATALOG_GRID_PAGE_SIZE
  const trimmedSearch = normalizeSearchText(params.search)
  const searchReady = trimmedSearch.length >= 3

  if (!searchReady) {
    const from = Math.max(0, params.page) * PAGE
    const to = from + PAGE - 1
    const { data, error, count } = await withPerfTiming(
      'catalog.fetchCatalogProductsPage.range',
      { ...baseMeta, reqId, from, to, mode: 'range' },
      () => buildBase(true).range(from, to)
    )

    if (error)
      return {
        ok: false,
        error: 'No logramos cargar los productos. Intenta nuevamente.',
      }

    const rows = await withPerfTiming(
      'catalog.fetchCatalogProductsPage.hydrate',
      { ...baseMeta, reqId, rows: (data ?? []).length, mode: 'range' },
      () => hydrateCatalogProductRows(supabase, (data ?? []) as RawProductRow[])
    )

    const total = typeof count === 'number' ? count : null
    const hasNextPage =
      typeof count === 'number' ? from + rows.length < count : rows.length === PAGE

    return {
      ok: true,
      items: rows,
      total,
      page: params.page,
      pageSize: PAGE,
      hasNextPage,
    }
  }

  const pageIdx = Math.max(0, params.page)
  const pairs = getSearchTermPairs(params.search)
  let strict = pairs.strict
  let loose = pairs.loose
  if (strict.length !== loose.length) {
    loose = strict.map((t, i) => loose[i] ?? t)
  }
  const normFull = normalizeSearchText(params.search)

  if (strict.length === 0 && normFull.length >= 2) {
    strict = [normFull]
    loose = [normFull]
  }

  if (strict.length === 0) {
    return {
      ok: true,
      items: [],
      total: 0,
      page: pageIdx,
      pageSize: PAGE,
      hasNextPage: false,
    }
  }

  // Una sola RPC: comportamiento esperado por el catálogo (haystack con sección/categoría/marca/alias).
  const { data: rpcData, error: rpcError } = await withPerfTiming(
    'catalog.fetchCatalogProductsPage.rpc.catalog_products_search_page',
    {
      ...baseMeta,
      reqId,
      mode: 'rpc',
      termsStrict: strict.length,
      termsLoose: loose.length,
      fullNormLen: normFull.length,
      pageIdx,
    },
    () =>
      supabase.rpc('catalog_products_search_page', {
        p_terms_strict: strict,
        p_terms_loose: loose,
        p_full_norm: normFull,
        p_section_id: params.sectionId === 'all' ? null : params.sectionId,
        p_category_id: params.categoryId === 'all' ? null : params.categoryId,
        p_brand_filter_id: params.brandId === 'all' ? null : params.brandId,
        p_include_inactive: params.includeInactive,
        p_page: pageIdx,
        p_page_size: PAGE,
      })
  )

  if (rpcError) {
    console.error('[fetchCatalogProductsPage] catalog_products_search_page', rpcError)
    return {
      ok: false,
      error: 'No logramos cargar los productos. Intenta nuevamente.',
    }
  }

  const rows = rowsFromRpcTableData<CatalogSearchRpcRow>(rpcData)
  if (rows.length === 0) {
    return {
      ok: true,
      items: [],
      total: 0,
      page: pageIdx,
      pageSize: PAGE,
      hasNextPage: false,
    }
  }

  const totalRaw = rows[0]?.total_count
  const total =
    totalRaw === null || totalRaw === undefined
      ? rows.length
      : typeof totalRaw === 'string'
        ? Number(totalRaw)
        : totalRaw

  const items: CatalogProductGridRow[] = rows.map((r) => ({
    id: typeof r.id === 'string' ? r.id : String(r.id ?? ''),
    name: r.name,
    brand: r.brand,
    brand_id: r.brand_id,
    brand_label: r.brand_label,
    format: r.format,
    unit: r.unit,
    default_reference_price: r.default_reference_price,
    sort_order: r.sort_order,
    active: rpcBool(r.active),
    section_id: r.section_id,
    category_id: r.category_id,
    thumb_url: r.thumb_url,
    retail_price_lider: null,
    retail_price_jumbo: null,
    retail_price_central_mayorista: null,
    source_system: typeof r.source_system === 'string' ? r.source_system : null,
  }))

  try {
    const retailById = await fetchRetailPricesForProductIds(
      supabase,
      items.map((i) => i.id)
    )
    for (const it of items) {
      const rp = retailById.get(it.id)
      if (!rp) continue
      it.retail_price_lider = rp.lider
      it.retail_price_jumbo = rp.jumbo
      it.retail_price_central_mayorista = rp.central_mayorista
    }
  } catch {
    /* RPC ausente hasta aplicar migración: la grilla sigue funcionando sin columnas retail. */
  }

  const hasNextPage = (pageIdx + 1) * PAGE < total

  return {
    ok: true,
    items,
    total,
    page: pageIdx,
    pageSize: PAGE,
    hasNextPage,
  }
}

/** Wrapper con nombre esperado por UI (productos filtrados por marca). */
export async function fetchProductsByBrandPage(params: {
  brandId: string
  page: number
  pageSize?: number
  search?: string
  includeInactive: boolean
}) {
  return fetchCatalogProductsPage({
    page: params.page,
    pageSize: params.pageSize,
    includeInactive: params.includeInactive,
    sectionId: 'all',
    categoryId: 'all',
    brandId: params.brandId,
    search: params.search ?? '',
  })
}

/** Wrapper con nombre esperado por UI (productos filtrados por categoría). */
export async function fetchProductsByCategoryPage(params: {
  categoryId: string
  page: number
  pageSize?: number
  search?: string
  includeInactive: boolean
}) {
  return fetchCatalogProductsPage({
    page: params.page,
    pageSize: params.pageSize,
    includeInactive: params.includeInactive,
    sectionId: 'all',
    categoryId: params.categoryId,
    brandId: 'all',
    search: params.search ?? '',
  })
}

/**
 * Secciones, categorías y marcas presentes en productos que cumplen el contexto actual.
 * - Secciones: siempre respecto a categoría/marca/búsqueda; **no** se restringe por la sección ya elegida
 *   (así el usuario puede cambiar de sección dentro del mismo resultado).
 * - Categorías: respecto a sección/marca/búsqueda (categoría “libre” en el filtro).
 * - Marcas: respecto a sección/categoría/búsqueda.
 */
export async function fetchCatalogProductFilterOptions(params: {
  search: string
  sectionId: string | 'all'
  categoryId: string | 'all'
  brandId: string | 'all'
  includeInactive: boolean
}): Promise<
  | {
      ok: true
      sections: { id: string; name: string }[]
      categories: { id: string; name: string }[]
      brands: { id: string; name: string }[]
    }
  | { ok: false; error: string }
> {
  const reqId = globalThis.crypto?.randomUUID?.() ?? `req_${Date.now()}_${Math.random().toString(16).slice(2)}`
  const baseMeta = {
    reqId,
    feature: 'catalog_product_filter_options',
    sectionId: params.sectionId,
    categoryId: params.categoryId,
    brandId: params.brandId,
    includeInactive: params.includeInactive,
    searchLen: params.search?.trim?.().length ?? 0,
  }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No hay sesión activa.' }

  const norm = normalizeSearchText(params.search)
  // Acotamos búsqueda de opciones para evitar scans/chunks costosos con 1-2 letras.
  const searchActive = norm.length >= 3 && params.search.trim().length >= 3

  async function distinctSectionIds(): Promise<string[]> {
    if (searchActive) {
      const { ids } = await collectMatchedProductIds(
        supabase,
        {
          includeInactive: params.includeInactive,
          sectionId: 'all',
          categoryId: params.categoryId,
          brandId: params.brandId,
        },
        params.search
      )
      if (ids.length === 0) return []
      const secSet = new Set<string>()
      const chunkSize = 400
      for (let i = 0; i < ids.length; i += chunkSize) {
        const slice = ids.slice(i, i + chunkSize)
        const { data } = await supabase.from('catalog_products').select('section_id').in('id', slice)
        for (const r of data ?? []) {
          secSet.add((r as { section_id: string }).section_id)
        }
      }
      return [...secSet]
    }
    let q = supabase.from('catalog_products').select('section_id')
    if (!params.includeInactive) q = q.eq('active', true)
    if (params.categoryId !== 'all') q = q.eq('category_id', params.categoryId)
    if (params.brandId !== 'all') q = q.eq('brand_id', params.brandId)
    const { data } = await q.limit(6000)
    const set = new Set<string>()
    for (const r of data ?? []) {
      set.add((r as { section_id: string }).section_id)
    }
    return [...set]
  }

  async function distinctCategoryIds(): Promise<string[]> {
    if (searchActive) {
      const { ids } = await collectMatchedProductIds(
        supabase,
        {
          includeInactive: params.includeInactive,
          sectionId: params.sectionId,
          categoryId: 'all',
          brandId: params.brandId,
        },
        params.search
      )
      if (ids.length === 0) return []
      const catSet = new Set<string>()
      const chunkSize = 400
      for (let i = 0; i < ids.length; i += chunkSize) {
        const slice = ids.slice(i, i + chunkSize)
        const { data } = await supabase.from('catalog_products').select('category_id').in('id', slice)
        for (const r of data ?? []) {
          catSet.add((r as { category_id: string }).category_id)
        }
      }
      return [...catSet]
    }
    let q = supabase.from('catalog_products').select('category_id')
    if (!params.includeInactive) q = q.eq('active', true)
    if (params.sectionId !== 'all') q = q.eq('section_id', params.sectionId)
    if (params.brandId !== 'all') q = q.eq('brand_id', params.brandId)
    const { data } = await q.limit(6000)
    const set = new Set<string>()
    for (const r of data ?? []) {
      set.add((r as { category_id: string }).category_id)
    }
    return [...set]
  }

  async function distinctBrandIds(): Promise<string[]> {
    if (searchActive) {
      const { ids } = await collectMatchedProductIds(
        supabase,
        {
          includeInactive: params.includeInactive,
          sectionId: params.sectionId,
          categoryId: params.categoryId,
          brandId: 'all',
        },
        params.search
      )
      if (ids.length === 0) return []
      const brandSet = new Set<string>()
      const chunkSize = 400
      for (let i = 0; i < ids.length; i += chunkSize) {
        const slice = ids.slice(i, i + chunkSize)
        const { data } = await supabase.from('catalog_products').select('brand_id').in('id', slice)
        for (const r of data ?? []) {
          const bid = (r as { brand_id: string | null }).brand_id
          if (bid) brandSet.add(bid)
        }
      }
      return [...brandSet]
    }
    let q = supabase.from('catalog_products').select('brand_id')
    if (!params.includeInactive) q = q.eq('active', true)
    if (params.sectionId !== 'all') q = q.eq('section_id', params.sectionId)
    if (params.categoryId !== 'all') q = q.eq('category_id', params.categoryId)
    const { data } = await q.limit(6000)
    const set = new Set<string>()
    for (const r of data ?? []) {
      const bid = (r as { brand_id: string | null }).brand_id
      if (bid) set.add(bid)
    }
    return [...set]
  }

  let secIds: string[]
  let catIds: string[]
  let brandIds: string[]

  if (
    searchActive &&
    params.sectionId === 'all' &&
    params.categoryId === 'all' &&
    params.brandId === 'all'
  ) {
    const { ids } = await withPerfTiming(
      'catalog.fetchCatalogProductFilterOptions.collectMatchedProductIds',
      { ...baseMeta, mode: 'triple', path: 'fast-path' },
      () =>
        collectMatchedProductIds(
          supabase,
          {
            includeInactive: params.includeInactive,
            sectionId: 'all',
            categoryId: 'all',
            brandId: 'all',
          },
          params.search
        )
    )
    const secSet = new Set<string>()
    const catSet = new Set<string>()
    const brandSet = new Set<string>()
    const chunkSize = 400
    for (let i = 0; i < ids.length; i += chunkSize) {
      const slice = ids.slice(i, i + chunkSize)
      const { data } = await withPerfTiming(
        'catalog.fetchCatalogProductFilterOptions.catalog_products.in.id',
        { ...baseMeta, mode: 'triple', chunkSize: slice.length },
        () =>
          supabase
            .from('catalog_products')
            .select('section_id, category_id, brand_id')
            .in('id', slice)
      )
      for (const r of data ?? []) {
        secSet.add((r as { section_id: string }).section_id)
        catSet.add((r as { category_id: string }).category_id)
        const bid = (r as { brand_id: string | null }).brand_id
        if (bid) brandSet.add(bid)
      }
    }
    secIds = [...secSet]
    catIds = [...catSet]
    brandIds = [...brandSet]
  } else {
    ;[secIds, catIds, brandIds] = await withPerfTiming(
      'catalog.fetchCatalogProductFilterOptions.distinctIds',
      { ...baseMeta, mode: 'split' },
      () => Promise.all([distinctSectionIds(), distinctCategoryIds(), distinctBrandIds()])
    )
  }

  const sections: { id: string; name: string }[] = []
  if (secIds.length > 0) {
    const { data, error } = await withPerfTiming(
      'catalog.fetchCatalogProductFilterOptions.sections.in.id',
      { ...baseMeta, secIds: secIds.length },
      () => supabase.from('sections').select('id,name').in('id', secIds)
    )
    if (error) return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
    for (const s of data ?? []) {
      const row = s as { id: string; name: string }
      sections.push({ id: row.id, name: row.name })
    }
    sections.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
  }

  const categories: { id: string; name: string }[] = []
  if (catIds.length > 0) {
    const { data, error } = await withPerfTiming(
      'catalog.fetchCatalogProductFilterOptions.categories.in.id',
      { ...baseMeta, catIds: catIds.length },
      () => supabase.from('categories').select('id,name').in('id', catIds)
    )
    if (error) return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
    for (const c of data ?? []) {
      const row = c as { id: string; name: string }
      categories.push({ id: row.id, name: row.name })
    }
    categories.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
  }

  const brands: { id: string; name: string }[] = []
  if (brandIds.length > 0) {
    const { data, error } = await withPerfTiming(
      'catalog.fetchCatalogProductFilterOptions.catalog_brands.in.id',
      { ...baseMeta, brandIds: brandIds.length },
      () => supabase.from('catalog_brands').select('id,name').in('id', brandIds)
    )
    if (error) return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
    for (const b of data ?? []) {
      const row = b as { id: string; name: string }
      brands.push({ id: row.id, name: row.name })
    }
    brands.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
  }

  return { ok: true, sections, categories, brands }
}

/** Opciones de sección ordenadas alfabéticamente (lista corta). */
export async function fetchCatalogSectionsOptions(): Promise<
  { ok: true; items: { id: string; name: string }[] } | { ok: false; error: string }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No hay sesión activa.' }

  const { data, error } = await supabase.from('sections').select('id,name').order('name', {
    ascending: true,
  })

  if (error) return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  return { ok: true, items: (data ?? []) as { id: string; name: string }[] }
}

/** Categorías para combos de modal / filtros; orden alfabético por nombre. */
export async function fetchCatalogCategoriesOptions(sectionId: string | 'all'): Promise<
  { ok: true; items: { id: string; name: string; section_id: string }[] } | { ok: false; error: string }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No hay sesión activa.' }

  let q = supabase.from('categories').select('id,name,section_id').order('name', { ascending: true })
  if (sectionId !== 'all') q = q.eq('section_id', sectionId)

  const { data, error } = await q
  if (error) return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  return { ok: true, items: (data ?? []) as { id: string; name: string; section_id: string }[] }
}

export type CatalogCategoryGridRow = {
  id: string
  name: string
  section_id: string
  section_name: string
  product_count: number
}

/**
 * Categorías paginadas con conteo de productos (sin columna active en `categories` en el esquema actual).
 * `productActiveOnly`: si true, el conteo solo incluye `catalog_products.active = true`.
 */
export async function fetchCatalogCategoriesPage(params: {
  page: number
  pageSize?: number
  sectionId: string | 'all'
  /** Acota a una categoría concreta (combo dependiente de sección). */
  categoryId?: string | 'all'
  search: string
  productActiveOnly: boolean
}): Promise<
  | {
      ok: true
      items: CatalogCategoryGridRow[]
      total: number | null
      page: number
      pageSize: number
      hasNextPage: boolean
    }
  | { ok: false; error: string }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No hay sesión activa.' }

  const PAGE = params.pageSize ?? CATALOG_GRID_PAGE_SIZE
  const pageIndex = Math.max(0, params.page)

  const { data: secRows } = await supabase.from('sections').select('id,name')
  const sectionNameById = new Map<string, string>(
    ((secRows ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name])
  )

  const norm = normalizeSearchText(params.search)
  const searchActive = norm.length >= 2
  const categoryPick = params.categoryId && params.categoryId !== 'all' ? params.categoryId : null

  let countQ = supabase.from('categories').select('id', { count: 'exact', head: true })
  if (params.sectionId !== 'all') countQ = countQ.eq('section_id', params.sectionId)
  if (categoryPick) countQ = countQ.eq('id', categoryPick)
  if (searchActive) countQ = countQ.ilike('name', `%${escapeIlikePattern(norm)}%`)

  const { count: totalHead, error: countErr } = await countQ
  if (countErr) return { ok: false, error: getUserFriendlyErrorMessage(countErr, 'generic') }

  const from = pageIndex * PAGE
  const to = from + PAGE - 1

  let listQ = supabase
    .from('categories')
    .select('id,name,section_id,sort_order')
    .order('section_id', { ascending: true })
    .order('sort_order', { ascending: true })
  if (params.sectionId !== 'all') listQ = listQ.eq('section_id', params.sectionId)
  if (categoryPick) listQ = listQ.eq('id', categoryPick)
  if (searchActive) listQ = listQ.ilike('name', `%${escapeIlikePattern(norm)}%`)

  const { data: catData, error: listErr } = await listQ.range(from, to)
  if (listErr) return { ok: false, error: getUserFriendlyErrorMessage(listErr, 'generic') }

  const rawCats = (catData ?? []) as {
    id: string
    name: string
    section_id: string
    sort_order: number
  }[]

  const ids = rawCats.map((c) => c.id)
  const countMap = new Map<string, number>()
  if (ids.length > 0) {
    const { data: countRows, error: pcErr } = await supabase.rpc(
      'catalog_product_counts_by_category_ids',
      {
        p_category_ids: ids,
        p_active_only: params.productActiveOnly,
      },
    )
    if (pcErr) return { ok: false, error: getUserFriendlyErrorMessage(pcErr, 'generic') }
    for (const r of (countRows ?? []) as { category_id: string; product_count: number | string }[]) {
      countMap.set(r.category_id, Number(r.product_count))
    }
  }

  const items: CatalogCategoryGridRow[] = rawCats.map((c) => ({
    id: c.id,
    name: c.name,
    section_id: c.section_id,
    section_name: sectionNameById.get(c.section_id) ?? '—',
    product_count: countMap.get(c.id) ?? 0,
  }))

  const total = typeof totalHead === 'number' ? totalHead : null
  const hasNextPage = typeof total === 'number' ? from + items.length < total : items.length === PAGE

  return {
    ok: true,
    items,
    total,
    page: pageIndex,
    pageSize: PAGE,
    hasNextPage,
  }
}

/** Búsqueda remota de marcas para combobox (máx. 50). UI: mínimo 2 caracteres + debounce. */
export async function searchCatalogBrandsAction(
  query: string
): Promise<{ ok: boolean; rows: { id: string; name: string }[]; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, rows: [], error: 'No hay sesión activa.' }

  const t = normalizeSearchText(query).trim()
  if (t.length < 2) return { ok: true, rows: [] }

  const like = `%${escapeIlikePattern(t)}%`
  const { data, error } = await supabase
    .from('catalog_brands')
    .select('id,name')
    .ilike('name', like)
    .order('name', { ascending: true })
    .limit(50)

  if (error) return { ok: false, rows: [], error: getUserFriendlyErrorMessage(error, 'generic') }
  return { ok: true, rows: (data ?? []) as { id: string; name: string }[] }
}

/** Alias declarativo: mismas filas que `searchCatalogBrandsAction`. */
export async function fetchCatalogBrandsOptions(query: string) {
  return searchCatalogBrandsAction(query)
}

/** Búsqueda remota de categorías para combobox (máx. 50); opcional filtro por sección. */
export async function searchCatalogCategoriesAction(
  query: string,
  sectionId: string | 'all'
): Promise<{ ok: boolean; rows: { id: string; name: string; section_id: string }[]; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, rows: [], error: 'No hay sesión activa.' }

  const t = normalizeSearchText(query).trim()
  if (t.length < 2) return { ok: true, rows: [] }

  const like = `%${escapeIlikePattern(t)}%`
  let catQ = supabase
    .from('categories')
    .select('id,name,section_id')
    .ilike('name', like)
    .order('name', { ascending: true })
    .limit(50)

  if (sectionId !== 'all') catQ = catQ.eq('section_id', sectionId)

  const { data, error } = await catQ
  if (error) return { ok: false, rows: [], error: getUserFriendlyErrorMessage(error, 'generic') }

  return { ok: true, rows: (data ?? []) as { id: string; name: string; section_id: string }[] }
}

/** Búsqueda remota de productos maestros (selector / alias): máx. 50. UI: ≥2 caracteres + debounce. */
export async function searchCatalogProductsForPickerAction(query: string, activeOnly?: boolean): Promise<
  { ok: boolean; rows: { id: string; name: string }[]; error?: string }
> {
  const reqId =
    globalThis.crypto?.randomUUID?.() ??
    `req_${Date.now()}_${Math.random().toString(16).slice(2)}`
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, rows: [], error: 'No hay sesión activa.' }

  const t = normalizeSearchText(query).trim()
  if (t.length < 2) return { ok: true, rows: [] }

  const active = activeOnly !== false
  const like = `%${escapeIlikePattern(t)}%`
  let pq = supabase.from('catalog_products').select('id,name').ilike('name', like)

  if (active) pq = pq.eq('active', true)

  const { data, error } = await withPerfTiming(
    'catalog.searchCatalogProductsForPickerAction.query',
    {
      reqId,
      feature: 'catalog_product_picker',
      qLen: t.length,
      activeOnly: active,
    },
    () => pq.order('name', { ascending: true }).limit(50)
  )

  if (error) return { ok: false, rows: [], error: getUserFriendlyErrorMessage(error, 'generic') }
  return { ok: true, rows: (data ?? []) as { id: string; name: string }[] }
}

export type CatalogBrandGridRow = {
  id: string
  name: string
  product_count: number
}

/** Tabla Marcas paginada. Sin columna `active` en `catalog_brands`; el conteo respeta productos activos si `productActiveOnly`. */
export async function fetchCatalogBrandsPage(params: {
  page: number
  pageSize?: number
  search?: string
  /** Si true, cuenta solo productos activos del catálogo */
  productActiveOnly: boolean
}): Promise<
  | {
      ok: true
      items: CatalogBrandGridRow[]
      total: number | null
      page: number
      pageSize: number
      hasNextPage: boolean
    }
  | { ok: false; error: string }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No hay sesión activa.' }

  const PAGE = params.pageSize ?? CATALOG_GRID_PAGE_SIZE
  const from = Math.max(0, params.page) * PAGE
  const to = from + PAGE - 1

  const norm = normalizeSearchText(params.search ?? '')
  const searchActive = norm.length >= 2

  let countQ = supabase.from('catalog_brands').select('id', { count: 'exact', head: true })
  if (searchActive) countQ = countQ.ilike('name', `%${escapeIlikePattern(norm)}%`)

  const { count: totalHead, error: countErr } = await countQ
  if (countErr) return { ok: false, error: getUserFriendlyErrorMessage(countErr, 'generic') }

  let q = supabase.from('catalog_brands').select('id,name').order('name', { ascending: true })
  if (searchActive) q = q.ilike('name', `%${escapeIlikePattern(norm)}%`)

  const { data, error } = await q.range(from, to)
  if (error) return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }

  const raw = (data ?? []) as { id: string; name: string }[]
  const ids = raw.map((r) => r.id)
  const countMap = new Map<string, number>()
  if (ids.length > 0) {
    const { data: countRows, error: pcErr } = await supabase.rpc(
      'catalog_product_counts_by_brand_ids',
      {
        p_brand_ids: ids,
        p_active_only: params.productActiveOnly,
      },
    )
    if (pcErr) return { ok: false, error: getUserFriendlyErrorMessage(pcErr, 'generic') }
    for (const r of (countRows ?? []) as { brand_id: string; product_count: number | string }[]) {
      countMap.set(r.brand_id, Number(r.product_count))
    }
  }

  const items: CatalogBrandGridRow[] = raw.map((b) => ({
    id: b.id,
    name: b.name,
    product_count: countMap.get(b.id) ?? 0,
  }))

  const total = typeof totalHead === 'number' ? totalHead : null
  const hasNextPage = typeof total === 'number' ? from + items.length < total : items.length === PAGE

  return {
    ok: true,
    items,
    total,
    page: params.page,
    pageSize: PAGE,
    hasNextPage,
  }
}

export type AliasPageRow = {
  id: string
  catalog_product_id: string
  alias_normalized: string
  product_name: string
}

/** Listado paginado de alias (≥2 caracteres en `search`; vacío muestra página sin prefiltro servidor). */
export async function fetchCatalogAliasesPage(params: {
  page: number
  search: string
}): Promise<{ ok: boolean; rows: AliasPageRow[]; hasNextPage: boolean; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, rows: [], hasNextPage: false, error: 'No hay sesión activa.' }

  const PAGE = CATALOG_GRID_PAGE_SIZE
  const from = Math.max(0, params.page) * PAGE

  let q = supabase
    .from('catalog_product_aliases')
    .select('id,catalog_product_id,alias_normalized')
    .order('alias_normalized', { ascending: true })

  const norm = normalizeSearchText(params.search)
  if (norm.length >= 2) q = q.ilike('alias_normalized', `%${escapeIlikePattern(norm)}%`)

  const { data, error } = await q.range(from, from + PAGE - 1)

  if (error)
    return { ok: false, rows: [], hasNextPage: false, error: getUserFriendlyErrorMessage(error, 'generic') }

  const rawRows = (data ?? []) as { id: string; catalog_product_id: string; alias_normalized: string }[]
  if (rawRows.length === 0) {
    return { ok: true, rows: [], hasNextPage: false }
  }

  const pids = [...new Set(rawRows.map((r) => r.catalog_product_id))]
  const { data: prods } = await supabase.from('catalog_products').select('id,name').in('id', pids)
  const prodNameById = new Map((prods ?? []).map((p: { id: string; name: string }) => [p.id, p.name]))

  const rows: AliasPageRow[] = rawRows.map((r) => ({
    id: r.id,
    catalog_product_id: r.catalog_product_id,
    alias_normalized: r.alias_normalized,
    product_name: prodNameById.get(r.catalog_product_id) ?? '(sin nombre)',
  }))

  const hasNextPage = rows.length === PAGE
  return { ok: true, rows, hasNextPage }
}
