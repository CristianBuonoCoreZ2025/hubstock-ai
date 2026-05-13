'use server'

import { revalidatePath } from 'next/cache'
import { assertProfileMembership } from '@/lib/profile/membership'
import { getProfileContext } from '@/lib/profile/context'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/server/supabase-admin'
import { getUserFriendlyErrorMessage } from '@/lib/user-friendly-errors'
import { normalizeLiderSectionKeyStrong } from '@/lib/lider-taxonomy-section-heuristics'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  mergeLiderDiscoveredCategoryLists,
  runLiderTaxonomyTwoPhaseDiscovery,
} from '@/server/retail/capture/lider-taxonomy-two-phase-discovery'
import { buildLiderTaxonomyDiscoveryReportText } from '@/server/retail/capture/lider-discovery-report-text'
import {
  applyFuzzyCategorySuggestionsForLider,
  applyFuzzyMasterSectionMatchForLider,
  areLiderSectionsResolvedForCategoryPhase,
  countBlockingLiderTaxonomyMappings,
  fetchLiderBlockingLiderSections,
  fetchLiderTaxonomyLiderSectionRows,
  fetchLiderTaxonomyMappingsGroupedByLinkedLiderSections,
  fetchLiderTaxonomyMappingsForLiderSection,
  promoteExactSuggestedLiderCategoryMappingsToLinked,
  refreshLiderTaxonomyProductsCountsFromCaptures,
  syncLiderRetailCategoryMappingsFromPlanUrls,
  upsertLiderCategoryMappings,
  upsertLiderDiscoveredSections,
  buildMasterCategoryAutoMatchByLiderSection,
  discoverLiderCategoriesFromCapturedProducts,
  discoverLiderCategoriesFromCaptureBrowseUrls,
  type RetailTaxonomyLiderSectionRow,
  type RetailTaxonomyMappingRow,
} from '@/server/retail/taxonomy/lider-taxonomy-service'

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
      error: 'No se pudo inicializar el cliente de administración.',
    }
  }
}

export type RetailTaxonomyMappingUiRow = RetailTaxonomyMappingRow & {
  master_category_name?: string | null
  master_section_name?: string | null
}

/**
 * Ejecuta el mismo descubrimiento que la taxonomía Lider y devuelve texto plano
 * (secciones + categorías inferidas desde URLs, sin productos).
 * En desarrollo también escribe `logs/lider-discovery-latest.txt`.
 */
export async function generateLiderDiscoveryPreviewLogAction(): Promise<
  | { ok: true; text: string; savedRelativePath: string | null }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  try {
    const discovery = await runLiderTaxonomyTwoPhaseDiscovery()
    const text = buildLiderTaxonomyDiscoveryReportText(discovery)

    let savedRelativePath: string | null = null
    if (process.env.NODE_ENV === 'development') {
      const dir = path.join(process.cwd(), 'logs')
      await mkdir(dir, { recursive: true })
      const rel = path.join('logs', 'lider-discovery-latest.txt')
      await writeFile(path.join(process.cwd(), rel), text, 'utf8')
      savedRelativePath = rel.split(path.sep).join('/')
    }

    return { ok: true, text, savedRelativePath }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

/**
 * Fase 1: secciones Lider. Fase 2: categorías por sección (solo tras persistir secciones).
 */
export async function detectLiderRetailTaxonomyAction(): Promise<
  | {
      ok: true
      sections: number
      categories: number
      categoriesDeferred: boolean
      masterCatalogMappingsSeeded: number
    }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  try {
    const { sections: discoveredSections, categories } = await runLiderTaxonomyTwoPhaseDiscovery()
    await upsertLiderDiscoveredSections(editor.admin, discoveredSections)
    await applyFuzzyMasterSectionMatchForLider(editor.admin)

    const displayByNorm = new Map(discoveredSections.map((s) => [s.normalized_external_section, s.external_section]))
    const sectionsResolved = await areLiderSectionsResolvedForCategoryPhase(editor.admin)

    let masterCatalogMappingsSeeded = 0
    let mergedCategoryCount = 0
    if (sectionsResolved) {
      const { data: linkedNormRows, error: lnErr } = await editor.admin
        .from('retail_taxonomy_lider_sections')
        .select('normalized_external_section')
        .eq('retailer', 'lider')
        .eq('status', 'linked')

      if (lnErr) {
        return { ok: false, error: getUserFriendlyErrorMessage(lnErr, 'generic') }
      }

      const linkedNorms = new Set(
        (linkedNormRows ?? []).map((r: { normalized_external_section: string }) => r.normalized_external_section),
      )
      const fromCaps = await discoverLiderCategoriesFromCapturedProducts(editor.admin, linkedNorms)
      const fromBrowseCaptures = await discoverLiderCategoriesFromCaptureBrowseUrls(editor.admin, linkedNorms)
      const mergedCategories = mergeLiderDiscoveredCategoryLists(
        mergeLiderDiscoveredCategoryLists(categories, fromCaps),
        fromBrowseCaptures,
      )
      mergedCategoryCount = mergedCategories.length

      const masterAuto = await buildMasterCategoryAutoMatchByLiderSection(editor.admin)
      const { autoMatchedExistingMaster } = await upsertLiderCategoryMappings(
        editor.admin,
        displayByNorm,
        mergedCategories,
        masterAuto,
      )
      masterCatalogMappingsSeeded = autoMatchedExistingMaster
      await applyFuzzyCategorySuggestionsForLider(editor.admin)
    }

    await promoteExactSuggestedLiderCategoryMappingsToLinked(editor.admin)
    await refreshLiderTaxonomyProductsCountsFromCaptures(editor.admin)

    revalidatePath('/catalog')
    revalidatePath('/precios-cadenas')
    return {
      ok: true,
      sections: discoveredSections.length,
      categories: sectionsResolved ? mergedCategoryCount : 0,
      categoriesDeferred: !sectionsResolved,
      masterCatalogMappingsSeeded: sectionsResolved ? masterCatalogMappingsSeeded : 0,
    }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

/**
 * Solo fase categorías: inferencia desde URLs del plan, productos capturados y coincidencia con categorías maestras existentes.
 */
export async function syncLiderRetailCategoriesFromPlanUrlsAction(): Promise<
  | {
      ok: true
      discoveredCategoryRows: number
      mappingsUpsertTouched: number
      masterCatalogMappingsInserted: number
      capturesCategoryPairs: number
    }
  | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const result = await syncLiderRetailCategoryMappingsFromPlanUrls(editor.admin)
  if (!result.ok) return { ok: false, error: result.error }

  revalidatePath('/catalog')
  revalidatePath('/precios-cadenas')
  return {
    ok: true,
    discoveredCategoryRows: result.discoveredCategoryRows,
    mappingsUpsertTouched: result.mappingsUpsertTouched,
    masterCatalogMappingsInserted: result.masterCatalogMappingsInserted,
    capturesCategoryPairs: result.capturesCategoryPairs,
  }
}

export async function fetchLiderRetailTaxonomyBlockingAction(): Promise<
  { ok: true; blocking: boolean; blockingCount: number } | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }
  const blockingCount = await countBlockingLiderTaxonomyMappings(editor.admin)
  return { ok: true, blocking: blockingCount > 0, blockingCount }
}

export async function fetchLiderRetailTaxonomySectionsAction(): Promise<
  { ok: true; sections: RetailTaxonomyLiderSectionRow[] } | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }
  const sections = await fetchLiderTaxonomyLiderSectionRows(editor.admin)
  return { ok: true, sections }
}

export async function fetchLiderRetailTaxonomyCategoriesForLiderSectionAction(input: {
  liderSectionId: string
}): Promise<{ ok: true; rows: RetailTaxonomyMappingUiRow[] } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }
  const rows = await fetchLiderTaxonomyMappingsForLiderSection(editor.admin, input.liderSectionId.trim())
  return { ok: true, rows }
}

/** Categorías agrupadas por sección Lider vinculada (para la grilla principal). */
export async function fetchLiderRetailTaxonomyCategoriesByLinkedSectionsAction(): Promise<
  { ok: true; bySectionId: Record<string, RetailTaxonomyMappingUiRow[]> } | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }
  try {
    const by = await fetchLiderTaxonomyMappingsGroupedByLinkedLiderSections(editor.admin)
    return { ok: true, bySectionId: by as Record<string, RetailTaxonomyMappingUiRow[]> }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

export async function fetchLiderRetailTaxonomyBlockingSectionsAction(): Promise<
  { ok: true; rows: RetailTaxonomyLiderSectionRow[] } | { ok: false; error: string }
> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }
  const rows = await fetchLiderBlockingLiderSections(editor.admin)
  return { ok: true, rows }
}

export async function approveLiderRetailTaxonomyLiderSectionAction(input: {
  liderSectionId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const { data: row, error: qe } = await editor.admin
    .from('retail_taxonomy_lider_sections')
    .select('id, status, section_id')
    .eq('id', input.liderSectionId)
    .maybeSingle()

  if (qe || !row) return { ok: false, error: 'No se encontró la sección Lider.' }
  const r = row as { status: string; section_id: string | null }
  if (r.status === 'ignored' || r.status === 'discarded' || r.status === 'linked') {
    return { ok: false, error: 'Esta fila no se puede aprobar en el estado actual.' }
  }
  if (!r.section_id) {
    return { ok: false, error: 'No hay sección maestra sugerida; vinculá manualmente primero.' }
  }

  const { error } = await editor.admin
    .from('retail_taxonomy_lider_sections')
    .update({
      status: 'linked',
      confidence: 1,
      reason: 'Sección maestra aprobada.',
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', input.liderSectionId)

  if (error) return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  revalidatePath('/catalog')
  revalidatePath('/precios-cadenas')
  return { ok: true }
}

export async function linkLiderRetailTaxonomyLiderSectionAction(input: {
  liderSectionId: string
  masterSectionId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const { data: ms, error: se } = await editor.admin
    .from('sections')
    .select('id')
    .eq('id', input.masterSectionId)
    .maybeSingle()
  if (se || !ms) return { ok: false, error: 'Sección maestra no válida.' }

  const { error } = await editor.admin
    .from('retail_taxonomy_lider_sections')
    .update({
      section_id: input.masterSectionId,
      status: 'suggested',
      confidence: 0.98,
      reason: 'Vinculación manual pendiente de aprobación.',
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', input.liderSectionId)
    .in('status', ['pending', 'missing', 'suggested'])

  if (error) return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  revalidatePath('/catalog')
  revalidatePath('/precios-cadenas')
  return { ok: true }
}

export async function ignoreLiderRetailTaxonomyLiderSectionAction(input: {
  liderSectionId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const { error } = await editor.admin
    .from('retail_taxonomy_lider_sections')
    .update({
      status: 'ignored',
      reason: 'Sección Lider ignorada (no se usará para homologación).',
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', input.liderSectionId)
    .in('status', ['pending', 'missing', 'suggested'])

  if (error) return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  revalidatePath('/catalog')
  revalidatePath('/precios-cadenas')
  return { ok: true }
}

export async function discardLiderRetailTaxonomyLiderSectionAction(input: {
  liderSectionId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const { error } = await editor.admin
    .from('retail_taxonomy_lider_sections')
    .update({
      status: 'discarded',
      reason: 'Descartada como sin evidencia o basura de navegación.',
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', input.liderSectionId)
    .in('status', ['pending', 'missing', 'suggested'])

  if (error) return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  revalidatePath('/catalog')
  revalidatePath('/precios-cadenas')
  return { ok: true }
}

/**
 * Crea una fila en `public.sections` y la vincula a la sección Lider detectada.
 * No se hace en automático: el catálogo maestro es global y conviene confirmar nombre y evitar duplicados.
 * Cualquier fila en pendiente, faltante o sugerido puede usar esta acción para destrabar homologación y productos.
 */
export async function createMasterSectionFromLiderTaxonomySectionAction(input: {
  liderSectionId: string
  name?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const lid = input.liderSectionId.trim()
  if (!lid) return { ok: false, error: 'Identificador inválido.' }

  const { data: row, error: qe } = await editor.admin
    .from('retail_taxonomy_lider_sections')
    .select('id, external_section, normalized_external_section, status, section_id')
    .eq('id', lid)
    .maybeSingle()

  if (qe || !row) return { ok: false, error: 'No se encontró la sección Lider.' }

  const r = row as {
    id: string
    external_section: string
    normalized_external_section: string
    status: string
    section_id: string | null
  }

  if (r.status === 'linked') {
    return { ok: false, error: 'Esta sección Lider ya está vinculada.' }
  }
  if (r.status === 'ignored' || r.status === 'discarded') {
    return {
      ok: false,
      error: 'Esta fila está ignorada o descartada. Cambiá el estado antes de crear una sección maestra.',
    }
  }
  if (!['pending', 'missing', 'suggested'].includes(r.status)) {
    return { ok: false, error: 'Esta fila no admite crear sección maestra en el estado actual.' }
  }

  const label = (input.name?.trim() || r.external_section).trim()
  if (!label) return { ok: false, error: 'Completa el nombre de la sección maestra.' }

  const labelKey = normalizeLiderSectionKeyStrong(label)
  const { data: secList, error: se } = await editor.admin.from('sections').select('id, name').limit(800)
  if (se) return { ok: false, error: getUserFriendlyErrorMessage(se, 'generic') }
  for (const s of (secList ?? []) as { id: string; name: string }[]) {
    if (normalizeLiderSectionKeyStrong(s.name) === labelKey) {
      return {
        ok: false,
        error:
          'Ya existe una sección maestra con un nombre equivalente. Usá «Sugerir sección maestra» para enlazarla.',
      }
    }
  }

  const { data: maxData, error: mxErr } = await editor.admin
    .from('sections')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (mxErr) return { ok: false, error: getUserFriendlyErrorMessage(mxErr, 'generic') }
  const sort_order = (((maxData as { sort_order?: number } | null)?.sort_order) ?? -1) + 1

  const { data: ins, error: insErr } = await editor.admin
    .from('sections')
    .insert({ name: label, sort_order } as never)
    .select('id')
    .single()

  if (insErr || !ins) {
    return { ok: false, error: getUserFriendlyErrorMessage(insErr ?? new Error('insert'), 'section') }
  }

  const newSectionId = (ins as { id: string }).id

  const { error: upErr } = await editor.admin
    .from('retail_taxonomy_lider_sections')
    .update({
      section_id: newSectionId,
      status: 'linked',
      confidence: 1,
      reason: 'Sección maestra creada en el catálogo y vinculada a la sección Lider detectada.',
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', lid)

  if (upErr) return { ok: false, error: getUserFriendlyErrorMessage(upErr, 'generic') }

  revalidatePath('/catalog')
  revalidatePath('/precios-cadenas')
  return { ok: true }
}

export async function approveLiderRetailTaxonomyMappingAction(input: {
  mappingId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const { data: row, error: qe } = await editor.admin
    .from('retail_taxonomy_mappings')
    .select('id, status, section_id, category_id, lider_section_id')
    .eq('id', input.mappingId)
    .maybeSingle()

  if (qe || !row) return { ok: false, error: 'No se encontró el mapeo.' }
  const r = row as {
    status: string
    section_id: string | null
    category_id: string | null
    lider_section_id: string | null
  }
  if (r.status === 'ignored' || r.status === 'linked') {
    return { ok: false, error: 'Este mapeo ya está cerrado.' }
  }
  if (!r.section_id || !r.category_id || !r.lider_section_id) {
    return { ok: false, error: 'No hay categoría maestra asignada para aprobar.' }
  }

  const { data: ls } = await editor.admin
    .from('retail_taxonomy_lider_sections')
    .select('status, section_id')
    .eq('id', r.lider_section_id)
    .maybeSingle()
  const lsec = ls as { status: string; section_id: string | null } | null
  if (!lsec || !lsec.section_id || lsec.section_id !== r.section_id || lsec.status !== 'linked') {
    return {
      ok: false,
      error: 'La sección Lider debe estar aprobada como vinculada antes de aprobar categorías.',
    }
  }

  const { error } = await editor.admin
    .from('retail_taxonomy_mappings')
    .update({
      status: 'linked',
      confidence: 1,
      reason: 'Aprobado manualmente.',
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', input.mappingId)

  if (error) return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  revalidatePath('/catalog')
  revalidatePath('/precios-cadenas')
  return { ok: true }
}

export async function ignoreLiderRetailTaxonomyMappingAction(input: {
  mappingId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const { error } = await editor.admin
    .from('retail_taxonomy_mappings')
    .update({
      status: 'ignored',
      reason: 'Ignorado por el usuario (no se crean productos con esta categoría Lider).',
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', input.mappingId)
    .in('status', ['pending', 'missing', 'suggested'])

  if (error) return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  revalidatePath('/catalog')
  revalidatePath('/precios-cadenas')
  return { ok: true }
}

export async function discardLiderRetailTaxonomyMappingAction(input: {
  mappingId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const { data: cur, error: qe } = await editor.admin
    .from('retail_taxonomy_mappings')
    .select('id, status')
    .eq('id', input.mappingId)
    .eq('retailer', 'lider')
    .maybeSingle()

  if (qe || !cur) return { ok: false, error: 'No se encontró el mapeo.' }
  const st = (cur as { status: string }).status
  if (!['pending', 'missing', 'suggested'].includes(st)) {
    return {
      ok: false,
      error: 'Solo se pueden descartar mapeos pendientes, sugeridos o faltantes.',
    }
  }

  const { error } = await editor.admin.from('retail_taxonomy_mappings').delete().eq('id', input.mappingId)

  if (error) return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  revalidatePath('/catalog')
  revalidatePath('/precios-cadenas')
  return { ok: true }
}

export async function fetchMasterCategoriesForLinkedLiderSectionAction(input: {
  liderSectionId: string
}): Promise<{ ok: true; categories: { id: string; name: string }[] } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const lid = input.liderSectionId.trim()
  if (!lid) return { ok: false, error: 'Sección Lider no válida.' }

  const { data: ls, error: le } = await editor.admin
    .from('retail_taxonomy_lider_sections')
    .select('id, status, section_id')
    .eq('id', lid)
    .eq('retailer', 'lider')
    .maybeSingle()

  if (le || !ls) return { ok: false, error: 'No se encontró la sección Lider.' }
  const row = ls as { status: string; section_id: string | null }
  if (row.status !== 'linked' || !row.section_id) {
    return { ok: false, error: 'La sección Lider debe estar vinculada para listar categorías maestras.' }
  }

  const { data: cats, error: ce } = await editor.admin
    .from('categories')
    .select('id, name')
    .eq('section_id', row.section_id)
    .order('name', { ascending: true })
    .limit(400)

  if (ce) return { ok: false, error: getUserFriendlyErrorMessage(ce, 'generic') }
  return { ok: true, categories: (cats ?? []) as { id: string; name: string }[] }
}

export async function linkLiderRetailTaxonomyMappingToMasterCategoryAction(input: {
  mappingId: string
  categoryId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const mappingId = input.mappingId.trim()
  const categoryId = input.categoryId.trim()
  if (!mappingId || !categoryId) {
    return { ok: false, error: 'Elegí una categoría maestra antes de guardar.' }
  }

  const { data: mapRow, error: me } = await editor.admin
    .from('retail_taxonomy_mappings')
    .select('id, status, lider_section_id')
    .eq('id', mappingId)
    .eq('retailer', 'lider')
    .maybeSingle()
  if (me || !mapRow) return { ok: false, error: 'No se encontró el mapeo.' }
  const m = mapRow as { status: string; lider_section_id: string | null }
  if (m.status === 'linked' || m.status === 'ignored') {
    return { ok: false, error: 'Este mapeo ya está cerrado.' }
  }
  if (!m.lider_section_id) return { ok: false, error: 'Mapeo sin sección Lider asociada.' }

  const { data: ls, error: le } = await editor.admin
    .from('retail_taxonomy_lider_sections')
    .select('section_id, status')
    .eq('id', m.lider_section_id)
    .maybeSingle()
  if (le || !ls) return { ok: false, error: 'No se encontró la sección Lider padre.' }
  const lsec = ls as { section_id: string | null; status: string }
  if (!lsec.section_id || lsec.status !== 'linked') {
    return { ok: false, error: 'La sección Lider debe estar vinculada.' }
  }
  const masterSectionId = lsec.section_id

  const { data: cat, error: ce } = await editor.admin
    .from('categories')
    .select('id, section_id')
    .eq('id', categoryId)
    .maybeSingle()
  if (ce || !cat) return { ok: false, error: 'No se encontró la categoría maestra.' }
  const c = cat as { id: string; section_id: string }
  if (c.section_id !== masterSectionId) {
    return {
      ok: false,
      error: 'La categoría debe pertenecer a la misma sección maestra vinculada a esta sección Lider.',
    }
  }

  const { error } = await editor.admin
    .from('retail_taxonomy_mappings')
    .update({
      section_id: masterSectionId,
      category_id: categoryId,
      status: 'suggested',
      confidence: 1,
      match_method: 'manual_master_category_pick',
      reason: 'Usuario eligió categoría maestra existente en la sección vinculada.',
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', mappingId)
    .in('status', ['pending', 'missing', 'suggested'])

  if (error) return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
  revalidatePath('/catalog')
  revalidatePath('/precios-cadenas')
  return { ok: true }
}

export async function createCategoryAndLinkLiderTaxonomyAction(input: {
  mappingId: string
  categoryName: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const editor = await requireCatalogEditorRetail()
  if (!editor.ok) return { ok: false, error: editor.error }

  const name = input.categoryName.trim()
  if (!name) return { ok: false, error: 'Completa el nombre de la categoría.' }

  const { data: mapRow, error: me } = await editor.admin
    .from('retail_taxonomy_mappings')
    .select('id, status, lider_section_id')
    .eq('id', input.mappingId)
    .maybeSingle()
  if (me || !mapRow) return { ok: false, error: 'No se encontró el mapeo.' }
  if ((mapRow as { status: string }).status === 'linked') {
    return { ok: false, error: 'Este mapeo ya está vinculado.' }
  }

  const lid = (mapRow as { lider_section_id: string | null }).lider_section_id
  if (!lid) {
    return { ok: false, error: 'Mapeo sin sección Lider asociada.' }
  }

  const { data: lsRow, error: le } = await editor.admin
    .from('retail_taxonomy_lider_sections')
    .select('section_id, status')
    .eq('id', lid)
    .maybeSingle()
  if (le || !lsRow) return { ok: false, error: 'No se encontró la sección Lider padre.' }
  const masterSectionId = (lsRow as { section_id: string | null; status: string }).section_id
  const lsStatus = (lsRow as { status: string }).status
  if (!masterSectionId || lsStatus !== 'linked') {
    return {
      ok: false,
      error: 'Primero aprobá o vinculá la sección Lider a una sección maestra (estado vinculado).',
    }
  }

  const { data: maxData } = await editor.admin
    .from('categories')
    .select('sort_order')
    .eq('section_id', masterSectionId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const sort_order = ((maxData as { sort_order?: number } | null)?.sort_order ?? -1) + 1

  const { data: ins, error: insErr } = await editor.admin
    .from('categories')
    .insert({
      section_id: masterSectionId,
      name,
      sort_order,
    } as never)
    .select('id')
    .single()

  if (insErr || !ins) {
    return { ok: false, error: getUserFriendlyErrorMessage(insErr ?? new Error('insert'), 'category') }
  }
  const categoryId = (ins as { id: string }).id

  const { error: upErr } = await editor.admin
    .from('retail_taxonomy_mappings')
    .update({
      section_id: masterSectionId,
      category_id: categoryId,
      status: 'linked',
      match_method: 'manual_new_category',
      confidence: 1,
      reason: 'Categoría maestra creada bajo la sección maestra vinculada a Lider.',
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', input.mappingId)

  if (upErr) return { ok: false, error: getUserFriendlyErrorMessage(upErr, 'generic') }
  revalidatePath('/catalog')
  revalidatePath('/precios-cadenas')
  return { ok: true }
}
