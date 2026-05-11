import type { SupabaseClient } from '@supabase/supabase-js'
import { taxonomyKeysFromLiderCapture, isLiderBrowsePathTailCollectionId } from '@/lib/lider-taxonomy'
import {
  isLiderRetailContentHubStrongKey,
  isProtectedCommercialLiderSection,
  liderTaxonomyDisplayContainsNumericCharacter,
  normalizeLiderCategoryKeyStrong,
  normalizeLiderSectionKeyStrong,
  shouldDiscardLiderCategoryLabel,
} from '@/lib/lider-taxonomy-section-heuristics'
import { normalizeSearchText } from '@/lib/search'
import { discoverLiderCapturePlanUrls } from '@/server/retail/capture/lider-catalog-plan'
import {
  discoverCategoriesFromUrlsForSections,
  enrichLiderPlanUrlsForCategoryDiscovery,
  mergeLiderDiscoveredCategoryLists,
  type LiderDiscoveredCategory,
  type LiderDiscoveredSection,
} from '@/server/retail/capture/lider-taxonomy-two-phase-discovery'

export const LIDER_SECTION_BLOCKING = ['pending', 'missing', 'suggested'] as const
export const LIDER_CATEGORY_BLOCKING = ['pending', 'missing', 'suggested'] as const

export type RetailTaxonomyLiderSectionRow = {
  id: string
  retailer: string
  external_section: string
  normalized_external_section: string
  source: string | null
  source_url: string | null
  products_count: number
  sample_urls: unknown
  sample_product_titles: unknown
  status: string
  section_id: string | null
  confidence: number | null
  reason: string | null
  created_at: string
  updated_at: string
  master_section_name?: string | null
}

export type RetailTaxonomyMappingRow = {
  id: string
  retailer: string
  lider_section_id: string | null
  external_section: string
  external_category: string
  normalized_external_section: string
  normalized_external_category: string
  section_id: string | null
  category_id: string | null
  status: string
  match_method: string | null
  confidence: number | null
  products_count: number
  reason: string | null
  created_at: string
  updated_at: string
}

export async function countBlockingLiderTaxonomyMappings(admin: SupabaseClient): Promise<number> {
  const { data: blockingSecs } = await admin
    .from('retail_taxonomy_lider_sections')
    .select('id, external_section')
    .eq('retailer', 'lider')
    .in('status', [...LIDER_SECTION_BLOCKING])
    .limit(500)

  let c1 = 0
  for (const s of (blockingSecs ?? []) as { external_section: string }[]) {
    if (!liderTaxonomyDisplayContainsNumericCharacter(s.external_section)) c1++
  }

  const { data: linkedSections } = await admin
    .from('retail_taxonomy_lider_sections')
    .select('id')
    .eq('retailer', 'lider')
    .eq('status', 'linked')

  const linkedIds = new Set((linkedSections ?? []).map((r: { id: string }) => r.id))

  const { data: mapRows } = await admin
    .from('retail_taxonomy_mappings')
    .select('id, lider_section_id, external_category')
    .eq('retailer', 'lider')
    .in('status', [...LIDER_CATEGORY_BLOCKING])

  let c2 = 0
  for (const m of (mapRows ?? []) as { id: string; lider_section_id: string | null; external_category: string }[]) {
    if (!m.lider_section_id || !linkedIds.has(m.lider_section_id)) continue
    if (liderTaxonomyDisplayContainsNumericCharacter(m.external_category)) continue
    c2++
  }

  return c1 + c2
}

/** Fase categorías solo cuando no queden secciones en pending, missing o suggested. */
export async function areLiderSectionsResolvedForCategoryPhase(admin: SupabaseClient): Promise<boolean> {
  const { data: rows } = await admin
    .from('retail_taxonomy_lider_sections')
    .select('id, external_section')
    .eq('retailer', 'lider')
    .in('status', [...LIDER_SECTION_BLOCKING])
    .limit(500)

  const relevant = (rows ?? []).filter(
    (r: { external_section: string }) => !liderTaxonomyDisplayContainsNumericCharacter(r.external_section),
  )
  return relevant.length === 0
}

export async function resolveLinkedLiderTaxonomyForCapture(
  admin: SupabaseClient,
  input: { source_url: string | null; category_hint: string | null },
): Promise<{ section_id: string; category_id: string } | null> {
  const keys = taxonomyKeysFromLiderCapture(input.source_url, input.category_hint)
  if (!keys) return null

  const { data: liderSec, error: e1 } = await admin
    .from('retail_taxonomy_lider_sections')
    .select('id, section_id')
    .eq('retailer', 'lider')
    .eq('normalized_external_section', keys.ns)
    .eq('status', 'linked')
    .maybeSingle()

  if (e1 || !liderSec) return null
  const ls = liderSec as { id: string; section_id: string | null }
  if (!ls.section_id) return null

  const { data: map, error: e2 } = await admin
    .from('retail_taxonomy_mappings')
    .select('section_id, category_id')
    .eq('retailer', 'lider')
    .eq('lider_section_id', ls.id)
    .eq('normalized_external_category', keys.nc)
    .eq('status', 'linked')
    .maybeSingle()

  if (e2 || !map) return null
  const row = map as { section_id: string | null; category_id: string | null }
  if (!row.section_id || !row.category_id) return null
  if (row.section_id !== ls.section_id) return null
  return { section_id: row.section_id, category_id: row.category_id }
}

type MasterSec = { id: string; name: string; norm: string }

function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  const dp = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) dp[j] = j
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[j] = Math.min(tmp + 1, dp[j - 1]! + 1, prev + cost)
      prev = tmp
    }
  }
  return dp[n]!
}

function stringSimilarityRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length, 1)
  return 1 - levenshteinDistance(a, b) / maxLen
}

/** Puntuación 0–1 para nombre Lider vs sección maestra ya normalizada con la misma regla fuerte. */
function fuzzySectionScore(needle: string, masterNorm: string): number {
  if (!needle || !masterNorm) return 0
  const ratio = stringSimilarityRatio(needle, masterNorm)
  if (needle.length >= 5 && masterNorm.length >= 5 && (needle.includes(masterNorm) || masterNorm.includes(needle))) {
    return Math.max(ratio, 0.93)
  }
  return ratio
}

function orderedTokenSignature(norm: string): string {
  return norm
    .split(' ')
    .map((t) => t.trim())
    .filter(Boolean)
    .sort()
    .join(' ')
}

/** Similitud nombre categoría Lider vs categoría maestra (misma sección), tolerante a orden de palabras. */
function fuzzyCategoryNameScore(needle: string, masterNorm: string): number {
  if (!needle || !masterNorm) return 0
  const sigN = orderedTokenSignature(needle)
  const sigM = orderedTokenSignature(masterNorm)
  if (sigN.length >= 5 && sigM.length >= 5 && sigN === sigM) return 0.96
  const ratio = stringSimilarityRatio(needle, masterNorm)
  if (needle.length >= 5 && masterNorm.length >= 5 && (needle.includes(masterNorm) || masterNorm.includes(needle))) {
    return Math.max(ratio, 0.91)
  }
  return ratio
}

async function loadMasterSections(admin: SupabaseClient): Promise<MasterSec[]> {
  const { data } = await admin.from('sections').select('id, name').limit(500)
  return ((data ?? []) as { id: string; name: string }[]).map((s) => ({
    id: s.id,
    name: s.name,
    norm: normalizeLiderSectionKeyStrong(s.name),
  }))
}

export async function applyFuzzyMasterSectionMatchForLider(admin: SupabaseClient): Promise<void> {
  const secs = await loadMasterSections(admin)
  const byNorm = new Map<string, MasterSec[]>()
  for (const s of secs) {
    if (!s.norm) continue
    const list = byNorm.get(s.norm) ?? []
    list.push(s)
    byNorm.set(s.norm, list)
  }

  const { data: rows } = await admin
    .from('retail_taxonomy_lider_sections')
    .select('id, external_section, normalized_external_section, status')
    .eq('retailer', 'lider')
    .in('status', ['pending', 'missing'])

  for (const r of (rows ?? []) as {
    id: string
    external_section: string
    normalized_external_section: string
    status: string
  }[]) {
    const ns = normalizeLiderSectionKeyStrong(r.external_section)
    if (ns !== r.normalized_external_section) {
      await admin
        .from('retail_taxonomy_lider_sections')
        .update({
          normalized_external_section: ns,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', r.id)
    }

    const exact = byNorm.get(ns) ?? []
    if (exact.length === 1) {
      const hit = exact[0]!
      await admin
        .from('retail_taxonomy_lider_sections')
        .update({
          section_id: hit.id,
          status: 'linked',
          confidence: 1,
          reason: `Coincidencia exacta (normalizada) con sección maestra «${hit.name}».`,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', r.id)
      continue
    }

    if (exact.length > 1) {
      await admin
        .from('retail_taxonomy_lider_sections')
        .update({
          status: 'missing',
          section_id: null,
          confidence: null,
          reason: 'Varias secciones maestras coinciden con el mismo nombre normalizado; elegí una manualmente.',
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', r.id)
      continue
    }

    if (isLiderRetailContentHubStrongKey(ns)) {
      await admin
        .from('retail_taxonomy_lider_sections')
        .update({
          status: 'missing',
          section_id: null,
          confidence: null,
          reason:
            'Hub de contenido Lider (ruta /content/…). No hay sección equivalente en el catálogo maestro: podés crearla con «Crear en catálogo» o enlazar una existente.',
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', r.id)
      continue
    }

    if (isProtectedCommercialLiderSection(r.external_section)) {
      await admin
        .from('retail_taxonomy_lider_sections')
        .update({
          status: 'missing',
          section_id: null,
          confidence: null,
          reason: 'Sección comercial sin homónimo en el catálogo maestro; vinculá manualmente si corresponde.',
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', r.id)
      continue
    }

    const scored = new Map<string, { s: MasterSec; score: number }>()
    for (const s of secs) {
      if (!s.norm) continue
      const score = fuzzySectionScore(ns, s.norm)
      if (score < 0.86) continue
      const prev = scored.get(s.id)
      if (!prev || score > prev.score) scored.set(s.id, { s, score })
    }

    const ranked = [...scored.values()].sort((a, b) => b.score - a.score)
    const top = ranked[0]
    const second = ranked[1]

    if (!top) {
      await admin
        .from('retail_taxonomy_lider_sections')
        .update({
          status: 'missing',
          section_id: null,
          confidence: null,
          reason: 'Sin sección maestra con nombre equivalente (tras normalización fuerte).',
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', r.id)
      continue
    }

    const gapOk = !second || top.score - second.score >= 0.035
    const strongEnough = top.score >= 0.9

    if (ranked.length === 1 || (gapOk && strongEnough)) {
      await admin
        .from('retail_taxonomy_lider_sections')
        .update({
          section_id: top.s.id,
          status: 'suggested',
          confidence: Math.round(top.score * 100) / 100,
          reason: `Posible coincidencia con sección maestra «${top.s.name}» (similitud por nombre).`,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', r.id)
    } else {
      await admin
        .from('retail_taxonomy_lider_sections')
        .update({
          status: 'missing',
          section_id: null,
          confidence: null,
          reason: 'Varias secciones maestras parecidas; no se eligió una sola con confianza suficiente.',
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', r.id)
    }
  }
}

export async function upsertLiderDiscoveredSections(
  admin: SupabaseClient,
  discovered: LiderDiscoveredSection[],
): Promise<void> {
  for (const d of discovered) {
    const { data: existing } = await admin
      .from('retail_taxonomy_lider_sections')
      .select('id, status, products_count')
      .eq('retailer', 'lider')
      .eq('normalized_external_section', d.normalized_external_section)
      .maybeSingle()

    const row = existing as { id: string; status: string; products_count: number } | null

    if (row) {
      if (row.status === 'linked' || row.status === 'ignored' || row.status === 'discarded') {
        await admin
          .from('retail_taxonomy_lider_sections')
          .update({
            products_count: Math.max(row.products_count, d.products_count),
            sample_urls: d.sample_urls,
            updated_at: new Date().toISOString(),
          } as never)
          .eq('id', row.id)
      } else {
        await admin
          .from('retail_taxonomy_lider_sections')
          .update({
            external_section: d.external_section,
            source: d.source,
            source_url: d.source_url,
            products_count: Math.max(row.products_count, d.products_count),
            sample_urls: d.sample_urls,
            sample_product_titles: d.sample_product_titles,
            updated_at: new Date().toISOString(),
          } as never)
          .eq('id', row.id)
      }
      continue
    }

    await admin.from('retail_taxonomy_lider_sections').insert({
      retailer: 'lider',
      external_section: d.external_section,
      normalized_external_section: d.normalized_external_section,
      source: d.source,
      source_url: d.source_url,
      products_count: d.products_count,
      sample_urls: d.sample_urls,
      sample_product_titles: d.sample_product_titles,
      status: 'pending',
    } as never)
  }
}

async function loadNormToLiderSectionId(admin: SupabaseClient): Promise<Map<string, string>> {
  const { data } = await admin
    .from('retail_taxonomy_lider_sections')
    .select('id, normalized_external_section')
    .eq('retailer', 'lider')
  const m = new Map<string, string>()
  for (const r of (data ?? []) as { id: string; normalized_external_section: string }[]) {
    m.set(r.normalized_external_section, r.id)
  }
  return m
}

/**
 * Categorías inferidas desde productos retail ya capturados (URLs PDP y category_hint).
 * Sólo considera secciones cuyo normalizado esté en `sectionNorms` (p. ej. secciones Lider vinculadas).
 */
export async function discoverLiderCategoriesFromCapturedProducts(
  admin: SupabaseClient,
  sectionNorms: Set<string>,
): Promise<LiderDiscoveredCategory[]> {
  if (sectionNorms.size === 0) return []

  const acc = new Map<string, { sectionNorm: string; catNorm: string; catDisplay: string; n: number }>()

  const { data, error } = await admin
    .from('retail_captured_products')
    .select('source_url, category_hint')
    .eq('retailer', 'lider')
    .limit(12000)

  if (error || !data?.length) return []

  for (const r of data as { source_url: string | null; category_hint: string | null }[]) {
    const keys = taxonomyKeysFromLiderCapture(r.source_url, r.category_hint)
    if (!keys) continue
    if (shouldDiscardLiderCategoryLabel(keys.labels.external_category)) continue
    if (!sectionNorms.has(keys.ns)) continue
    if (!keys.nc || keys.ns === keys.nc) continue
    const k = `${keys.ns}|${keys.nc}`
    const prev = acc.get(k)
    const display = keys.labels.external_category
    if (prev) prev.n += 1
    else acc.set(k, { sectionNorm: keys.ns, catNorm: keys.nc, catDisplay: display, n: 1 })
  }

  return [...acc.values()].map((v) => ({
    lider_section_normalized: v.sectionNorm,
    external_category: v.catDisplay,
    normalized_external_category: v.catNorm,
    products_count: v.n,
    match_method: 'captured_products',
  }))
}

/**
 * URLs PDP/listado que incluyen /browse/{sección}/… en productos ya capturados.
 * Complementa el scraping del índice (p. ej. La Boti) cuando el HTML del hub no trae todos los href.
 */
export async function discoverBrowseListingUrlsFromLiderCaptures(
  admin: SupabaseClient,
  sectionNorms: Set<string>,
): Promise<string[]> {
  if (sectionNorms.size === 0) return []

  const { data, error } = await admin
    .from('retail_captured_products')
    .select('source_url')
    .eq('retailer', 'lider')
    .not('source_url', 'is', null)
    .limit(15000)

  if (error || !data?.length) return []

  const out = new Set<string>()
  for (const r of data as { source_url: string | null }[]) {
    const raw = r.source_url?.trim()
    if (!raw || !raw.toLowerCase().includes('/browse/')) continue
    try {
      const u = new URL(raw)
      const pathOnly = (u.pathname.split('?')[0] ?? u.pathname).replace(/\/+$/, '')
      const keys = taxonomyKeysFromLiderCapture(`${u.origin}${pathOnly}`, null)
      if (!keys || !sectionNorms.has(keys.ns)) continue
      const parts = pathOnly.split('/').filter(Boolean)
      const bi = parts.findIndex((p) => p.toLowerCase() === 'browse')
      if (bi < 0 || parts.length < bi + 3) continue
      if (parts.length === bi + 3 && isLiderBrowsePathTailCollectionId(parts[bi + 2]!)) continue
      out.add(`${u.origin}${pathOnly}`)
      if (out.size >= 5000) break
    } catch {
      /* URL inválida */
    }
  }
  return [...out]
}

/** Pares sección/categoría inferidos solo desde URLs /browse/… presentes en capturas. */
export async function discoverLiderCategoriesFromCaptureBrowseUrls(
  admin: SupabaseClient,
  sectionNorms: Set<string>,
): Promise<LiderDiscoveredCategory[]> {
  const urls = await discoverBrowseListingUrlsFromLiderCaptures(admin, sectionNorms)
  return discoverCategoriesFromUrlsForSections(urls, sectionNorms)
}

/** Por cada sección Lider vinculada: norm de nombre de categoría maestra → categoría única (si hay colisión de norm, no se auto-asigna). */
export async function buildMasterCategoryAutoMatchByLiderSection(
  admin: SupabaseClient,
): Promise<Map<string, Map<string, { categoryId: string; masterSectionId: string; name: string }>>> {
  const { data: linked, error } = await admin
    .from('retail_taxonomy_lider_sections')
    .select('id, section_id')
    .eq('retailer', 'lider')
    .eq('status', 'linked')
    .not('section_id', 'is', null)

  const out = new Map<string, Map<string, { categoryId: string; masterSectionId: string; name: string }>>()
  if (error || !linked?.length) return out

  const masterSecIds = [...new Set((linked as { section_id: string }[]).map((r) => r.section_id))]
  const { data: cats } = await admin
    .from('categories')
    .select('id, name, section_id')
    .in('section_id', masterSecIds)

  const byMasterSec = new Map<string, { id: string; name: string; norm: string }[]>()
  for (const c of (cats ?? []) as { id: string; name: string; section_id: string }[]) {
    const norm = normalizeLiderCategoryKeyStrong(c.name)
    if (!norm) continue
    const list = byMasterSec.get(c.section_id) ?? []
    list.push({ id: c.id, name: c.name, norm })
    byMasterSec.set(c.section_id, list)
  }

  const normCountsBySec = new Map<string, Map<string, number>>()
  for (const [secId, list] of byMasterSec) {
    const cnt = new Map<string, number>()
    for (const c of list) {
      cnt.set(c.norm, (cnt.get(c.norm) ?? 0) + 1)
    }
    normCountsBySec.set(secId, cnt)
  }

  for (const ls of linked as { id: string; section_id: string }[]) {
    const list = byMasterSec.get(ls.section_id) ?? []
    const cnt = normCountsBySec.get(ls.section_id) ?? new Map()
    const m = new Map<string, { categoryId: string; masterSectionId: string; name: string }>()
    for (const c of list) {
      if ((cnt.get(c.norm) ?? 0) !== 1) continue
      const hit = { categoryId: c.id, masterSectionId: ls.section_id, name: c.name }
      m.set(c.norm, hit)
      const legacy = normalizeSearchText(c.name)
      if (legacy && legacy !== c.norm) m.set(legacy, hit)
    }
    out.set(ls.id, m)
  }
  return out
}

export async function upsertLiderCategoryMappings(
  admin: SupabaseClient,
  sectionDisplayByNorm: Map<string, string>,
  categories: LiderDiscoveredCategory[],
  masterAutoByLiderSection?: Map<
    string,
    Map<string, { categoryId: string; masterSectionId: string; name: string }>
  >,
): Promise<{ upserted: number; autoMatchedExistingMaster: number }> {
  type MappingRowLite = {
    id: string
    status: string
    products_count: number
    normalized_external_category: string
  }

  const normToId = await loadNormToLiderSectionId(admin)
  let upserted = 0
  let autoMatchedExistingMaster = 0
  for (const c of categories) {
    const lid = normToId.get(c.lider_section_normalized)
    if (!lid) continue
    const extSec = sectionDisplayByNorm.get(c.lider_section_normalized) ?? ''
    const ns = c.lider_section_normalized
    const ncStrong = normalizeLiderCategoryKeyStrong(c.external_category)
    const ncLegacy = normalizeSearchText(c.external_category)

    let existing: MappingRowLite | null = null
    const rStrong = await admin
      .from('retail_taxonomy_mappings')
      .select('id, status, products_count, normalized_external_category')
      .eq('retailer', 'lider')
      .eq('lider_section_id', lid)
      .eq('normalized_external_category', ncStrong)
      .maybeSingle()
    if (rStrong.data) {
      existing = rStrong.data as MappingRowLite
    } else if (ncLegacy && ncLegacy !== ncStrong) {
      const rLegacy = await admin
        .from('retail_taxonomy_mappings')
        .select('id, status, products_count, normalized_external_category')
        .eq('retailer', 'lider')
        .eq('lider_section_id', lid)
        .eq('normalized_external_category', ncLegacy)
        .maybeSingle()
      if (rLegacy.data) {
        existing = rLegacy.data as MappingRowLite
      }
    }

    const row: MappingRowLite | null = existing

    const hit =
      masterAutoByLiderSection?.get(lid)?.get(ncStrong)
      ?? (ncLegacy && ncLegacy !== ncStrong ? masterAutoByLiderSection?.get(lid)?.get(ncLegacy) : undefined)

    if (row) {
      if (row.status === 'linked' || row.status === 'ignored') {
        await admin
          .from('retail_taxonomy_mappings')
          .update({
            products_count: Math.max(row.products_count, c.products_count),
            updated_at: new Date().toISOString(),
          } as never)
          .eq('id', row.id)
      } else {
        const patch: Record<string, unknown> = {
          external_section: extSec,
          external_category: c.external_category,
          products_count: Math.max(row.products_count, c.products_count),
          match_method: c.match_method,
          updated_at: new Date().toISOString(),
        }
        if (row.normalized_external_category !== ncStrong) {
          patch.normalized_external_category = ncStrong
        }
        if (hit) {
          patch.section_id = hit.masterSectionId
          patch.category_id = hit.categoryId
          patch.status = 'linked'
          patch.confidence = 1
          patch.reason = 'Vinculada automáticamente: el nombre normalizado coincide con una categoría maestra ya existente en la sección vinculada.'
          patch.match_method = `${c.match_method}+master_catalog_existing_label`
        }
        await admin.from('retail_taxonomy_mappings').update(patch as never).eq('id', row.id)
      }
      upserted++
      continue
    }

    if (hit) {
      const { error } = await admin.from('retail_taxonomy_mappings').insert({
        retailer: 'lider',
        lider_section_id: lid,
        external_section: extSec,
        external_category: c.external_category,
        normalized_external_section: ns,
        normalized_external_category: ncStrong,
        section_id: hit.masterSectionId,
        category_id: hit.categoryId,
        status: 'linked',
        match_method: `${c.match_method}+master_catalog_existing_label`,
        confidence: 1,
        reason: 'Vinculada automáticamente: la etiqueta Lider coincide con una categoría ya existente en el catálogo maestro de la sección vinculada.',
        products_count: c.products_count,
      } as never)
      if (!error) {
        upserted++
        autoMatchedExistingMaster++
      }
      continue
    }

    const { error } = await admin.from('retail_taxonomy_mappings').insert({
      retailer: 'lider',
      lider_section_id: lid,
      external_section: extSec,
      external_category: c.external_category,
      normalized_external_section: ns,
      normalized_external_category: ncStrong,
      status: 'pending',
      match_method: c.match_method,
      products_count: c.products_count,
    } as never)
    if (!error) upserted++
  }
  return { upserted, autoMatchedExistingMaster: autoMatchedExistingMaster }
}

/**
 * Fase categorías: inferencia desde URLs del plan (enriquecidas) + productos capturados; sólo se crean mapeos
 * para etiquetas Lider observadas. Si ya existe categoría maestra homónima (normalizada, única), se sugiere vínculo.
 */
export async function syncLiderRetailCategoryMappingsFromPlanUrls(
  admin: SupabaseClient,
): Promise<
  | {
      ok: true
      discoveredCategoryRows: number
      mappingsUpsertTouched: number
      masterCatalogMappingsInserted: number
      capturesCategoryPairs: number
    }
  | { ok: false; error: string }
> {
  const sectionsResolved = await areLiderSectionsResolvedForCategoryPhase(admin)
  if (!sectionsResolved) {
    return {
      ok: false,
      error:
        'Resolvé todas las secciones Lider (pendiente, faltante o sugerido) antes de sincronizar categorías.',
    }
  }

  const { data: linkedRows, error: qe } = await admin
    .from('retail_taxonomy_lider_sections')
    .select('normalized_external_section, external_section, sample_urls')
    .eq('retailer', 'lider')
    .eq('status', 'linked')

  if (qe) {
    return { ok: false, error: 'No se pudieron leer las secciones Lider vinculadas.' }
  }

  const rows = (linkedRows ?? []) as {
    normalized_external_section: string
    external_section: string
    sample_urls: unknown
  }[]
  if (rows.length === 0) {
    return {
      ok: false,
      error: 'No hay secciones Lider vinculadas. Homologá al menos una sección con el catálogo maestro.',
    }
  }

  const sectionNorms = new Set(rows.map((r) => r.normalized_external_section))
  const displayByNorm = new Map(rows.map((r) => [r.normalized_external_section, r.external_section]))

  try {
    const masterAuto = await buildMasterCategoryAutoMatchByLiderSection(admin)

    const { urls: planUrls } = await discoverLiderCapturePlanUrls()
    const enrichedUrls = await enrichLiderPlanUrlsForCategoryDiscovery(planUrls, rows)
    const browseFromCaptures = await discoverBrowseListingUrlsFromLiderCaptures(admin, sectionNorms)
    const mergedDiscoveryUrls: string[] = []
    const seenUrl = new Set<string>()
    for (const u of [...enrichedUrls, ...browseFromCaptures]) {
      const t = u.trim()
      if (!t || seenUrl.has(t)) continue
      seenUrl.add(t)
      mergedDiscoveryUrls.push(t)
    }
    const fromUrls = discoverCategoriesFromUrlsForSections(mergedDiscoveryUrls, sectionNorms)
    const fromCaptures = await discoverLiderCategoriesFromCapturedProducts(admin, sectionNorms)
    const categories = mergeLiderDiscoveredCategoryLists(fromUrls, fromCaptures)

    const { upserted, autoMatchedExistingMaster } = await upsertLiderCategoryMappings(
      admin,
      displayByNorm,
      categories,
      masterAuto,
    )
    await applyFuzzyCategorySuggestionsForLider(admin)
    await promoteExactSuggestedLiderCategoryMappingsToLinked(admin)
    await refreshLiderTaxonomyProductsCountsFromCaptures(admin)
    return {
      ok: true,
      discoveredCategoryRows: categories.length,
      mappingsUpsertTouched: upserted,
      masterCatalogMappingsInserted: autoMatchedExistingMaster,
      capturesCategoryPairs: fromCaptures.length,
    }
  } catch {
    return { ok: false, error: 'No se pudo completar la sincronización de categorías. Intenta nuevamente.' }
  }
}

export async function applyFuzzyCategorySuggestionsForLider(admin: SupabaseClient): Promise<void> {
  const { data: liderSecs } = await admin
    .from('retail_taxonomy_lider_sections')
    .select('id, section_id, status')
    .eq('retailer', 'lider')

  const masterByLiderSection = new Map<string, string | null>()
  for (const s of (liderSecs ?? []) as { id: string; section_id: string | null; status: string }[]) {
    if ((s.status === 'linked' || s.status === 'suggested') && s.section_id) {
      masterByLiderSection.set(s.id, s.section_id)
    } else {
      masterByLiderSection.set(s.id, null)
    }
  }

  const { data: mappings } = await admin
    .from('retail_taxonomy_mappings')
    .select('id, lider_section_id, normalized_external_category, external_category, status')
    .eq('retailer', 'lider')
    .in('status', ['pending', 'missing'])

  for (const m of (mappings ?? []) as {
    id: string
    lider_section_id: string | null
    normalized_external_category: string
    external_category: string
    status: string
  }[]) {
    if (!m.lider_section_id) continue
    const masterSecId = masterByLiderSection.get(m.lider_section_id)
    if (!masterSecId) continue

    const { data: cats } = await admin
      .from('categories')
      .select('id, name, section_id')
      .eq('section_id', masterSecId)

    const byNorm = new Map<string, { id: string; name: string }[]>()
    for (const c of (cats ?? []) as { id: string; name: string }[]) {
      const nk = normalizeLiderCategoryKeyStrong(c.name)
      const ns = normalizeSearchText(c.name)
      for (const key of new Set([nk, ns].filter(Boolean))) {
        const list = byNorm.get(key) ?? []
        if (!list.some((x) => x.id === c.id)) list.push({ id: c.id, name: c.name })
        byNorm.set(key, list)
      }
    }

    const ext = (m.external_category ?? '').trim()
    const keysTry = [
      m.normalized_external_category,
      normalizeLiderCategoryKeyStrong(ext),
      normalizeSearchText(ext),
    ].filter((x, i, a) => Boolean(x) && a.indexOf(x!) === i) as string[]

    let ambiguousExact = false
    const unionById = new Map<string, { id: string; name: string }>()

    for (const k of keysTry) {
      const list = byNorm.get(k) ?? []
      if (list.length > 1) {
        ambiguousExact = true
        break
      }
      for (const item of list) {
        unionById.set(item.id, item)
      }
    }

    if (ambiguousExact) {
      await admin
        .from('retail_taxonomy_mappings')
        .update({
          status: 'missing',
          reason: 'Varias categorías maestras coinciden con claves de nombre para esta etiqueta Lider.',
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', m.id)
      continue
    }

    if (unionById.size === 1) {
      const hit = [...unionById.values()][0]!
      const nkStrong = normalizeLiderCategoryKeyStrong(ext)
      const patch: Record<string, unknown> = {
        section_id: masterSecId,
        category_id: hit.id,
        status: 'suggested',
        match_method: 'fuzzy_name_exact_normalized',
        confidence: 0.95,
        reason: `Coincidencia con categoría «${hit.name}» en la sección maestra (clave unificada).`,
        updated_at: new Date().toISOString(),
      }
      if (nkStrong && nkStrong !== m.normalized_external_category) {
        patch.normalized_external_category = nkStrong
      }
      await admin.from('retail_taxonomy_mappings').update(patch as never).eq('id', m.id)
      continue
    }

    if (unionById.size > 1) {
      await admin
        .from('retail_taxonomy_mappings')
        .update({
          status: 'missing',
          reason: 'Varias categorías maestras distintas encajan con las variantes de nombre de esta etiqueta.',
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', m.id)
      continue
    }

    const needleStrong = normalizeLiderCategoryKeyStrong(ext)
    const needleLegacy = normalizeSearchText(ext)
    const needle = needleStrong || needleLegacy
    if (!needle) continue

    const scored = new Map<string, { c: { id: string; name: string }; score: number }>()
    for (const c of (cats ?? []) as { id: string; name: string }[]) {
      const mk = normalizeLiderCategoryKeyStrong(c.name)
      if (!mk) continue
      const s = fuzzyCategoryNameScore(needle, mk)
      if (s < 0.86) continue
      const prev = scored.get(c.id)
      if (!prev || s > prev.score) scored.set(c.id, { c, score: s })
    }

    const ranked = [...scored.values()].sort((a, b) => b.score - a.score)
    const top = ranked[0]
    const second = ranked[1]

    if (!top) {
      await admin
        .from('retail_taxonomy_mappings')
        .update({
          status: 'missing',
          reason: 'Sin categoría maestra suficientemente parecida en la sección vinculada o sugerida.',
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', m.id)
      continue
    }

    const gapOk = !second || top.score - second.score >= 0.028
    const strongEnough = top.score >= 0.9

    if (ranked.length === 1 || (gapOk && strongEnough)) {
      const nkStrong = normalizeLiderCategoryKeyStrong(ext)
      const patch: Record<string, unknown> = {
        section_id: masterSecId,
        category_id: top.c.id,
        status: 'suggested',
        match_method: 'fuzzy_name_similarity',
        confidence: Math.round(top.score * 100) / 100,
        reason: `Coincidencia por similitud con categoría «${top.c.name}» en la sección maestra.`,
        updated_at: new Date().toISOString(),
      }
      if (nkStrong && nkStrong !== m.normalized_external_category) {
        patch.normalized_external_category = nkStrong
      }
      await admin.from('retail_taxonomy_mappings').update(patch as never).eq('id', m.id)
    } else {
      await admin
        .from('retail_taxonomy_mappings')
        .update({
          status: 'missing',
          reason: 'Varias categorías maestras parecidas; no se eligió una sola con confianza suficiente.',
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', m.id)
    }
  }
}

/**
 * Promueve a `linked` los mapeos `suggested` que ya tienen `category_id`
 * y además coinciden exactamente por nombre normalizado con la categoría maestra.
 */
export async function promoteExactSuggestedLiderCategoryMappingsToLinked(admin: SupabaseClient): Promise<number> {
  const { data: suggested } = await admin
    .from('retail_taxonomy_mappings')
    .select('id, external_category, normalized_external_category, section_id, category_id')
    .eq('retailer', 'lider')
    .eq('status', 'suggested')
    .not('category_id', 'is', null)
    .not('section_id', 'is', null)
    .limit(3000)

  if (!suggested?.length) return 0

  const categoryIds = [
    ...new Set((suggested as { category_id: string | null }[]).map((r) => r.category_id).filter(Boolean)),
  ] as string[]
  if (categoryIds.length === 0) return 0

  const { data: cats } = await admin.from('categories').select('id, name, section_id').in('id', categoryIds)
  if (!cats?.length) return 0

  const catById = new Map<string, { id: string; name: string; section_id: string }>()
  for (const c of (cats ?? []) as { id: string; name: string; section_id: string }[]) {
    catById.set(c.id, c)
  }

  let promoted = 0
  for (const row of suggested as {
    id: string
    external_category: string
    normalized_external_category: string
    section_id: string | null
    category_id: string | null
  }[]) {
    if (!row.section_id || !row.category_id) continue
    const cat = catById.get(row.category_id)
    if (!cat) continue
    if (cat.section_id !== row.section_id) continue

    const extStrong = normalizeLiderCategoryKeyStrong(row.external_category)
    const extLegacy = normalizeSearchText(row.external_category)
    const catStrong = normalizeLiderCategoryKeyStrong(cat.name)
    const catLegacy = normalizeSearchText(cat.name)

    const isExact =
      (extStrong && catStrong && extStrong === catStrong)
      || (extLegacy && catLegacy && extLegacy === catLegacy)
    if (!isExact) continue

    const patch: Record<string, unknown> = {
      status: 'linked',
      confidence: 1,
      reason:
        'Vinculada automáticamente: el nombre normalizado coincide con una categoría maestra existente en la sección vinculada.',
      updated_at: new Date().toISOString(),
    }
    if (extStrong && extStrong !== row.normalized_external_category) {
      patch.normalized_external_category = extStrong
    }
    const { error } = await admin.from('retail_taxonomy_mappings').update(patch as never).eq('id', row.id)
    if (!error) promoted++
  }

  return promoted
}

export async function refreshLiderTaxonomyProductsCountsFromCaptures(admin: SupabaseClient): Promise<void> {
  const { data: caps } = await admin
    .from('retail_captured_products')
    .select('source_url, category_hint')
    .eq('retailer', 'lider')
    .limit(6000)

  const { data: maps } = await admin
    .from('retail_taxonomy_mappings')
    .select('id, normalized_external_section, normalized_external_category')
    .eq('retailer', 'lider')

  if (!maps?.length) return

  const keyToIds = new Map<string, string[]>()
  for (const m of maps as {
    id: string
    normalized_external_section: string
    normalized_external_category: string
  }[]) {
    const k = `${m.normalized_external_section}|${m.normalized_external_category}`
    const list = keyToIds.get(k) ?? []
    list.push(m.id)
    keyToIds.set(k, list)
  }

  const countsByMap = new Map<string, number>()
  for (const m of maps as { id: string }[]) {
    countsByMap.set(m.id, 0)
  }

  for (const r of (caps ?? []) as { source_url: string | null; category_hint: string | null }[]) {
    const keys = taxonomyKeysFromLiderCapture(r.source_url, r.category_hint)
    if (!keys) continue
    const k = `${keys.ns}|${keys.nc}`
    const ids = keyToIds.get(k)
    if (!ids) continue
    for (const id of ids) {
      countsByMap.set(id, (countsByMap.get(id) ?? 0) + 1)
    }
  }

  for (const [id, n] of countsByMap) {
    await admin
      .from('retail_taxonomy_mappings')
      .update({ products_count: n, updated_at: new Date().toISOString() } as never)
      .eq('id', id)
  }

  const { data: lsecs } = await admin
    .from('retail_taxonomy_lider_sections')
    .select('id, normalized_external_section')
    .eq('retailer', 'lider')

  if (!lsecs?.length) return

  const secCounts = new Map<string, number>()
  for (const s of lsecs as { id: string }[]) {
    secCounts.set(s.id, 0)
  }

  for (const r of (caps ?? []) as { source_url: string | null; category_hint: string | null }[]) {
    const keys = taxonomyKeysFromLiderCapture(r.source_url, r.category_hint)
    if (!keys) continue
    for (const ls of lsecs as { id: string; normalized_external_section: string }[]) {
      if (ls.normalized_external_section === keys.ns) {
        secCounts.set(ls.id, (secCounts.get(ls.id) ?? 0) + 1)
      }
    }
  }

  for (const [id, n] of secCounts) {
    await admin
      .from('retail_taxonomy_lider_sections')
      .update({ products_count: n, updated_at: new Date().toISOString() } as never)
      .eq('id', id)
  }
}

export type LiderRetailTaxonomyMappingEnriched = RetailTaxonomyMappingRow & {
  master_category_name?: string | null
  master_section_name?: string | null
}

export async function enrichLiderRetailTaxonomyMappingsWithMasterNames(
  admin: SupabaseClient,
  mappings: RetailTaxonomyMappingRow[],
): Promise<LiderRetailTaxonomyMappingEnriched[]> {
  if (mappings.length === 0) return []
  const catIds = [...new Set(mappings.map((m) => m.category_id).filter(Boolean))] as string[]
  const catMeta = new Map<string, { name: string; section_id: string }>()
  if (catIds.length > 0) {
    const { data: cats } = await admin.from('categories').select('id, name, section_id').in('id', catIds)
    for (const c of (cats ?? []) as { id: string; name: string; section_id: string }[]) {
      catMeta.set(c.id, { name: c.name, section_id: c.section_id })
    }
  }
  const secIds = [...new Set([...catMeta.values()].map((c) => c.section_id))]
  const secName = new Map<string, string>()
  if (secIds.length > 0) {
    const { data: secs } = await admin.from('sections').select('id, name').in('id', secIds)
    for (const s of (secs ?? []) as { id: string; name: string }[]) {
      secName.set(s.id, s.name)
    }
  }
  return mappings.map((m) => {
    const cm = m.category_id ? catMeta.get(m.category_id) : undefined
    return {
      ...m,
      master_category_name: cm?.name ?? null,
      master_section_name: cm ? secName.get(cm.section_id) ?? null : null,
    }
  })
}

/** Mapeos de categoría por sección Lider vinculada (una consulta de mapeos + enriquecido). */
export async function fetchLiderTaxonomyMappingsGroupedByLinkedLiderSections(
  admin: SupabaseClient,
): Promise<Record<string, LiderRetailTaxonomyMappingEnriched[]>> {
  const { data: linked, error: le } = await admin
    .from('retail_taxonomy_lider_sections')
    .select('id')
    .eq('retailer', 'lider')
    .eq('status', 'linked')

  const linkedIds = (linked ?? []).map((r: { id: string }) => r.id)
  const bySection: Record<string, LiderRetailTaxonomyMappingEnriched[]> = {}
  for (const id of linkedIds) {
    bySection[id] = []
  }
  if (le || linkedIds.length === 0) return bySection

  const { data: maps, error: me } = await admin
    .from('retail_taxonomy_mappings')
    .select('*')
    .eq('retailer', 'lider')
    .in('lider_section_id', linkedIds)
    .in('status', [...LIDER_CATEGORY_BLOCKING])
    .order('external_category', { ascending: true })

  if (me || !maps?.length) return bySection

  const enriched = await enrichLiderRetailTaxonomyMappingsWithMasterNames(
    admin,
    maps as RetailTaxonomyMappingRow[],
  )
  for (const m of enriched) {
    if (liderTaxonomyDisplayContainsNumericCharacter(m.external_category)) continue
    const lid = m.lider_section_id
    if (lid && bySection[lid] !== undefined) {
      bySection[lid]!.push(m)
    }
  }
  return bySection
}

export async function fetchLiderTaxonomyLiderSectionRows(
  admin: SupabaseClient,
): Promise<RetailTaxonomyLiderSectionRow[]> {
  const { data, error } = await admin
    .from('retail_taxonomy_lider_sections')
    .select('*')
    .eq('retailer', 'lider')
    .not('status', 'in', '(ignored,discarded)')
    .order('external_section', { ascending: true })

  if (error || !data?.length) return []

  const rows = (data as RetailTaxonomyLiderSectionRow[]).filter(
    (r) => !liderTaxonomyDisplayContainsNumericCharacter(r.external_section),
  )
  if (rows.length === 0) return []

  const secIds = [...new Set(rows.map((r) => r.section_id).filter(Boolean))] as string[]
  const names = new Map<string, string>()
  if (secIds.length > 0) {
    const { data: ms } = await admin.from('sections').select('id, name').in('id', secIds)
    for (const s of (ms ?? []) as { id: string; name: string }[]) {
      names.set(s.id, s.name)
    }
  }
  return rows.map((r) => ({
    ...r,
    master_section_name: r.section_id ? names.get(r.section_id) ?? null : null,
  }))
}

export async function fetchLiderTaxonomyMappingsForLiderSection(
  admin: SupabaseClient,
  liderSectionId: string,
): Promise<LiderRetailTaxonomyMappingEnriched[]> {
  const { data, error } = await admin
    .from('retail_taxonomy_mappings')
    .select('*')
    .eq('retailer', 'lider')
    .eq('lider_section_id', liderSectionId)
    .not('status', 'in', '(ignored,discarded)')
    .order('external_category', { ascending: true })

  if (error || !data?.length) return []

  const enriched = await enrichLiderRetailTaxonomyMappingsWithMasterNames(admin, data as RetailTaxonomyMappingRow[])
  return enriched.filter((m) => !liderTaxonomyDisplayContainsNumericCharacter(m.external_category))
}

export async function fetchLiderBlockingLiderSections(
  admin: SupabaseClient,
): Promise<RetailTaxonomyLiderSectionRow[]> {
  const { data, error } = await admin
    .from('retail_taxonomy_lider_sections')
    .select('*')
    .eq('retailer', 'lider')
    .in('status', [...LIDER_SECTION_BLOCKING])
    .order('external_section', { ascending: true })
    .limit(80)

  if (error || !data) return []
  return (data as RetailTaxonomyLiderSectionRow[]).filter(
    (r) => !liderTaxonomyDisplayContainsNumericCharacter(r.external_section),
  )
}
