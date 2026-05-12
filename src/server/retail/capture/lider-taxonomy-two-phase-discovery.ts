import { humanizeLiderPathSegment, inferLiderBrowseSlugFromSectionRow, parseLiderExternalTaxonomy } from '@/lib/lider-taxonomy'
import {
  LIDER_CATALOG_SECTION_STRONG_KEY,
  normalizeLiderCategoryKeyStrong,
  normalizeLiderSectionDisplay,
  normalizeLiderSectionKeyStrong,
  shouldDiscardLiderCategoryLabel,
  shouldDiscardLiderSectionLabel,
} from '@/lib/lider-taxonomy-section-heuristics'
import { discoverLiderCapturePlanUrls, resolveLiderStoreBaseUrl } from '@/server/retail/capture/lider-catalog-plan'
import { retailSweepLogInfo } from '@/lib/retail-sweep-log'

const FETCH_MS = 22000

export type LiderDiscoveredSection = {
  external_section: string
  normalized_external_section: string
  source: string
  source_url: string | null
  products_count: number
  sample_urls: string[]
  sample_product_titles: string[]
}

export type LiderDiscoveredCategory = {
  lider_section_normalized: string
  external_category: string
  normalized_external_category: string
  products_count: number
  match_method: string
}

export type LiderTaxonomyTwoPhaseResult = {
  sections: LiderDiscoveredSection[]
  categories: LiderDiscoveredCategory[]
  urls: string[]
  meta: Record<string, unknown>
}

type SectionAcc = {
  display: string
  normalized: string
  source: string
  sourceUrl: string | null
  urlHits: number
  sampleUrls: string[]
}

function mergeUnique(arr: string[], add: string, max: number) {
  if (!add || arr.includes(add)) return
  if (arr.length >= max) return
  arr.push(add)
}

async function fetchHtml(url: string): Promise<string | null> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), FETCH_MS)
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      cache: 'no-store',
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-CL,es;q=0.9',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })
    if (!res.ok) return null
    const html = await res.text()
    return html.length > 200 ? html : null
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

function extractNextDataJson(html: string): unknown | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)
  if (!m?.[1]) return null
  try {
    return JSON.parse(m[1]!.trim())
  } catch {
    return null
  }
}

function walkForNavLabels(obj: unknown, depth: number, out: Set<string>): void {
  if (depth > 16 || obj == null) return
  if (typeof obj === 'string') {
    const s = obj.trim()
    if (s.length >= 2 && s.length < 90 && !/^https?:\/\//i.test(s)) out.add(s)
    return
  }
  if (Array.isArray(obj)) {
    for (const x of obj) walkForNavLabels(x, depth + 1, out)
    return
  }
  if (typeof obj !== 'object') return
  const rec = obj as Record<string, unknown>
  for (const [k, v] of Object.entries(rec)) {
    const lk = k.toLowerCase()
    if (
      lk.includes('department') ||
      lk.includes('categorytree') ||
      lk.includes('facet') ||
      lk.includes('breadcrumb') ||
      lk === 'label' ||
      lk === 'title' ||
      lk === 'name'
    ) {
      walkForNavLabels(v, depth + 1, out)
    }
  }
}

function extractBrowseSectionsFromHtml(html: string, pageUrl: string): { display: string; url: string }[] {
  const out: { display: string; url: string }[] = []
  const re = /href=["']([^"']*\/browse\/[^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const href = m[1]!
    const inner = (m[2] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    try {
      const abs = new URL(href, pageUrl).href
      const u = new URL(abs)
      const parts = u.pathname.split('/').filter(Boolean)
      const bi = parts.findIndex((p) => p.toLowerCase() === 'browse')
      if (bi < 0 || !parts[bi + 1]) continue
      const slug = parts[bi + 1]!
      const display = inner.length >= 2 ? inner : humanizeLiderPathSegment(slug)
      out.push({ display, url: abs })
    } catch {
      /* skip */
    }
  }
  return out
}

function dedupeUrlStrings(urls: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of urls) {
    const t = u.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/** Listados bajo /browse/{slug}/…/ (al menos un nivel de categoría tras la sección). */
export function extractBrowseChildListingUrls(html: string, pageUrl: string, browseSlug: string): string[] {
  const slugLower = browseSlug.toLowerCase()
  const found = new Set<string>()
  const re = /href=["']([^"']*\/browse\/[^"'#?]+)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const href = m[1]!
    try {
      const abs = new URL(href, pageUrl).href
      const u = new URL(abs)
      const parts = u.pathname.split('/').filter(Boolean)
      const bi = parts.findIndex((p) => p.toLowerCase() === 'browse')
      if (bi < 0 || !parts[bi + 1]) continue
      if (parts[bi + 1]!.toLowerCase() !== slugLower) continue
      if (parts.length < bi + 3) continue
      found.add(abs)
      if (found.size >= 240) break
    } catch {
      /* skip */
    }
  }
  return [...found]
}

/**
 * Listados bajo /content/{slug}/{id}/browse/... extraídos desde la landing comercial.
 */
function extractContentHubChildListingUrls(html: string, pageUrl: string, contentSlug: string): string[] {
  const slugLower = contentSlug.toLowerCase()
  const found = new Set<string>()
  const re = /href=["']([^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const href = m[1]!
    try {
      const abs = new URL(href, pageUrl).href
      const u = new URL(abs)
      const parts = u.pathname.split('/').filter(Boolean)
      if (parts[0]?.toLowerCase() !== 'content' || !parts[1]) continue
      if (decodeURIComponent(parts[1]!).toLowerCase() !== slugLower) continue
      const bi = parts.findIndex((p) => p.toLowerCase() === 'browse')
      if (bi < 0 || parts.length < bi + 3) continue
      found.add(abs)
      if (found.size >= 240) break
    } catch {
      /* skip */
    }
  }
  return [...found]
}

/**
 * Amplía URLs para inferir categorías: muestras guardadas + enlaces bajo /browse/{slug}/ desde la página índice.
 */
export async function enrichLiderPlanUrlsForCategoryDiscovery(
  baseUrls: readonly string[],
  linkedSections: { external_section: string; sample_urls?: unknown }[],
): Promise<string[]> {
  const bucket: string[] = [...baseUrls]
  const origin = resolveLiderStoreBaseUrl().replace(/\/+$/, '')

  for (const row of linkedSections) {
    if (Array.isArray(row.sample_urls)) {
      for (const u of row.sample_urls) {
        if (typeof u === 'string' && u.startsWith('http')) bucket.push(u)
      }
    }
  }

  const BATCH = 4
  for (let i = 0; i < linkedSections.length; i += BATCH) {
    const group = linkedSections.slice(i, i + BATCH)
    const batches = await Promise.all(
      group.map(async (row) => {
        const slug = inferLiderBrowseSlugFromSectionRow(row)
        if (!slug) return [] as string[]

        const found: string[] = []

        const browseHub = `${origin}/browse/${encodeURIComponent(slug)}`
        const browseHtml = await fetchHtml(browseHub)
        if (browseHtml) {
          found.push(...extractBrowseChildListingUrls(browseHtml, browseHub, slug))
        }

        const contentHubCandidates = dedupeUrlStrings(
          bucket.filter((u) => {
            try {
              const parts = new URL(u).pathname.split('/').filter(Boolean)
              if (parts[0]?.toLowerCase() !== 'content' || !parts[1]) return false
              return decodeURIComponent(parts[1]!).toLowerCase() === slug.toLowerCase()
            } catch {
              return false
            }
          }),
        )

        for (const hubUrl of contentHubCandidates.slice(0, 4)) {
          const hubHtml = await fetchHtml(hubUrl)
          if (!hubHtml) continue
          found.push(...extractContentHubChildListingUrls(hubHtml, hubUrl, slug))
        }

        return dedupeUrlStrings(found)
      }),
    )
    for (const arr of batches) {
      for (const u of arr) bucket.push(u)
    }
  }

  return dedupeUrlStrings(bucket)
}

function extractBreadcrumbLabelsFromNextData(nd: unknown): string[][] {
  const trails: string[][] = []
  const visit = (o: unknown, d: number) => {
    if (d > 22 || o == null) return
    if (typeof o !== 'object') return
    const r = o as Record<string, unknown>
    const t = r['@type']
    const types = Array.isArray(t) ? t : t !== undefined ? [t] : []
    if (types.includes('BreadcrumbList') && Array.isArray(r.itemListElement)) {
      const names: string[] = []
      for (const it of r.itemListElement as unknown[]) {
        if (typeof it === 'object' && it && typeof (it as Record<string, unknown>).name === 'string') {
          names.push(String((it as Record<string, unknown>).name).trim())
        }
      }
      if (names.length) trails.push(names)
    }
    for (const v of Object.values(r)) {
      if (typeof v === 'object' && v !== null) visit(v, d + 1)
    }
  }
  visit(nd, 0)
  return trails
}

/**
 * Fase 1: secciones reales (menú, browse, JSON, breadcrumbs de muestra). Sin categorías.
 */
function accumulateSectionsFromUrls(urls: string[], byNorm: Map<string, SectionAcc>) {
  function addSection(displayRaw: string, source: string, sourceUrl: string | null, sampleUrl?: string) {
    const nrm = normalizeLiderSectionDisplay(displayRaw)
    if (!nrm) return
    if (nrm.normalized === LIDER_CATALOG_SECTION_STRONG_KEY) return
    const k = nrm.normalized
    let acc = byNorm.get(k)
    if (!acc) {
      acc = {
        display: nrm.display,
        normalized: k,
        source,
        sourceUrl: sourceUrl ?? null,
        urlHits: 0,
        sampleUrls: [],
      }
      byNorm.set(k, acc)
    }
    acc.urlHits += 1
    if (sampleUrl) mergeUnique(acc.sampleUrls, sampleUrl, 16)
    if (!acc.sourceUrl && sourceUrl) acc.sourceUrl = sourceUrl
  }

  for (const url of urls) {
    try {
      const u = new URL(url)
      const parts = u.pathname.split('/').filter(Boolean)
      const low = parts.map((p) => p.toLowerCase())
      const bi = low.indexOf('browse')
      if (bi >= 0 && parts[bi + 1]) {
        const slug = parts[bi + 1]!
        const display = humanizeLiderPathSegment(slug)
        addSection(display, 'browse_url', url, url)
      }
      if (parts[0]?.toLowerCase() === 'content' && parts[1] && parts[2]) {
        const display = humanizeLiderPathSegment(parts[1]!)
        addSection(display, 'content_hub_url', url, url)
      }
    } catch {
      /* skip */
    }
  }
}

/** Une listas descubiertas (p. ej. URLs + productos capturados) sumando conteos por sección/categoría normalizada. */
export function mergeLiderDiscoveredCategoryLists(
  a: LiderDiscoveredCategory[],
  b: LiderDiscoveredCategory[],
): LiderDiscoveredCategory[] {
  const m = new Map<string, LiderDiscoveredCategory>()
  const key = (c: LiderDiscoveredCategory) =>
    `${c.lider_section_normalized}|${c.normalized_external_category}`
  for (const c of a) {
    m.set(key(c), { ...c })
  }
  for (const c of b) {
    const k = key(c)
    const prev = m.get(k)
    if (!prev) {
      m.set(k, { ...c })
      continue
    }
    m.set(k, {
      ...prev,
      products_count: prev.products_count + c.products_count,
      match_method:
        prev.match_method === c.match_method ? prev.match_method : `${prev.match_method}+${c.match_method}`,
      external_category:
        prev.products_count >= c.products_count ? prev.external_category : c.external_category,
    })
  }
  return [...m.values()]
}

export function discoverCategoriesFromUrlsForSections(
  urls: string[],
  sectionNorms: Set<string>,
): LiderDiscoveredCategory[] {
  const acc = new Map<
    string,
    { sectionNorm: string; catNorm: string; catDisplay: string; n: number }
  >()

  for (const url of urls) {
    const labels = parseLiderExternalTaxonomy(url, null)
    if (!labels) continue
    if (shouldDiscardLiderSectionLabel(labels.external_section)) continue
    if (shouldDiscardLiderCategoryLabel(labels.external_category)) continue
    const sns = normalizeLiderSectionKeyStrong(labels.external_section)
    const cnc = normalizeLiderCategoryKeyStrong(labels.external_category)
    if (!sectionNorms.has(sns)) continue
    if (!cnc) continue
    if (sns === cnc) continue
    const key = `${sns}|${cnc}`
    const prev = acc.get(key)
    if (prev) prev.n += 1
    else
      acc.set(key, {
        sectionNorm: sns,
        catNorm: cnc,
        catDisplay: labels.external_category,
        n: 1,
      })
  }

  return [...acc.values()].map((v) => ({
    lider_section_normalized: v.sectionNorm,
    external_category: v.catDisplay,
    normalized_external_category: v.catNorm,
    products_count: v.n,
    match_method: 'listing_and_product_urls',
  }))
}

export async function runLiderTaxonomyTwoPhaseDiscovery(): Promise<LiderTaxonomyTwoPhaseResult> {
  const { urls, meta } = await discoverLiderCapturePlanUrls()
  const base = resolveLiderStoreBaseUrl()
  const byNorm = new Map<string, SectionAcc>()

  accumulateSectionsFromUrls(urls, byNorm)

  const homeUrl = `${base.replace(/\/+$/, '')}/`
  const homeHtml = await fetchHtml(homeUrl)
  if (homeHtml) {
    for (const { display, url } of extractBrowseSectionsFromHtml(homeHtml, homeUrl)) {
      const nrm = normalizeLiderSectionDisplay(display)
      if (!nrm) continue
      if (nrm.normalized === LIDER_CATALOG_SECTION_STRONG_KEY) continue
      let acc = byNorm.get(nrm.normalized)
      if (!acc) {
        acc = {
          display: nrm.display,
          normalized: nrm.normalized,
          source: 'homepage_nav',
          sourceUrl: homeUrl,
          urlHits: 0,
          sampleUrls: [],
        }
        byNorm.set(nrm.normalized, acc)
      }
      acc.urlHits += 1
      mergeUnique(acc.sampleUrls, url, 16)
    }

    const nd = extractNextDataJson(homeHtml)
    if (nd) {
      const labels = new Set<string>()
      walkForNavLabels(nd, 0, labels)
      for (const lab of labels) {
        if (/breadcrumb/i.test(lab)) continue
        const n = normalizeLiderSectionDisplay(lab)
        if (!n || n.normalized === LIDER_CATALOG_SECTION_STRONG_KEY) continue
        let acc = byNorm.get(n.normalized)
        if (!acc) {
          acc = {
            display: n.display,
            normalized: n.normalized,
            source: 'embedded_json',
            sourceUrl: homeUrl,
            urlHits: 0,
            sampleUrls: [],
          }
          byNorm.set(n.normalized, acc)
        }
        acc.urlHits += 1
        mergeUnique(acc.sampleUrls, homeUrl, 16)
      }
    }
  }

  const ipUrls = urls.filter((u) => /\/ip\//i.test(u)).slice(0, 22)
  for (const url of ipUrls) {
    const html = await fetchHtml(url)
    if (!html) continue
    const nd = extractNextDataJson(html)
    if (!nd) continue
    for (const trail of extractBreadcrumbLabelsFromNextData(nd)) {
      if (trail.length < 2) continue
      const top = trail[0]!.trim()
      if (!top || shouldDiscardLiderSectionLabel(top)) continue
      const n = normalizeLiderSectionDisplay(top)
      if (!n || n.normalized === LIDER_CATALOG_SECTION_STRONG_KEY) continue
      let acc = byNorm.get(n.normalized)
      if (!acc) {
        acc = {
          display: n.display,
          normalized: n.normalized,
          source: 'product_breadcrumb',
          sourceUrl: url,
          urlHits: 0,
          sampleUrls: [],
        }
        byNorm.set(n.normalized, acc)
      }
      acc.urlHits += 1
      mergeUnique(acc.sampleUrls, url, 16)
    }
  }

  const sections: LiderDiscoveredSection[] = [...byNorm.values()].map((acc) => ({
    external_section: acc.display,
    normalized_external_section: acc.normalized,
    source: acc.source,
    source_url: acc.sourceUrl,
    products_count: acc.urlHits,
    sample_urls: acc.sampleUrls.slice(0, 24),
    sample_product_titles: [],
  }))

  sections.sort((a, b) => b.products_count - a.products_count)

  const sectionNorms = new Set(sections.map((s) => s.normalized_external_section))
  const urlsForCategories = dedupeUrlStrings([...urls, ...sections.flatMap((s) => s.sample_urls)])
  const categories = discoverCategoriesFromUrlsForSections(urlsForCategories, sectionNorms)

  retailSweepLogInfo('taxonomía Lider dos fases', {
    sections: sections.length,
    categories: categories.length,
    urls: urls.length,
    urlsForCategories: urlsForCategories.length,
    meta: meta as unknown as Record<string, unknown>,
  })

  return {
    sections,
    categories,
    urls,
    meta: meta as unknown as Record<string, unknown>,
  }
}
