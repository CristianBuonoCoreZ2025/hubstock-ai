/**
 * Plan de captura para Jumbo: genera URLs de secciones principales con paginación.
 * URLs tipo: /despensa, /despensa?page=2, /despensa?page=3...
 */

export type JumboPageSeed = {
  page_url: string
  page_index: number
  /** Sección principal */
  section_slug: string
  /** Número de página */
  page_number: number
}

/** Configuración de secciones principales de Jumbo con sus páginas máximas */
const JUMBO_SECTIONS = [
  { slug: 'despensa', maxPages: 92 },
  { slug: 'licores-bebidas-y-aguas', maxPages: 87 },
  { slug: 'limpieza', maxPages: 42 },
  { slug: 'quesos-y-fiambres', maxPages: 28 },
  { slug: 'lacteos-huevos-y-congelados', maxPages: 46 },
  { slug: 'carnes-y-pescados', maxPages: 12 },
  { slug: 'chocolates-galletas-y-snacks', maxPages: 25 },
  { slug: 'cuidado-personal-y-bebe', maxPages: 35 },
  { slug: 'mascotas', maxPages: 20 },
  { slug: 'hogar-jugueteria-y-libreria', maxPages: 30 },
  { slug: 'farmacia', maxPages: 15 },
  { slug: 'panaderia-y-pasteleria', maxPages: 18 },
  { slug: 'frutas-y-verduras', maxPages: 22 },
  { slug: 'experiencias-jumbo', maxPages: 8 },
]

/**
 * Genera URLs de secciones principales de Jumbo con paginación.
 * Ej: /despensa, /despensa?page=2, /despensa?page=3...
 */
export async function discoverJumboScrappingUrlsPhase1(
  baseUrl: string,
  options?: {
    /** Máximo de páginas por sección (override al default de JUMBO_SECTIONS) */
    maxPagesOverride?: number
  },
): Promise<{ ok: true; seeds: JumboPageSeed[]; total: number } | { ok: false; error: string }> {
  const normalizedBase = baseUrl.replace(/\/+$/, '')

  console.log(`[jumbo-plan] Generando URLs de secciones principales en ${normalizedBase}`)

  const seeds: JumboPageSeed[] = []
  let pageIndex = 0

  for (const section of JUMBO_SECTIONS) {
    const maxPages = options?.maxPagesOverride
      ? Math.min(options.maxPagesOverride, section.maxPages)
      : section.maxPages

    for (let page = 1; page <= maxPages; page++) {
      const paginatedUrl = page === 1
        ? `${normalizedBase}/${section.slug}`
        : `${normalizedBase}/${section.slug}?page=${page}`

      seeds.push({
        page_url: paginatedUrl,
        page_index: pageIndex++,
        section_slug: section.slug,
        page_number: page,
      })
    }
  }

  console.log(`[jumbo-plan] Total seeds generados: ${seeds.length} (${JUMBO_SECTIONS.length} secciones)`)

  return { ok: true, seeds, total: seeds.length }
}

/**
 * Calcula la siguiente página de un listado Jumbo.
 */
export function nextJumboCategoryPageUrl(currentUrl: string): string | null {
  try {
    const url = new URL(currentUrl)
    const page = parseInt(url.searchParams.get('page') ?? '1', 10)
    url.searchParams.set('page', String(page + 1))
    return url.toString()
  } catch {
    return null
  }
}

/**
 * Determina si una URL es de sección principal Jumbo (/despensa, /limpieza, etc).
 */
export function isJumboCategoryUrl(url: string): boolean {
  const p = url.toLowerCase()
  // Excluye API endpoints y buscadores
  if (p.includes('/_v/') || p.includes('/api/') || p.includes('/busqueda') || p.includes('/busca')) {
    return false
  }
  // Incluye URLs tipo /despensa o /despensa?page=2
  const pathname = new URL(url).pathname.replace(/^\//, '').replace(/\/.*$/, '')
  return JUMBO_SECTIONS.some((s) => s.slug === pathname)
}
