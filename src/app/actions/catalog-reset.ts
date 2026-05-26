'use server'

import { getProfileContext } from '@/lib/profile/context'
import { assertProfileMembership } from '@/lib/profile/membership'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/server/supabase-admin'
import { getUserFriendlyErrorMessage } from '@/lib/user-friendly-errors'
import logger from '@/lib/logger'

export type CatalogResetAnalysis = {
  ok: true
  productosScrapping: number
  productosConStock: number
  productosConMovimientos: number
  productosSegurosBorrar: number
  marcasScrapping: number
  marcasSegurasBorrar: number
  seccionesSoloScrapping: number
  categoriasSoloScrapping: number
  retailSnapshots: number
  retailLinks: number
  mediaFiles: number
  scrappingPendingNew: number
  scrappingMatched: number
  __diagnostic?: Record<string, unknown>
}

export type CatalogResetResult = {
  ok: true
  deletedProducts: number
  deletedAliases: number
  deletedMedia: number
  deletedRetailLinks: number
  deletedRetailSnapshots: number
  deletedBrands: number
  deletedCategories: number
  deletedSections: number
  restoredPendingNew: number
  __diagnostic?: Record<string, unknown>
}

const CHUNK_SIZE = 500

async function chunkDeleteIn(
  admin: ReturnType<typeof createServiceRoleClient>,
  table: string,
  column: string,
  ids: string[]
): Promise<number> {
  let total = 0
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const slice = ids.slice(i, i + CHUNK_SIZE)
    const { error, count } = await admin.from(table).delete().in(column, slice)
    if (error) throw new Error(`[${table}] ${error.message}`)
    total += count ?? 0
  }
  return total
}

export async function analyzeCatalogResetAction(): Promise<
  CatalogResetAnalysis | { ok: false; error: string; __diagnostic?: Record<string, unknown> }
> {
  const diag: Record<string, unknown> = { step: 'analyze' }
  try {
    const userData = await getProfileContext()
    if (!userData.activeProfileId) {
      return { ok: false, error: 'No hay perfil activo.' }
    }
    const supabase = await createClient()
    const membership = await assertProfileMembership(supabase, userData.activeProfileId, { minRole: 'admin' })
    if (!membership.ok) return { ok: false, error: membership.reason }

    const admin = createServiceRoleClient()

    // 1. Productos scrapping total
    const { count: productosScrapping } = await admin
      .from('catalog_products')
      .select('id', { count: 'exact', head: true })
      .in('source_system', ['scrapping_homologation', 'scrapping_homologation_v2'])

    // 2. Productos con stock
    const { data: stockRows } = await admin
      .from('catalog_items')
      .select('catalog_product_id')
      .not('catalog_product_id', 'is', null)
    const productsWithStock = new Set(((stockRows ?? []) as Array<{ catalog_product_id: string }>).map((r) => r.catalog_product_id))

    // 3. Productos con movimientos
    const { data: moveRows } = await admin
      .from('stock_movements')
      .select('product_id')
      .not('product_id', 'is', null)
    const productsWithMovements = new Set(((moveRows ?? []) as Array<{ product_id: string }>).map((r) => r.product_id))

    // 4. IDs scrapping
    const { data: scrappingProducts } = await admin
      .from('catalog_products')
      .select('id')
      .in('source_system', ['scrapping_homologation', 'scrapping_homologation_v2'])
    const scrappingIds = ((scrappingProducts ?? []) as Array<{ id: string }>).map((p) => p.id)

    let productosConStock = 0
    let productosConMovimientos = 0
    for (const id of scrappingIds) {
      if (productsWithStock.has(id)) productosConStock++
      if (productsWithMovements.has(id)) productosConMovimientos++
    }
    const productosSegurosBorrar = Math.max(0, scrappingIds.length - productosConStock - productosConMovimientos)

    // 5. Marcas seguras
    const { data: brandRows } = await admin.from('catalog_brands').select('id, name')
    const allBrands = (brandRows ?? []) as Array<{ id: string; name: string }>
    const { data: brandUsage } = await admin
      .from('catalog_products')
      .select('brand_id, source_system')
      .not('brand_id', 'is', null)
    const brandSources = new Map<string, Set<string>>()
    for (const r of (brandUsage ?? []) as Array<{ brand_id: string; source_system: string }>) {
      const s = brandSources.get(r.brand_id) ?? new Set<string>()
      s.add(r.source_system)
      brandSources.set(r.brand_id, s)
    }
    const marcasSegurasBorrar = allBrands.filter((b) => {
      const sources = brandSources.get(b.id)
      return sources && sources.size === 1 && sources.has('scrapping_homologation')
    })

    // 6. Secciones solo scrapping
    const { data: sectionProducts } = await admin
      .from('catalog_products')
      .select('section_id, source_system')
      .not('section_id', 'is', null)
    const sectionSources = new Map<string, Set<string>>()
    for (const r of (sectionProducts ?? []) as Array<{ section_id: string; source_system: string }>) {
      const s = sectionSources.get(r.section_id) ?? new Set<string>()
      s.add(r.source_system)
      sectionSources.set(r.section_id, s)
    }
    const seccionesSoloScrapping = [...sectionSources.entries()].filter(
      ([, sources]) => sources.size === 1 && sources.has('scrapping_homologation')
    ).length

    // 7. Categorias solo scrapping
    const { data: catProducts } = await admin
      .from('catalog_products')
      .select('category_id, source_system')
      .not('category_id', 'is', null)
    const catSources = new Map<string, Set<string>>()
    for (const r of (catProducts ?? []) as Array<{ category_id: string; source_system: string }>) {
      const s = catSources.get(r.category_id) ?? new Set<string>()
      s.add(r.source_system)
      catSources.set(r.category_id, s)
    }
    const categoriasSoloScrapping = [...catSources.entries()].filter(
      ([, sources]) => sources.size === 1 && sources.has('scrapping_homologation')
    ).length

    const { count: retailSnapshots } = await admin.from('catalog_retail_snapshots').select('*', { count: 'exact', head: true })
    const { count: retailLinks } = await admin.from('catalog_retail_links').select('*', { count: 'exact', head: true })
    const { count: mediaFiles } = await admin.from('catalog_product_media').select('*', { count: 'exact', head: true })
    const { count: scrappingPendingNew } = await admin.from('scrapping').select('*', { count: 'exact', head: true }).eq('catalog_match_status', 'pending_new')
    const { count: scrappingMatched } = await admin.from('scrapping').select('*', { count: 'exact', head: true }).eq('catalog_match_status', 'matched')

    return {
      ok: true,
      productosScrapping: productosScrapping ?? 0,
      productosConStock,
      productosConMovimientos,
      productosSegurosBorrar,
      marcasScrapping: allBrands.length,
      marcasSegurasBorrar: marcasSegurasBorrar.length,
      seccionesSoloScrapping,
      categoriasSoloScrapping,
      retailSnapshots: retailSnapshots ?? 0,
      retailLinks: retailLinks ?? 0,
      mediaFiles: mediaFiles ?? 0,
      scrappingPendingNew: scrappingPendingNew ?? 0,
      scrappingMatched: scrappingMatched ?? 0,
      __diagnostic: diag,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic'), __diagnostic: { ...diag, exception: msg } }
  }
}

/**
 * Ejecuta borrado controlado del catalogo creado por scrapping.
 * PRESERVA productos con stock o movimientos de stock.
 * PRESERVA secciones/categorias/marcas que tengan productos manuales.
 * Restaura scrapping matched a pending_new.
 */
export async function executeCatalogResetAction(): Promise<
  CatalogResetResult | { ok: false; error: string; __diagnostic?: Record<string, unknown> }
> {
  const diag: Record<string, unknown> = { step: 'execute' }
  try {
    const userData = await getProfileContext()
    if (!userData.activeProfileId) {
      return { ok: false, error: 'No hay perfil activo.' }
    }
    const supabase = await createClient()
    const membership = await assertProfileMembership(supabase, userData.activeProfileId, { minRole: 'admin' })
    if (!membership.ok) return { ok: false, error: membership.reason }

    const admin = createServiceRoleClient()
    logger.info({}, '[catalog-reset] inicio de borrado controlado')

    // --- Paso A: determinar IDs seguros (scrapping sin stock ni movimientos) ---
    const { data: stockRows } = await admin
      .from('catalog_items')
      .select('catalog_product_id')
      .not('catalog_product_id', 'is', null)
    const productsWithStock = new Set(((stockRows ?? []) as Array<{ catalog_product_id: string }>).map((r) => r.catalog_product_id))

    const { data: moveRows } = await admin
      .from('stock_movements')
      .select('product_id')
      .not('product_id', 'is', null)
    const productsWithMovements = new Set(((moveRows ?? []) as Array<{ product_id: string }>).map((r) => r.product_id))

    const { data: scrappingProducts } = await admin
      .from('catalog_products')
      .select('id, brand_id, section_id, category_id')
      .in('source_system', ['scrapping_homologation', 'scrapping_homologation_v2'])
    const scrappingRows = (scrappingProducts ?? []) as Array<{
      id: string
      brand_id: string | null
      section_id: string | null
      category_id: string | null
    }>

    const safeProductIds: string[] = []
    const safeBrandIds = new Set<string>()
    const safeSectionIds = new Set<string>()
    const safeCategoryIds = new Set<string>()

    for (const p of scrappingRows) {
      if (productsWithStock.has(p.id) || productsWithMovements.has(p.id)) continue
      safeProductIds.push(p.id)
      if (p.brand_id) safeBrandIds.add(p.brand_id)
      if (p.section_id) safeSectionIds.add(p.section_id)
      if (p.category_id) safeCategoryIds.add(p.category_id)
    }

    diag.safeProductCount = safeProductIds.length
    diag.withStockSkipped = productsWithStock.size
    diag.withMovementsSkipped = productsWithMovements.size
    logger.info({ safeProducts: safeProductIds.length }, '[catalog-reset] productos seguros identificados')

    if (safeProductIds.length === 0) {
      return {
        ok: true,
        deletedProducts: 0,
        deletedAliases: 0,
        deletedMedia: 0,
        deletedRetailLinks: 0,
        deletedRetailSnapshots: 0,
        deletedBrands: 0,
        deletedCategories: 0,
        deletedSections: 0,
        restoredPendingNew: 0,
        __diagnostic: diag,
      }
    }

    // --- Paso B: borrar dependencias por chunks ---
    const deletedMedia = await chunkDeleteIn(admin, 'catalog_product_media', 'catalog_product_id', safeProductIds)
    logger.info({ deletedMedia }, '[catalog-reset] media borrada')

    const deletedAliases = await chunkDeleteIn(admin, 'catalog_product_aliases', 'catalog_product_id', safeProductIds)
    logger.info({ deletedAliases }, '[catalog-reset] aliases borrados')

    const deletedRetailLinks = await chunkDeleteIn(admin, 'catalog_retail_links', 'catalog_product_id', safeProductIds)
    logger.info({ deletedRetailLinks }, '[catalog-reset] retail links borrados')

    // catalog_retail_snapshots: buscar external_refs de los productos que borraremos
    const { data: linkRows } = await admin
      .from('catalog_retail_links')
      .select('external_ref')
      .in('catalog_product_id', safeProductIds.slice(0, CHUNK_SIZE))
    // Nota: ya borramos los links arriba; necesitabamos los refs ANTES de borrar.
    // Pero como ya los borramos, usamos los scrapping rows originales para obtener external_refs.
    // En realidad, los external_refs estan en scrapping. Usamos una consulta a scrapping.

    const { data: scrappingRefs } = await admin
      .from('scrapping')
      .select('external_ref')
      .in('matched_catalog_product_id', safeProductIds)
      .not('external_ref', 'is', null)
    const externalRefs = [...new Set(((scrappingRefs ?? []) as Array<{ external_ref: string }>).map((r) => r.external_ref))]
    let deletedRetailSnapshots = 0
    if (externalRefs.length > 0) {
      deletedRetailSnapshots = await chunkDeleteIn(admin, 'catalog_retail_snapshots', 'external_ref', externalRefs)
    }
    logger.info({ deletedRetailSnapshots }, '[catalog-reset] retail snapshots borrados')

    // --- Paso C: borrar catalog_products ---
    const deletedProducts = await chunkDeleteIn(admin, 'catalog_products', 'id', safeProductIds)
    logger.info({ deletedProducts }, '[catalog-reset] productos borrados')

    // --- Paso D: borrar marcas que ahora no tienen productos ---
    let deletedBrands = 0
    if (safeBrandIds.size > 0) {
      const brandIds = [...safeBrandIds]
      const { data: stillUsedBrands } = await admin
        .from('catalog_products')
        .select('brand_id')
        .in('brand_id', brandIds)
      const usedBrandIds = new Set(((stillUsedBrands ?? []) as Array<{ brand_id: string }>).map((r) => r.brand_id))
      const orphanBrands = brandIds.filter((b) => !usedBrandIds.has(b))
      if (orphanBrands.length > 0) {
        deletedBrands = await chunkDeleteIn(admin, 'catalog_brands', 'id', orphanBrands)
      }
    }
    logger.info({ deletedBrands }, '[catalog-reset] marcas borradas')

    // --- Paso E: borrar categorias que ahora no tienen productos ---
    let deletedCategories = 0
    if (safeCategoryIds.size > 0) {
      const catIds = [...safeCategoryIds]
      const { data: stillUsedCats } = await admin
        .from('catalog_products')
        .select('category_id')
        .in('category_id', catIds)
      const usedCatIds = new Set(((stillUsedCats ?? []) as Array<{ category_id: string }>).map((r) => r.category_id))
      const orphanCats = catIds.filter((c) => !usedCatIds.has(c))
      if (orphanCats.length > 0) {
        deletedCategories = await chunkDeleteIn(admin, 'categories', 'id', orphanCats)
      }
    }
    logger.info({ deletedCategories }, '[catalog-reset] categorias borradas')

    // --- Paso F: borrar secciones que ahora no tienen categorias ---
    let deletedSections = 0
    if (safeSectionIds.size > 0) {
      const secIds = [...safeSectionIds]
      const { data: stillUsedSecs } = await admin
        .from('categories')
        .select('section_id')
        .in('section_id', secIds)
      const usedSecIds = new Set(((stillUsedSecs ?? []) as Array<{ section_id: string }>).map((r) => r.section_id))
      const orphanSecs = secIds.filter((s) => !usedSecIds.has(s))
      if (orphanSecs.length > 0) {
        deletedSections = await chunkDeleteIn(admin, 'sections', 'id', orphanSecs)
      }
    }
    logger.info({ deletedSections }, '[catalog-reset] secciones borradas')

    // --- Paso G: restaurar scrapping matched a pending_new ---
    const { error: updErr } = await admin
      .from('scrapping')
      .update({
        catalog_match_status: 'pending_new',
        matched_catalog_product_id: null,
        catalog_matched_at: null,
        homolog_final_status: null,
        homolog_reviewed_at: null,
      } as never)
      .eq('catalog_match_status', 'matched')
    if (updErr) {
      logger.error({ err: updErr.message }, '[catalog-reset] error restaurando scrapping a pending_new')
    }
    const { count: restoredPendingNew } = await admin
      .from('scrapping')
      .select('*', { count: 'exact', head: true })
      .eq('catalog_match_status', 'pending_new')

    logger.info({ restoredPendingNew: restoredPendingNew ?? 0 }, '[catalog-reset] finalizado')

    return {
      ok: true,
      deletedProducts,
      deletedAliases,
      deletedMedia,
      deletedRetailLinks,
      deletedRetailSnapshots,
      deletedBrands,
      deletedCategories,
      deletedSections,
      restoredPendingNew: restoredPendingNew ?? 0,
      __diagnostic: diag,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logger.error({ err: msg }, '[catalog-reset] excepcion')
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic'), __diagnostic: { ...diag, exception: msg } }
  }
}
