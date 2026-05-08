import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/server/supabase-admin'
import { getServerEnv } from '@/server/env'
import { getSearchTermPairs, normalizeSearchText } from '@/lib/search'
import { perfLog } from '@/lib/perf-log'

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

function badRequest(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status })
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return badRequest('not_available', 404)
  }

  const env = getServerEnv()
  const url = new URL(request.url)

  const token = url.searchParams.get('token') ?? request.headers.get('x-debug-token')
  if (!env.DEBUG_API_TOKEN) {
    return badRequest('missing_DEBUG_API_TOKEN', 400)
  }
  if (!token || token !== env.DEBUG_API_TOKEN) {
    return badRequest('forbidden', 403)
  }

  const search = url.searchParams.get('search') ?? ''
  const sectionId = url.searchParams.get('sectionId') ?? 'all'
  const categoryId = url.searchParams.get('categoryId') ?? 'all'
  const brandId = url.searchParams.get('brandId') ?? 'all'
  const includeInactive = (url.searchParams.get('includeInactive') ?? '0') === '1'
  const page = Math.max(0, Number(url.searchParams.get('page') ?? 0) || 0)
  const pageSize = Math.max(1, Math.min(200, Number(url.searchParams.get('pageSize') ?? 100) || 100))
  const fn = (url.searchParams.get('fn') ?? 'v1').toLowerCase()

  const reqId =
    globalThis.crypto?.randomUUID?.() ??
    `req_${Date.now()}_${Math.random().toString(16).slice(2)}`

  const norm = normalizeSearchText(search)
  const pairs = getSearchTermPairs(search)
  const strict = pairs.strict.length > 0 ? pairs.strict : norm.length >= 2 ? [norm] : []
  const loose = pairs.loose.length > 0 ? pairs.loose : strict

  if (strict.length === 0) {
    return NextResponse.json({
      ok: true,
      reqId,
      timings: { totalMs: 0, rpcMs: 0 },
      result: { items: [], total: 0 },
    })
  }

  let admin
  try {
    admin = createServiceRoleClient()
  } catch {
    return badRequest('missing_SUPABASE_SERVICE_ROLE_KEY', 400)
  }

  const t0 = nowMs()
  perfLog('debug.catalogSearch.start', {
    reqId,
    fn,
    searchLen: search.trim().length,
    termsStrict: strict.length,
    page,
    pageSize,
    includeInactive,
    sectionId,
    categoryId,
    brandId,
  })

  const rpcT0 = nowMs()
  const rpcFn =
    fn === 'v2' ? 'catalog_products_search_page_v2' : 'catalog_products_search_page'
  const { data, error } = await admin.rpc(rpcFn as never, {
    p_terms_strict: strict,
    p_terms_loose: loose,
    p_full_norm: norm,
    p_section_id: sectionId === 'all' ? null : sectionId,
    p_category_id: categoryId === 'all' ? null : categoryId,
    p_brand_filter_id: brandId === 'all' ? null : brandId,
    p_include_inactive: includeInactive,
    p_page: page,
    p_page_size: pageSize,
  } as never)
  const rpcMs = Math.max(0, nowMs() - rpcT0)

  if (error) {
    perfLog('debug.catalogSearch.rpc.error', { reqId, rpcMs, fn, rpcFn })
    return NextResponse.json(
      { ok: false, reqId, error: 'rpc_error', details: error.message },
      { status: 500 }
    )
  }

  const rows = Array.isArray(data) ? data : data ? [data] : []
  const totalRaw = (rows[0] as { total_count?: unknown } | undefined)?.total_count
  const total =
    totalRaw === null || totalRaw === undefined
      ? rows.length
      : typeof totalRaw === 'string'
        ? Number(totalRaw)
        : typeof totalRaw === 'number'
          ? totalRaw
          : rows.length

  const totalMs = Math.max(0, nowMs() - t0)
  perfLog('debug.catalogSearch.done', { reqId, totalMs, rpcMs, fn, rpcFn, rows: rows.length, total })

  return NextResponse.json({
    ok: true,
    reqId,
    timings: { totalMs, rpcMs },
    input: {
      search,
      norm,
      strict,
      loose,
      fn,
      page,
      pageSize,
      includeInactive,
      sectionId,
      categoryId,
      brandId,
    },
    result: {
      rows: rows.length,
      total,
      // No devolvemos data completa para no exponer catálogo por debug.
    },
  })
}

