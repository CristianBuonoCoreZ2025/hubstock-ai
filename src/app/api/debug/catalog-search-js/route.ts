import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/server/supabase-admin'
import { getServerEnv } from '@/server/env'
import {
  matchesSearch,
  normalizeSearchText,
  rankCatalogProductRelevance,
  searchTermsFromQuery,
} from '@/lib/search'

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

function badRequest(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status })
}

function escapeIlikePattern(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

const MAX_IDS = 4500
const PAGE_DEFAULT = 100

type CandidateRow = {
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
}

async function collectCandidateIds(admin: ReturnType<typeof createServiceRoleClient>, searchRaw: string) {
  const norm = normalizeSearchText(searchRaw)
  const terms = searchTermsFromQuery(searchRaw)
  if (!norm || terms.length === 0) return { ids: [] as string[], truncated: false }

  const idSet = new Set<string>()
  let truncated = false

  const take = (rows: { id: string }[] | null | undefined) => {
    for (const r of rows ?? []) {
      idSet.add(r.id)
      if (idSet.size >= MAX_IDS) {
        truncated = true
        return true
      }
    }
    return false
  }

  const orName = terms.map((t) => `name.ilike.%${escapeIlikePattern(t)}%`).join(',')
  const orBrand = terms.map((t) => `brand.ilike.%${escapeIlikePattern(t)}%`).join(',')

  const [{ data: w1 }, { data: w2 }] = await Promise.all([
    admin.from('catalog_products').select('id').or(orName).limit(2000),
    admin.from('catalog_products').select('id').or(orBrand).limit(1200),
  ])
  if (take(w1 as { id: string }[])) return { ids: [...idSet], truncated }
  if (take(w2 as { id: string }[])) return { ids: [...idSet], truncated }

  // Alias
  const likeAlias = `%${escapeIlikePattern(norm)}%`
  const { data: aliasRows } = await admin
    .from('catalog_product_aliases')
    .select('catalog_product_id')
    .ilike('alias_normalized', likeAlias)
    .limit(1200)
  const aliasIds = [...new Set((aliasRows ?? []).map((a: { catalog_product_id: string }) => a.catalog_product_id))]
  const CHUNK = 120
  for (let i = 0; i < aliasIds.length; i += CHUNK) {
    const chunk = aliasIds.slice(i, i + CHUNK)
    const { data } = await admin.from('catalog_products').select('id').in('id', chunk).limit(1200)
    if (take(data as { id: string }[])) return { ids: [...idSet], truncated }
  }

  return { ids: [...idSet], truncated }
}

async function fetchCandidates(
  admin: ReturnType<typeof createServiceRoleClient>,
  ids: string[]
): Promise<CandidateRow[]> {
  if (ids.length === 0) return []
  const out: CandidateRow[] = []
  const chunkSize = 400
  for (let i = 0; i < ids.length; i += chunkSize) {
    const slice = ids.slice(i, i + chunkSize)
    const { data } = await admin
      .from('catalog_products')
      .select('id,name,brand,brand_id,format,unit,default_reference_price,sort_order,active,section_id,category_id')
      .in('id', slice)
    for (const r of (data ?? []) as CandidateRow[]) out.push(r)
  }
  return out
}

async function fetchAliasesMap(
  admin: ReturnType<typeof createServiceRoleClient>,
  ids: string[]
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (ids.length === 0) return map

  const chunkSize = 400
  for (let i = 0; i < ids.length; i += chunkSize) {
    const slice = ids.slice(i, i + chunkSize)
    const { data } = await admin
      .from('catalog_product_aliases')
      .select('catalog_product_id, alias_normalized')
      .in('catalog_product_id', slice)
      .limit(8000)
    for (const r of (data ?? []) as { catalog_product_id: string; alias_normalized: string }[]) {
      const arr = map.get(r.catalog_product_id) ?? []
      arr.push(r.alias_normalized)
      map.set(r.catalog_product_id, arr)
    }
  }

  return map
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') return badRequest('not_available', 404)

  const env = getServerEnv()
  const url = new URL(request.url)
  const token = url.searchParams.get('token') ?? request.headers.get('x-debug-token')
  if (!env.DEBUG_API_TOKEN) return badRequest('missing_DEBUG_API_TOKEN', 400)
  if (!token || token !== env.DEBUG_API_TOKEN) return badRequest('forbidden', 403)

  const search = url.searchParams.get('search') ?? ''
  const page = Math.max(0, Number(url.searchParams.get('page') ?? 0) || 0)
  const pageSize = Math.max(1, Math.min(200, Number(url.searchParams.get('pageSize') ?? PAGE_DEFAULT) || PAGE_DEFAULT))

  let admin
  try {
    admin = createServiceRoleClient()
  } catch {
    return badRequest('missing_SUPABASE_SERVICE_ROLE_KEY', 400)
  }

  const t0 = nowMs()
  const c0 = nowMs()
  const { ids, truncated } = await collectCandidateIds(admin, search)
  const candidateIdMs = Math.max(0, nowMs() - c0)

  const f0 = nowMs()
  const [candidates, aliasMap] = await Promise.all([
    fetchCandidates(admin, ids),
    fetchAliasesMap(admin, ids),
  ])
  const fetchMs = Math.max(0, nowMs() - f0)

  const r0 = nowMs()
  const filtered = candidates.filter((c) => {
    const aliasTexts = aliasMap.get(c.id) ?? []
    const presentation = [c.format, c.unit].filter(Boolean).join(' ')
    const haystack = [c.name, c.brand ?? '', presentation, ...aliasTexts].filter(
      (s): s is string => Boolean(s)
    )
    return matchesSearch(haystack, search)
  })

  const ranked = filtered
    .map((c) => {
      const aliasTexts = aliasMap.get(c.id) ?? []
      const presentation = [c.format, c.unit].filter(Boolean).join(' ')
      const score = rankCatalogProductRelevance(search, {
        productName: c.name,
        brandCanonical: null,
        brandText: c.brand,
        categoryName: null,
        sectionName: null,
        presentation: presentation || null,
        aliasTexts,
      })
      return { c, score }
    })
    .sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name, 'es', { sensitivity: 'base' }))
  const rankMs = Math.max(0, nowMs() - r0)

  const total = ranked.length
  const from = page * pageSize
  const slice = ranked.slice(from, from + pageSize)
  const totalMs = Math.max(0, nowMs() - t0)

  return NextResponse.json({
    ok: true,
    input: { search, page, pageSize },
    candidate: { ids: ids.length, candidates: candidates.length, filtered: filtered.length, truncated },
    result: { pageRows: slice.length, total },
    timings: { totalMs, candidateIdMs, fetchMs, rankMs },
  })
}

