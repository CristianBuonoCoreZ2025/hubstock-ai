import {
  LIDER_CATALOG_SECTION_STRONG_KEY,
  normalizeLiderCategoryKeyStrong,
  normalizeLiderSectionKeyStrong,
} from '@/lib/lider-taxonomy-section-heuristics'

export type LiderExternalTaxonomy = {
  external_section: string
  external_category: string
}

/** Convierte segmento de URL (slug) a etiqueta legible. */
export function humanizeLiderPathSegment(segment: string): string {
  try {
    const dec = decodeURIComponent(segment).replace(/-/g, ' ').trim()
    if (!dec) return ''
    return dec
      .split(/\s+/)
      .map((w, i) => {
        if (!w) return w
        if (i === 0) return w[0]!.toUpperCase() + w.slice(1).toLowerCase()
        return w.length <= 2 ? w : w[0]!.toUpperCase() + w.slice(1).toLowerCase()
      })
      .join(' ')
  } catch {
    return segment.replace(/-/g, ' ').trim()
  }
}

/**
 * Cola de URL /browse/.../60338008_85836428_40470033: identificador de listado/colección, no nombre de categoría.
 */
export function isLiderBrowsePathTailCollectionId(segment: string): boolean {
  const t = segment.trim()
  if (t.length < 8) return false
  if (!/^\d[\d_]+$/.test(t)) return false
  const chunks = t.split('_').filter(Boolean)
  if (chunks.length < 2) return false
  return chunks.every((c) => /^\d+$/.test(c))
}

/**
 * Slug del primer segmento tras `/browse/` a partir de URLs de muestra, o desde el nombre de sección (p. ej. La Boti → la-boti).
 */
export function inferLiderBrowseSlugFromSectionRow(input: {
  external_section: string
  sample_urls?: unknown
}): string | null {
  if (Array.isArray(input.sample_urls)) {
    for (const u of input.sample_urls) {
      if (typeof u !== 'string' || !u.startsWith('http')) continue
      try {
        const parts = new URL(u).pathname.split('/').filter(Boolean)
        const bi = parts.findIndex((p) => p.toLowerCase() === 'browse')
        if (bi >= 0 && parts[bi + 1]) {
          const seg = parts[bi + 1]!.trim()
          if (seg) return decodeURIComponent(seg).toLowerCase()
        }
      } catch {
        /* seguir */
      }
    }
  }
  const k = normalizeLiderSectionKeyStrong(input.external_section)
  if (!k) return null
  return k.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

function parseTaxonomyFromCategoryHint(categoryHint: string): LiderExternalTaxonomy | null {
  const parts = categoryHint
    .split(/›|>|\u203a/g)
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length >= 2) {
    return {
      external_section: parts[0]!,
      external_category: parts[parts.length - 1]!,
    }
  }
  if (parts.length === 1) {
    return { external_section: 'Catálogo Lider', external_category: parts[0]! }
  }
  return null
}

/**
 * Listados /browse/{sección}/[categoría[/subcategoría…]]/[id_numérico].
 * Si el último segmento es id de colección, los segmentos intermedios forman la ruta de categoría (breadcrumb).
 */
function parseBrowsePathTaxonomy(parts: string[], lower: string[]): LiderExternalTaxonomy | null {
  const bi = lower.findIndex((p) => p === 'browse')
  if (bi < 0 || !parts[bi + 1]) return null

  const external_section = humanizeLiderPathSegment(parts[bi + 1]!)
  if (!external_section) return null

  if (parts.length <= bi + 2) {
    return { external_section, external_category: external_section }
  }

  const lastIdx = parts.length - 1
  const lastSeg = parts[lastIdx]!

  if (isLiderBrowsePathTailCollectionId(lastSeg)) {
    const catSegs = parts.slice(bi + 2, lastIdx)
    if (catSegs.length === 0) {
      return { external_section, external_category: external_section }
    }
    const only = catSegs[0]!
    if (catSegs.length === 1 && isLiderBrowsePathTailCollectionId(only)) {
      return { external_section, external_category: external_section }
    }
    const labels = catSegs.map((s) => humanizeLiderPathSegment(s)).filter(Boolean)
    const external_category = labels.length ? labels.join(' › ') : external_section
    return { external_section, external_category }
  }

  const catSegs = parts.slice(bi + 2)
  const labels = catSegs.map((s) => humanizeLiderPathSegment(s)).filter(Boolean)
  const external_category = labels.length ? labels.join(' › ') : external_section
  return { external_section, external_category }
}

/**
 * Infiere sección/categoría Lider desde URL de PDP/listado o desde category_hint de captura.
 */
export function parseLiderExternalTaxonomy(
  sourceUrl: string | null | undefined,
  categoryHint: string | null | undefined,
): LiderExternalTaxonomy | null {
  if (sourceUrl) {
    try {
      const u = new URL(sourceUrl)
      const parts = u.pathname.split('/').filter(Boolean)
      const lower = parts.map((p) => p.toLowerCase())
      if (lower[0] === 'content' && parts[1] && parts[2]) {
        const external_section = humanizeLiderPathSegment(parts[1]!)
        if (external_section) {
          const browseIdxAfterHub = lower.indexOf('browse', 3)
          if (browseIdxAfterHub >= 3 && parts[browseIdxAfterHub + 1]) {
            const tailParts = parts.slice(browseIdxAfterHub)
            const tailLower = lower.slice(browseIdxAfterHub)
            const browseTax = parseBrowsePathTaxonomy(tailParts, tailLower)
            if (browseTax && browseTax.external_category && browseTax.external_category !== browseTax.external_section) {
              return {
                external_section,
                external_category: browseTax.external_category,
              }
            }
            return {
              external_section,
              external_category: humanizeLiderPathSegment(parts[browseIdxAfterHub + 1]!) || external_section,
            }
          }
          if (parts[3]) {
            const subSeg = parts[3]!
            if (!isLiderBrowsePathTailCollectionId(subSeg)) {
              const sub = humanizeLiderPathSegment(subSeg)
              if (sub) return { external_section, external_category: sub }
            }
          }
          return {
            external_section,
            external_category: external_section,
          }
        }
      }
      const ipIdx = lower.indexOf('ip')
      if (ipIdx >= 0 && parts[ipIdx + 1]) {
        const slug = parts[ipIdx + 1]!
        let external_section = 'Catálogo Lider'
        const browseIdx = lower.findIndex((p) => p === 'browse')
        if (browseIdx >= 0 && parts[browseIdx + 1]) {
          external_section = humanizeLiderPathSegment(parts[browseIdx + 1]!)
        }
        const fromUrl: LiderExternalTaxonomy = {
          external_section,
          external_category: humanizeLiderPathSegment(slug),
        }
        if (
          normalizeLiderSectionKeyStrong(fromUrl.external_section) === LIDER_CATALOG_SECTION_STRONG_KEY &&
          categoryHint
        ) {
          const hinted = parseTaxonomyFromCategoryHint(categoryHint)
          if (
            hinted &&
            normalizeLiderSectionKeyStrong(hinted.external_section) !== LIDER_CATALOG_SECTION_STRONG_KEY
          ) {
            return hinted
          }
        }
        return fromUrl
      }
      const browseTax = parseBrowsePathTaxonomy(parts, lower)
      if (browseTax) {
        return browseTax
      }
    } catch {
      /* seguir con category_hint */
    }
  }

  if (categoryHint) {
    return parseTaxonomyFromCategoryHint(categoryHint)
  }
  return null
}

export function taxonomyKeysFromLiderCapture(
  sourceUrl: string | null | undefined,
  categoryHint: string | null | undefined,
): { ns: string; nc: string; labels: LiderExternalTaxonomy } | null {
  const labels = parseLiderExternalTaxonomy(sourceUrl, categoryHint)
  if (!labels) return null
  const ns = normalizeLiderSectionKeyStrong(labels.external_section)
  const nc = normalizeLiderCategoryKeyStrong(labels.external_category)
  if (!nc) return null
  return { ns, nc, labels }
}
