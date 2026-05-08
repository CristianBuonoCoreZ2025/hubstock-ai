'use server'

import { revalidatePath } from 'next/cache'
import { assertProfileMembership } from '@/lib/profile/membership'
import { getProfileContext } from '@/lib/profile/context'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/server/supabase-admin'
import { CATALOG_GRID_PAGE_SIZE } from '@/lib/catalog-grid'
import { normalizeCatalogAlias } from '@/lib/catalog-alias'
import {
  getUserFriendlyErrorMessage,
  isUniqueViolation,
} from '@/lib/user-friendly-errors'

export type RetailListingRow = {
  snapshot_id: string
  retailer: string
  external_ref: string
  source_url: string | null
  title: string
  price: number
  category_hint: string | null
  brand_hint: string | null
  description_hint: string | null
  captured_at: string
  catalog_product_id: string | null
  linked_product_name: string | null
  total_count: number
}

export type RetailMatchCandidate = {
  catalog_product_id: string
  product_name: string
  category_id: string
  default_reference_price: number | null
  match_score: number
}

export type RetailHistoryRow = {
  price: number
  captured_at: string
  match_method: string | null
}

async function requireProfileViewer(): Promise<
  | { ok: true }
  | { ok: false; error: string }
> {
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return { ok: false, error: 'Necesitas un perfil activo.' }
  }
  const supabase = await createClient()
  const gate = await assertProfileMembership(supabase, activeProfileId, {
    minRole: 'viewer',
  })
  if (!gate.ok) {
    return { ok: false, error: 'No tienes permisos para ver esta información.' }
  }
  return { ok: true }
}

async function requireCatalogEditorRetail(): Promise<
  | { ok: true; admin: ReturnType<typeof createServiceRoleClient> }
  | { ok: false; error: string }
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
      error: 'Se requiere rol editor o administrador para homologar precios.',
    }
  }

  try {
    const admin = createServiceRoleClient()
    return { ok: true, admin }
  } catch {
    return {
      ok: false,
      error:
        'Para guardar homologaciones configura SUPABASE_SERVICE_ROLE_KEY en el servidor.',
    }
  }
}

export async function fetchRetailListingsPage(input: {
  retailer: string | null
  unlinkedOnly: boolean
  search: string
  page: number
}): Promise<
  | { ok: true; rows: RetailListingRow[]; total: number; hasNextPage: boolean }
  | { ok: false; error: string }
> {
  const gate = await requireProfileViewer()
  if (!gate.ok) {
    return { ok: false, error: gate.error }
  }

  const supabase = await createClient()
  const retailerFilter =
    input.retailer != null && input.retailer !== 'all' ? input.retailer : null

  const { data, error } = await supabase.rpc('catalog_retail_listings_page', {
    p_retailer: retailerFilter,
    p_unlinked_only: input.unlinkedOnly,
    p_search: input.search.trim() || null,
    p_page: input.page,
    p_page_size: CATALOG_GRID_PAGE_SIZE,
  })

  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  }

  const rows = (data ?? []) as RetailListingRow[]
  const total = rows[0]?.total_count ?? 0
  const hasNextPage = (input.page + 1) * CATALOG_GRID_PAGE_SIZE < total

  return { ok: true, rows, total, hasNextPage }
}

export async function fetchRetailPriceHistory(input: {
  retailer: string
  external_ref: string
}): Promise<{ ok: true; rows: RetailHistoryRow[] } | { ok: false; error: string }> {
  const gate = await requireProfileViewer()
  if (!gate.ok) {
    return { ok: false, error: gate.error }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('catalog_retail_snapshots')
    .select('price, captured_at, match_method')
    .eq('retailer', input.retailer)
    .eq('external_ref', input.external_ref)
    .order('captured_at', { ascending: false })
    .limit(80)

  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  }

  return {
    ok: true,
    rows: (data ?? []).map((r) => ({
      price: Number(r.price),
      captured_at: r.captured_at,
      match_method: r.match_method,
    })),
  }
}

export async function fetchRetailMatchCandidatesAction(input: {
  title: string
  price: number | null
  categoryId: string | null
}): Promise<
  | { ok: true; rows: RetailMatchCandidate[] }
  | { ok: false; error: string }
> {
  const gate = await requireProfileViewer()
  if (!gate.ok) {
    return { ok: false, error: gate.error }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('catalog_retail_match_candidates', {
    p_search_title: input.title,
    p_price: input.price,
    p_category_id: input.categoryId,
    p_limit: 15,
  })

  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  }

  const rows = (data ?? []).map(
    (r: {
      catalog_product_id: string
      product_name: string
      category_id: string
      default_reference_price: number | null
      match_score: number
    }) => ({
    catalog_product_id: r.catalog_product_id,
    product_name: r.product_name,
    category_id: r.category_id,
    default_reference_price:
      r.default_reference_price != null ? Number(r.default_reference_price) : null,
    match_score: Number(r.match_score),
  }))

  return { ok: true, rows }
}

export async function linkRetailListingAction(input: {
  retailer: string
  external_ref: string
  catalog_product_id: string
  /** Si es true, registra el título del ítem como alias del maestro (útil para boletas). */
  addTitleAlias?: boolean
  listingTitle?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) {
    return { ok: false, error: editor.error }
  }

  const { admin } = editor

  const { error: linkError } = await admin.from('catalog_retail_links').upsert(
    {
      retailer: input.retailer,
      external_ref: input.external_ref,
      catalog_product_id: input.catalog_product_id,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: 'retailer,external_ref' }
  )

  if (linkError) {
    return {
      ok: false,
      error: getUserFriendlyErrorMessage(linkError, 'generic'),
    }
  }

  if (input.addTitleAlias && input.listingTitle?.trim()) {
    const normalized = normalizeCatalogAlias(input.listingTitle)
    if (normalized.length >= 2) {
      const ins = await admin.from('catalog_product_aliases').insert({
        catalog_product_id: input.catalog_product_id,
        alias_normalized: normalized,
      } as never)
      if (ins.error && !isUniqueViolation(ins.error)) {
        return {
          ok: false,
          error: getUserFriendlyErrorMessage(ins.error, 'generic'),
        }
      }
    }
  }

  revalidatePath('/catalog')
  return { ok: true }
}

export async function unlinkRetailListingAction(input: {
  retailer: string
  external_ref: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) {
    return { ok: false, error: editor.error }
  }

  const { error } = await editor.admin
    .from('catalog_retail_links')
    .delete()
    .eq('retailer', input.retailer)
    .eq('external_ref', input.external_ref)

  if (error) {
    return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  }

  revalidatePath('/catalog')
  return { ok: true }
}
