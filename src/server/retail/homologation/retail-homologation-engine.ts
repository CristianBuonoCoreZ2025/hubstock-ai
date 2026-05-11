import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeCatalogAlias } from '@/lib/catalog-alias'
import {
  enrichRetailCandidatesCompositeScore,
  type MatchCandidate,
} from '@/lib/retail-association'
import { getUserFriendlyErrorMessage, isUniqueViolation } from '@/lib/user-friendly-errors'
import { normalizeSearchText } from '@/lib/search'
import {
  buildRetailReviewGroupKey,
  inferRetailLiderReviewTrayFromReason,
  type RetailLiderReviewTray,
} from '@/lib/retail-lider-review-tray'
import type { RetailAiDecision, RetailHomologationCounters } from '@/server/retail/capture/retail-types'
import { normalizeRetailCapturedInput } from '@/server/retail/normalize/normalize-retail-product'
import { resolveRetailHomologationWithOpenRouter } from '@/server/retail/homologation/retail-ai-resolver'
import { retailFormatsCompatible, scoreRetailCandidates } from '@/server/retail/homologation/retail-score'
import { resolveLinkedLiderTaxonomyForCapture } from '@/server/retail/taxonomy/lider-taxonomy-service'

const AUTO_LINK_MIN = 0.88
const NEW_MASTER_MIN = 0.92
const AMBIGUOUS_GAP = 0.04

type CapturedRow = {
  id: string
  batch_id: string
  retailer: string
  external_ref: string
  source_url: string | null
  title: string
  normalized_title: string
  brand: string | null
  normalized_brand: string
  price: number | null
  unit_price: string | null
  category_hint: string | null
  description_hint: string | null
  status: string
}

type CatalogMini = {
  id: string
  name: string
  brand: string | null
  format: string | null
  category_id: string
  default_reference_price: number | null
  source_product_url: string | null
}

async function upsertRetailLink(
  admin: SupabaseClient,
  input: {
    retailer: string
    external_ref: string
    catalog_product_id: string
    listingTitle: string
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error: linkError } = await admin.from('catalog_retail_links').upsert(
    {
      retailer: input.retailer,
      external_ref: input.external_ref,
      catalog_product_id: input.catalog_product_id,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: 'retailer,external_ref' },
  )
  if (linkError) {
    return { ok: false, error: getUserFriendlyErrorMessage(linkError, 'generic') }
  }
  const normalized = normalizeCatalogAlias(input.listingTitle)
  if (normalized.length >= 2) {
    const ins = await admin.from('catalog_product_aliases').insert({
      catalog_product_id: input.catalog_product_id,
      alias_normalized: normalized,
    } as never)
    if (ins.error && !isUniqueViolation(ins.error)) {
      return { ok: false, error: getUserFriendlyErrorMessage(ins.error, 'generic') }
    }
  }
  return { ok: true }
}

async function fetchCatalogMetaByIds(
  admin: SupabaseClient,
  ids: string[],
): Promise<Map<string, CatalogMini>> {
  const map = new Map<string, CatalogMini>()
  if (ids.length === 0) return map
  const { data, error } = await admin
    .from('catalog_products')
    .select('id,name,brand,format,category_id,default_reference_price,source_product_url')
    .in('id', ids)
    .eq('active', true)
  if (error || !data) return map
  for (const r of data as CatalogMini[]) {
    map.set(r.id, r)
  }
  return map
}

async function findUrlMatch(
  admin: SupabaseClient,
  sourceUrl: string | null,
  externalRef: string | null,
): Promise<string | null> {
  for (const raw of [sourceUrl, externalRef]) {
    if (!raw?.trim()) continue
    const { data } = await admin
      .from('catalog_products')
      .select('id')
      .eq('source_product_url', raw.trim())
      .eq('active', true)
      .maybeSingle()
    if (data && (data as { id: string }).id) return (data as { id: string }).id
  }
  return null
}

async function findExactTitleBrandFormatMatch(
  admin: SupabaseClient,
  row: CapturedRow,
  norm: ReturnType<typeof normalizeRetailCapturedInput>,
): Promise<string | null> {
  const searchTitle = row.description_hint ? `${row.title} ${row.description_hint}`.trim() : row.title
  const { data: candRaw, error } = await admin.rpc('catalog_retail_match_candidates', {
    p_search_title: searchTitle,
    p_price: row.price,
    p_category_id: null,
    p_limit: 40,
  } as never)
  if (error) return null
  const list = (Array.isArray(candRaw) ? candRaw : []) as MatchCandidate[]
  const meta = await fetchCatalogMetaByIds(
    admin,
    list.map((c) => c.catalog_product_id),
  )
  for (const c of list) {
    const m = meta.get(c.catalog_product_id)
    if (!m) continue
    const nt = normalizeSearchText(m.name)
    const nb = normalizeSearchText(m.brand ?? '')
    if (nt !== row.normalized_title) continue
    if (nb !== row.normalized_brand && row.normalized_brand.length >= 2) continue
    if (!retailFormatsCompatible(norm, m.name, m.format)) continue
    return m.id
  }
  return null
}

async function loadRpcCandidates(
  admin: SupabaseClient,
  row: CapturedRow,
): Promise<MatchCandidate[]> {
  const searchTitle = row.description_hint ? `${row.title} ${row.description_hint}`.trim() : row.title
  const { data: candRaw, error } = await admin.rpc('catalog_retail_match_candidates', {
    p_search_title: searchTitle,
    p_price: row.price,
    p_category_id: null,
    p_limit: 20,
  } as never)
  if (error) return []
  const list = (Array.isArray(candRaw) ? candRaw : []) as MatchCandidate[]
  return list.map((r) => ({
    catalog_product_id: String(r.catalog_product_id),
    product_name: String(r.product_name),
    category_id: String(r.category_id),
    default_reference_price:
      r.default_reference_price != null ? Number(r.default_reference_price) : null,
    match_score: Number(r.match_score),
  }))
}

function twoTopAreClose(scored: { match_score: number }[]): boolean {
  if (scored.length < 2) return false
  const a = Number(scored[0]!.match_score)
  const b = Number(scored[1]!.match_score)
  return a >= 0.55 && b >= 0.55 && Math.abs(a - b) <= AMBIGUOUS_GAP
}

async function hasSimilarActiveMaster(
  admin: SupabaseClient,
  title: string,
  brand: string | null,
): Promise<boolean> {
  const t = normalizeSearchText(title)
  if (t.length < 4) return false
  const prefix = title
    .trim()
    .slice(0, 20)
    .replace(/[%_]/g, ' ')
  const { data } = await admin
    .from('catalog_products')
    .select('id,name,brand')
    .eq('active', true)
    .ilike('name', `${prefix}%`)
    .limit(12)
  for (const r of (data ?? []) as { name: string; brand: string | null }[]) {
    const nt = normalizeSearchText(r.name)
    if (nt === t) return true
    const sim =
      t.length >= 4 &&
      nt.length >= 4 &&
      (nt.includes(t.slice(0, Math.min(12, t.length))) || t.includes(nt.slice(0, Math.min(12, nt.length))))
    if (sim) {
      if (!brand?.trim() || !r.brand?.trim()) return true
      if (normalizeSearchText(r.brand) === normalizeSearchText(brand)) return true
    }
  }
  return false
}

async function createMasterFromCapture(
  admin: SupabaseClient,
  row: CapturedRow,
  confidence: number,
  reason: string,
): Promise<{ ok: true; id: string } | { ok: false }> {
  let cat: { section_id: string; category_id: string } | null = null
  if (row.retailer === 'lider') {
    cat = await resolveLinkedLiderTaxonomyForCapture(admin, {
      source_url: row.source_url,
      category_hint: row.category_hint,
    })
  } else {
    const { data } = await admin
      .from('categories')
      .select('id, section_id')
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (data) {
      cat = {
        category_id: (data as { id: string }).id,
        section_id: (data as { section_id: string }).section_id,
      }
    }
  }
  if (!cat) return { ok: false }
  const dup = await hasSimilarActiveMaster(admin, row.title, row.brand)
  if (dup) return { ok: false }

  const { data: maxData } = await admin
    .from('catalog_products')
    .select('sort_order')
    .eq('category_id', cat.category_id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const sort_order = ((maxData as { sort_order: number } | null)?.sort_order ?? -1) + 1

  const fmtSig = normalizeRetailCapturedInput({
    retailer: row.retailer,
    external_ref: row.external_ref,
    source_url: row.source_url,
    title: row.title,
    brand: row.brand,
    price: row.price,
    unit_price: row.unit_price,
    category_hint: row.category_hint,
    description_hint: row.description_hint,
    image_url: null,
    raw_data: null,
  }).format_signature

  const { data, error } = await admin
    .from('catalog_products')
    .insert({
      name: row.title.trim(),
      section_id: cat.section_id,
      category_id: cat.category_id,
      brand: row.brand?.trim() || null,
      brand_id: null,
      format: fmtSig,
      unit: null,
      default_reference_price: row.price,
      sort_order,
      active: true,
      source_system: 'retail_capture_lider',
      source_product_url: row.source_url?.trim() || null,
    } as never)
    .select('id')
    .single()

  if (error || !data) return { ok: false }
  const id = (data as { id: string }).id
  return { ok: true, id }
}

async function applyLink(
  admin: SupabaseClient,
  row: CapturedRow,
  catalogProductId: string,
  source: string,
  confidence: number,
  reason: string,
): Promise<void> {
  const link = await upsertRetailLink(admin, {
    retailer: row.retailer,
    external_ref: row.external_ref,
    catalog_product_id: catalogProductId,
    listingTitle: row.title,
  })
  if (!link.ok) return

  await admin
    .from('retail_captured_products')
    .update({
      status: 'linked',
      catalog_product_id: catalogProductId,
      decision_source: source,
      decision_confidence: confidence,
      decision_reason: reason,
      review_tray: null,
      group_key: null,
      suggested_master_id: null,
    } as never)
    .eq('id', row.id)
}

function suggestedMasterFromReviewExtra(extra?: {
  suggested?: string | null
  candidates?: unknown
}): string | null {
  if (extra?.suggested) return extra.suggested
  const c = extra?.candidates
  if (Array.isArray(c) && c.length > 0) {
    const first = c[0] as { catalog_product_id?: string }
    if (first?.catalog_product_id) return String(first.catalog_product_id)
  }
  return null
}

async function applyReview(
  admin: SupabaseClient,
  row: CapturedRow,
  reason: string,
  extra?: { suggested?: string | null; candidates?: unknown; decision?: string; confidence?: number },
): Promise<void> {
  const tray: RetailLiderReviewTray = inferRetailLiderReviewTrayFromReason(reason)
  const suggested = suggestedMasterFromReviewExtra(extra)
  const groupKey = buildRetailReviewGroupKey({
    tray,
    suggestedMasterId: suggested,
    reasonSnippet: reason,
  })

  await admin
    .from('retail_captured_products')
    .update({
      status: 'review',
      decision_source: 'engine',
      decision_confidence: extra?.confidence ?? null,
      decision_reason: reason,
      review_tray: tray,
      group_key: groupKey,
      suggested_master_id: suggested,
    } as never)
    .eq('id', row.id)

  if (extra?.candidates != null || extra?.suggested) {
    await admin.from('retail_ai_match_reviews').insert({
      captured_product_id: row.id,
      retailer: row.retailer,
      title: row.title,
      brand: row.brand,
      price: row.price,
      suggested_catalog_product_id: extra.suggested ?? null,
      decision: extra?.decision ?? 'review',
      confidence: extra?.confidence ?? null,
      reason,
      candidates: extra?.candidates ?? null,
    } as never)
  }
}

async function applyDuplicateRisk(
  admin: SupabaseClient,
  row: CapturedRow,
  reason: string,
  candidates: unknown,
): Promise<void> {
  const suggested =
    Array.isArray(candidates) && candidates.length > 0 ?
      String((candidates[0] as { catalog_product_id?: string }).catalog_product_id ?? '')
    : null
  const suggestedId = suggested && suggested.length > 0 ? suggested : null
  const tray: RetailLiderReviewTray = 'duplicate_risk'
  const groupKey = buildRetailReviewGroupKey({
    tray,
    suggestedMasterId: suggestedId,
    reasonSnippet: reason,
  })

  await admin
    .from('retail_captured_products')
    .update({
      status: 'duplicate_risk',
      decision_source: 'engine',
      decision_reason: reason,
      review_tray: tray,
      group_key: groupKey,
      suggested_master_id: suggestedId,
    } as never)
    .eq('id', row.id)

  await admin.from('retail_ai_match_reviews').insert({
    captured_product_id: row.id,
    retailer: row.retailer,
    title: row.title,
    brand: row.brand,
    price: row.price,
    suggested_catalog_product_id: suggestedId,
    decision: 'duplicate_risk',
    confidence: null,
    reason,
    candidates,
  } as never)
}

function buildCandidateBriefs(
  scored: MatchCandidate[],
  meta: Map<string, CatalogMini>,
  limit: number,
) {
  return scored.slice(0, limit).map((c) => {
    const m = meta.get(c.catalog_product_id)
    return {
      catalog_product_id: c.catalog_product_id,
      product_name: c.product_name,
      category_id: c.category_id,
      default_reference_price: c.default_reference_price,
      format: m?.format ?? null,
    }
  })
}

/**
 * Homologa una fila de staging. Orden: URL → nombre+marca+formato → puntaje (+ IA si ambiguo).
 */
export async function homologateSingleCapturedProduct(
  admin: SupabaseClient,
  row: CapturedRow,
): Promise<keyof RetailHomologationCounters | 'none'> {
  if (row.status !== 'pending') return 'none'

  const norm = normalizeRetailCapturedInput({
    retailer: row.retailer,
    external_ref: row.external_ref,
    source_url: row.source_url,
    title: row.title,
    brand: row.brand,
    price: row.price,
    unit_price: row.unit_price,
    category_hint: row.category_hint,
    description_hint: row.description_hint,
    image_url: null,
    raw_data: null,
  })

  const urlId = await findUrlMatch(admin, row.source_url, row.external_ref)
  if (urlId) {
    const meta = await fetchCatalogMetaByIds(admin, [urlId])
    const m = meta.get(urlId)
    if (m && retailFormatsCompatible(norm, m.name, m.format)) {
      await applyLink(admin, row, urlId, 'url', 0.99, 'Coincidencia por URL de producto.')
      return 'url_linked'
    }
  }

  const exactId = await findExactTitleBrandFormatMatch(admin, row, norm)
  if (exactId) {
    await applyLink(admin, row, exactId, 'exact', 0.97, 'Nombre, marca y formato equivalentes.')
    return 'exact_linked'
  }

  const rawCandidates = await loadRpcCandidates(admin, row)
  if (rawCandidates.length === 0) {
    await applyReview(admin, row, 'Sin candidatos en el catálogo maestro.')
    return 'review_required'
  }

  const meta = await fetchCatalogMetaByIds(
    admin,
    rawCandidates.map((c) => c.catalog_product_id),
  )
  const formatMap = new Map<string, string | null>()
  for (const [id, m] of meta) {
    formatMap.set(id, m.format)
  }
  const enriched = enrichRetailCandidatesCompositeScore(rawCandidates, row.title, row.price)
  const gated = enriched.filter((c) => {
    const m = meta.get(c.catalog_product_id)
    if (!m) return false
    return retailFormatsCompatible(norm, m.name, m.format)
  })
  const scored = gated.length > 0 ? scoreRetailCandidates(gated, row.title, row.price, norm, formatMap) : []

  if (scored.length === 0) {
    const rankedAll = enrichRetailCandidatesCompositeScore(enriched, row.title, row.price)
    const useAi =
      rankedAll.length > 0 &&
      (twoTopAreClose(rankedAll) ||
        (Number(rankedAll[0]?.match_score ?? 0) >= 0.42 &&
          Number(rankedAll[0]?.match_score ?? 0) < AUTO_LINK_MIN))
    if (useAi && process.env.OPENROUTER_API_KEY?.trim()) {
      const topMeta = await fetchCatalogMetaByIds(
        admin,
        rankedAll.slice(0, 8).map((c) => c.catalog_product_id),
      )
      const ai = await resolveRetailHomologationWithOpenRouter({
        captured: {
          title: row.title,
          brand: row.brand,
          price: row.price,
          unit_price: row.unit_price,
          category_hint: row.category_hint,
          description_hint: row.description_hint,
          source_url: row.source_url,
        },
        candidates: buildCandidateBriefs(rankedAll, topMeta, 8),
      })
      if (!ai) {
        await applyReview(admin, row, 'La IA no devolvió JSON válido; revisión manual.', {
          decision: 'review',
          candidates: rankedAll.slice(0, 8),
        })
        return 'review_required'
      }
      const metaAi = await fetchCatalogMetaByIds(
        admin,
        [
          ...rankedAll.slice(0, 8).map((c) => c.catalog_product_id),
          ...(ai.catalog_product_id ? [ai.catalog_product_id] : []),
        ].filter((v, i, a) => a.indexOf(v) === i),
      )
      return await applyAiDecision(admin, row, ai, metaAi)
    }
    await applyReview(admin, row, 'Ningún candidato con formato compatible.', {
      candidates: rankedAll.slice(0, 8),
    })
    return 'review_required'
  }

  if (twoTopAreClose(scored)) {
    await applyDuplicateRisk(
      admin,
      row,
      'Dos candidatos del catálogo con puntajes muy cercanos.',
      scored.slice(0, 8),
    )
    return 'duplicate_risk'
  }

  const best = scored[0]!
  const bestScore = Number(best.match_score)
  if (bestScore >= AUTO_LINK_MIN && best.format_ok) {
    await applyLink(admin, row, best.catalog_product_id, 'rule', bestScore, 'Puntaje y reglas de formato.')
    return 'rule_linked'
  }

  if (bestScore >= 0.45 && bestScore < AUTO_LINK_MIN) {
    const briefs = buildCandidateBriefs(scored, meta, 8)
    const ai = await resolveRetailHomologationWithOpenRouter({
      captured: {
        title: row.title,
        brand: row.brand,
        price: row.price,
        unit_price: row.unit_price,
        category_hint: row.category_hint,
        description_hint: row.description_hint,
        source_url: row.source_url,
      },
      candidates: briefs,
    })
    if (!ai) {
      await applyReview(admin, row, 'La IA no devolvió JSON válido; revisión manual.', {
        candidates: scored.slice(0, 8),
      })
      return 'review_required'
    }
    const metaAi = await fetchCatalogMetaByIds(
      admin,
      [
        ...scored.slice(0, 8).map((c) => c.catalog_product_id),
        ...(ai.catalog_product_id ? [ai.catalog_product_id] : []),
      ].filter((v, i, a) => a.indexOf(v) === i),
    )
    return await applyAiDecision(admin, row, ai, metaAi)
  }

  await applyReview(admin, row, 'Confianza insuficiente para vínculo automático.', {
    candidates: scored.slice(0, 8),
  })
  return 'review_required'
}

async function applyAiDecision(
  admin: SupabaseClient,
  row: CapturedRow,
  ai: RetailAiDecision,
  meta: Map<string, CatalogMini>,
): Promise<keyof RetailHomologationCounters | 'none'> {
  if (ai.decision === 'duplicate_risk') {
    const tray: RetailLiderReviewTray = 'duplicate_risk'
    const suggested = ai.catalog_product_id ? String(ai.catalog_product_id) : null
    const groupKey = buildRetailReviewGroupKey({
      tray,
      suggestedMasterId: suggested,
      reasonSnippet: ai.reason,
    })
    await admin
      .from('retail_captured_products')
      .update({
        status: 'duplicate_risk',
        decision_source: 'ai',
        decision_confidence: ai.confidence,
        decision_reason: ai.reason,
        review_tray: tray,
        group_key: groupKey,
        suggested_master_id: suggested,
      } as never)
      .eq('id', row.id)
    await admin.from('retail_ai_match_reviews').insert({
      captured_product_id: row.id,
      retailer: row.retailer,
      title: row.title,
      brand: row.brand,
      price: row.price,
      suggested_catalog_product_id: ai.catalog_product_id,
      decision: ai.decision,
      confidence: ai.confidence,
      reason: ai.reason,
      candidates: null,
    } as never)
    return 'duplicate_risk'
  }

  if (ai.decision === 'review' || ai.confidence < AUTO_LINK_MIN) {
    const tray = inferRetailLiderReviewTrayFromReason(ai.reason)
    const suggested = ai.catalog_product_id ? String(ai.catalog_product_id) : null
    const groupKey = buildRetailReviewGroupKey({
      tray,
      suggestedMasterId: suggested,
      reasonSnippet: ai.reason,
    })
    await admin
      .from('retail_captured_products')
      .update({
        status: 'review',
        decision_source: 'ai',
        decision_confidence: ai.confidence,
        decision_reason: ai.reason,
        review_tray: tray,
        group_key: groupKey,
        suggested_master_id: suggested,
      } as never)
      .eq('id', row.id)
    await admin.from('retail_ai_match_reviews').insert({
      captured_product_id: row.id,
      retailer: row.retailer,
      title: row.title,
      brand: row.brand,
      price: row.price,
      suggested_catalog_product_id: ai.catalog_product_id,
      decision: ai.decision,
      confidence: ai.confidence,
      reason: ai.reason,
      candidates: null,
    } as never)
    return 'review_required'
  }

  if (ai.decision === 'link' && ai.catalog_product_id) {
    if (ai.confidence < AUTO_LINK_MIN) {
      await applyReview(admin, row, 'Confianza por debajo del umbral de enlace automático.', {
        suggested: ai.catalog_product_id,
        confidence: ai.confidence,
      })
      return 'review_required'
    }
    const m = meta.get(ai.catalog_product_id)
    const norm = normalizeRetailCapturedInput({
      retailer: row.retailer,
      external_ref: row.external_ref,
      source_url: row.source_url,
      title: row.title,
      brand: row.brand,
      price: row.price,
      unit_price: row.unit_price,
      category_hint: row.category_hint,
      description_hint: row.description_hint,
      image_url: null,
      raw_data: null,
    })
    if (m && !retailFormatsCompatible(norm, m.name, m.format)) {
      await applyReview(admin, row, 'La IA eligió un maestro con formato distinto; revisión.', {
        suggested: ai.catalog_product_id,
        confidence: ai.confidence,
      })
      return 'review_required'
    }
    await applyLink(admin, row, ai.catalog_product_id, 'ai', ai.confidence, ai.reason)
    await admin.from('retail_ai_match_reviews').insert({
      captured_product_id: row.id,
      retailer: row.retailer,
      title: row.title,
      brand: row.brand,
      price: row.price,
      suggested_catalog_product_id: ai.catalog_product_id,
      decision: ai.decision,
      confidence: ai.confidence,
      reason: ai.reason,
      candidates: null,
    } as never)
    return 'ai_linked'
  }

  if (ai.decision === 'new_master') {
    if (ai.confidence < NEW_MASTER_MIN) {
      await applyReview(admin, row, 'Confianza insuficiente para crear maestro automáticamente.', {
        confidence: ai.confidence,
      })
      return 'review_required'
    }
    const created = await createMasterFromCapture(admin, row, ai.confidence, ai.reason)
    if (!created.ok) {
      await applyReview(
        admin,
        row,
        row.retailer === 'lider' ?
          'Taxonomía Lider no resuelta para esta ruta, o posible duplicado. Vinculá sección/categoría en el paso de taxonomía antes de crear maestros.'
        : 'No se creó maestro: posible duplicado o datos incompletos.',
        {
          confidence: ai.confidence,
        },
      )
      return 'review_required'
    }
    await applyLink(admin, row, created.id, 'new_master', ai.confidence, ai.reason)
    await admin.from('retail_ai_match_reviews').insert({
      captured_product_id: row.id,
      retailer: row.retailer,
      title: row.title,
      brand: row.brand,
      price: row.price,
      suggested_catalog_product_id: created.id,
      decision: ai.decision,
      confidence: ai.confidence,
      reason: ai.reason,
      candidates: null,
    } as never)
    return 'new_master_created'
  }

  await applyReview(admin, row, 'Decisión de IA no aplicable automáticamente.')
  return 'review_required'
}

export async function homologateRetailCapturedBatch(
  admin: SupabaseClient,
  input: { batchId?: string | null; limit: number },
): Promise<{ processed: number; batchIds: string[] }> {
  let qb = admin
    .from('retail_captured_products')
    .select('*')
    .eq('status', 'pending')
    .limit(input.limit)

  if (input.batchId) {
    qb = qb.eq('batch_id', input.batchId)
  }

  const { data: rows, error } = await qb
  if (error || !rows?.length) {
    return { processed: 0, batchIds: [] }
  }

  const batchIds = new Set<string>()
  for (const raw of rows as CapturedRow[]) {
    await homologateSingleCapturedProduct(admin, raw)
    batchIds.add(raw.batch_id)
  }

  return { processed: rows.length, batchIds: [...batchIds] }
}
