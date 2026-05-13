import type {
  LiderDiscoveredCategory,
  LiderDiscoveredSection,
  LiderTaxonomyTwoPhaseResult,
} from '@/server/retail/capture/lider-taxonomy-two-phase-discovery'
import { resolveLiderStoreBaseUrl } from '@/server/retail/capture/lider-catalog-plan'

function sortedUniqueStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
}

/** Slug inmediatamente después de `/browse/` en cada URL del plan (referencia rápida). */
function collectBrowseFirstSlugs(urls: readonly string[]): string[] {
  const out = new Set<string>()
  for (const raw of urls) {
    try {
      const u = new URL(raw)
      const parts = u.pathname.split('/').filter(Boolean)
      const bi = parts.findIndex((p) => p.toLowerCase() === 'browse')
      if (bi < 0 || !parts[bi + 1]) continue
      out.add(decodeURIComponent(parts[bi + 1]!).trim())
    } catch {
      /* URL inválida */
    }
  }
  return sortedUniqueStrings(out)
}

/** Primer segmento de ruta bajo `/content/` (hubs comerciales). */
function collectContentHubSlugs(urls: readonly string[]): string[] {
  const out = new Set<string>()
  for (const raw of urls) {
    try {
      const u = new URL(raw)
      const parts = u.pathname.split('/').filter(Boolean)
      if (parts[0]?.toLowerCase() !== 'content' || !parts[1]) continue
      out.add(decodeURIComponent(parts[1]!).trim())
    } catch {
      /* URL inválida */
    }
  }
  return sortedUniqueStrings(out)
}

function formatSectionRow(s: LiderDiscoveredSection, index: number): string {
  const samples = (s.sample_urls ?? []).slice(0, 6).join('\n    ')
  return [
    `${index + 1}. ${s.external_section}`,
    `    normalizado: ${s.normalized_external_section}`,
    `    fuente: ${s.source}`,
    `    evidencias (hits URL): ${s.products_count}`,
    `    source_url: ${s.source_url ?? '—'}`,
    samples ? `    muestras:\n    ${samples}` : '    muestras: —',
  ].join('\n')
}

function formatCategoryRow(c: LiderDiscoveredCategory, index: number): string {
  return [
    `${index + 1}. [sección ${c.lider_section_normalized}] ${c.external_category}`,
    `    categoría normalizada: ${c.normalized_external_category}`,
    `    coincidencias URL (aprox.): ${c.products_count}`,
    `    método: ${c.match_method}`,
  ].join('\n')
}

/**
 * Texto plano para revisar qué secciones y categorías infiere el descubrimiento Lider
 * antes de capturar productos (no incluye SKUs ni títulos de producto).
 */
export function buildLiderTaxonomyDiscoveryReportText(result: LiderTaxonomyTwoPhaseResult): string {
  const lines: string[] = []
  const now = new Date().toISOString()
  const origin = resolveLiderStoreBaseUrl()

  lines.push('================================================================================')
  lines.push('LIDER — Log de descubrimiento (solo secciones y categorías, sin productos)')
  lines.push('================================================================================')
  lines.push(`Generado (UTC): ${now}`)
  lines.push(`RETAIL_LIDER_STORE_ORIGIN / base: ${origin}`)
  lines.push('')
  lines.push('Este informe refleja el mismo barrido que usa «Detectar taxonomía Lider»:')
  lines.push('- Plan de URLs (sitemap, home, semillas content, env).')
  lines.push('- Secciones: rutas /browse/…, hubs /content/…, navegación home, breadcrumbs de muestras /ip/.')
  lines.push(
    '- Categorías: parseo de URLs del plan más enlaces hijos leídos desde cada índice /browse/{sección}/ y, cuando aplica, landings /content/{slug}/ (sin catálogo de productos).',
  )
  lines.push('')

  const meta = result.meta ?? {}
  lines.push('--- Meta del descubrimiento de URLs del plan ---')
  for (const key of Object.keys(meta).sort()) {
    const v = meta[key]
    lines.push(
      `${key}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`,
    )
  }
  lines.push('')
  lines.push(`Total URLs en plan: ${result.urls.length}`)

  const browseSlugs = collectBrowseFirstSlugs(result.urls)
  lines.push('')
  lines.push(`Slugs únicos tras /browse/ en el plan (${browseSlugs.length})`)
  for (const s of browseSlugs) {
    lines.push(`  - ${s}`)
  }

  const contentSlugs = collectContentHubSlugs(result.urls)
  lines.push('')
  lines.push(`Slugs únicos bajo /content/ en el plan (${contentSlugs.length})`)
  for (const s of contentSlugs) {
    lines.push(`  - ${s}`)
  }

  const sortedUrls = [...result.urls].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
  const maxUrls = 200
  lines.push('')
  lines.push(`Listado de URLs del plan (alfabético, máximo ${maxUrls} de ${sortedUrls.length})`)
  for (const u of sortedUrls.slice(0, maxUrls)) {
    lines.push(`  ${u}`)
  }
  if (sortedUrls.length > maxUrls) {
    lines.push(`  … (${sortedUrls.length - maxUrls} URLs omitidas por tamaño)`)
  }

  const sections = [...result.sections].sort((a, b) =>
    a.external_section.localeCompare(b.external_section, 'es', { sensitivity: 'base' }),
  )
  lines.push('')
  lines.push('================================================================================')
  lines.push(`SECCIONES INFERIDAS (${sections.length})`)
  lines.push('================================================================================')
  sections.forEach((s, i) => {
    lines.push(formatSectionRow(s, i))
    lines.push('')
  })

  const categories = [...result.categories].sort((a, b) => {
    const sa = `${a.lider_section_normalized}|${a.external_category}`
    const sb = `${b.lider_section_normalized}|${b.external_category}`
    return sa.localeCompare(sb, 'es', { sensitivity: 'base' })
  })
  lines.push('================================================================================')
  lines.push(`CATEGORÍAS INFERIDAS DESDE URLs (${categories.length})`)
  lines.push('================================================================================')
  categories.forEach((c, i) => {
    lines.push(formatCategoryRow(c, i))
    lines.push('')
  })

  lines.push('--- Fin del informe ---')
  return lines.join('\n')
}
