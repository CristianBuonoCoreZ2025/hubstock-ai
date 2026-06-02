/**
 * Plan de captura para Jumbo basado en subcategorías reales extraídas del sitio.
 * Cada subcategoría es una URL que contiene ~39 productos reales.
 */

export type JumboPageSeed = {
  page_url: string
  page_index: number
  section_slug: string
  page_number: number
}

/** Subcategorías reales extraídas de Jumbo.cl */
const JUMBO_SUBCATEGORIES = [
  // Despensa (15)
  'despensa/aceites-sal-y-condimentos',
  'despensa/aderezos-y-salsas',
  'despensa/cereales-avenas-y-barras',
  'despensa/conservas',
  'despensa/fideos-pastas-y-salsas',
  'despensa/harinas-postres-y-reposteria',
  'despensa/te-infusiones-y-mate',
  'despensa/cafe-y-cafeteras',
  'despensa/mermeladas-miel-y-otros',
  'despensa/sopas-cremas-e-instantaneos',
  'despensa/azucar-y-endulzantes',
  'despensa/arroz-quinoa-cuscus',
  'despensa/legumbres',
  'despensa/arroz-y-legumbres',
  'despensa/coctel-y-snacks',

  // Licores Bebidas y Aguas (13)
  'licores-bebidas-y-aguas/vinos',
  'licores-bebidas-y-aguas/cervezas',
  'licores-bebidas-y-aguas/destilados',
  'licores-bebidas-y-aguas/bebidas-gaseosas',
  'licores-bebidas-y-aguas/jugos',
  'licores-bebidas-y-aguas/aguas',
  'licores-bebidas-y-aguas/cocteles',
  'licores-bebidas-y-aguas/espumantes-y-sidras',
  'licores-bebidas-y-aguas/bebidas-energeticas',
  'licores-bebidas-y-aguas/licores-y-spritz',
  'licores-bebidas-y-aguas/sin-alcohol',
  'licores-bebidas-y-aguas/infusiones-frias',
  'licores-bebidas-y-aguas/bebidas-isotonicas-y-sueros',
  'licores-bebidas-y-aguas/agua-tonica-y-ginger-beer',

  // Limpieza (7)
  'limpieza/accesorios-de-limpieza',
  'limpieza/pisos-y-muebles',
  'limpieza/bano',
  'limpieza/limpieza-de-ropa',
  'limpieza/aerosoles-y-aromatizantes',
  'limpieza/papeles-hogar',
  'limpieza/cocina',

  // Quesos y Fiambres (5)
  'quesos-y-fiambres/quesos',
  'quesos-y-fiambres/fiambres',
  'quesos-y-fiambres/salchichas-y-parrilleros',
  'quesos-y-fiambres/aceitunas-pepinillos-y-otros',
  'quesos-y-fiambres/encurtidos',

  // Lacteos Huevos y Congelados (16)
  'lacteos-huevos-y-congelados/leches',
  'lacteos-huevos-y-congelados/huevos',
  'lacteos-huevos-y-congelados/hamburguesas',
  'lacteos-huevos-y-congelados/helados-y-postres',
  'lacteos-huevos-y-congelados/comidas-congeladas',
  'lacteos-huevos-y-congelados/mantequillas-y-margarinas',
  'lacteos-huevos-y-congelados/yoghurt',
  'lacteos-huevos-y-congelados/verduras-congeladas',
  'lacteos-huevos-y-congelados/leches-cultivadas-y-bebidas-lacteas',
  'lacteos-huevos-y-congelados/postres-refrigerados',
  'lacteos-huevos-y-congelados/bebidas-vegetales',
  'lacteos-huevos-y-congelados/nuggets-apanados-y-embutidos',
  'lacteos-huevos-y-congelados/frutas-y-pulpas-congeladas',
  'lacteos-huevos-y-congelados/manjar-y-dulce-de-leche',
  'lacteos-huevos-y-congelados/churrascos-lomitos-y-otros',
  'lacteos-huevos-y-congelados/hielo',

  // Carnes y Pescados (9)
  'carnes-y-pescados/vacuno',
  'carnes-y-pescados/pollo',
  'carnes-y-pescados/cerdo-y-cordero',
  'carnes-y-pescados/pavo',
  'carnes-y-pescados/pescados',
  'carnes-y-pescados/camarones',
  'carnes-y-pescados/mariscos',
  'carnes-y-pescados/gourmet-del-mar',

  // Chocolates Galletas y Snacks (6)
  'chocolates-galletas-y-snacks/chocolates',
  'chocolates-galletas-y-snacks/galletas-dulces',
  'chocolates-galletas-y-snacks/dulces',
  'chocolates-galletas-y-snacks/snacks',
  'chocolates-galletas-y-snacks/galletas-saladas',
  'chocolates-galletas-y-snacks/pastas-para-coctel-y-untables',

  // Cuidado Personal y Bebe (13)
  'cuidado-personal-y-bebe/desodorantes',
  'cuidado-personal-y-bebe/cuidado-facial',
  'cuidado-personal-y-bebe/jabones',
  'cuidado-personal-y-bebe/cuidado-capilar',
  'cuidado-personal-y-bebe/bebe',
  'cuidado-personal-y-bebe/cuidado-corporal',
  'cuidado-personal-y-bebe/higiene-bucal',
  'cuidado-personal-y-bebe/cuidado-masculino',
  'cuidado-personal-y-bebe/maquillaje',
  'cuidado-personal-y-bebe/proteccion-femenina',
  'cuidado-personal-y-bebe/solares-y-autobronceantes',
  'cuidado-personal-y-bebe/incontinencia-y-panales-adulto',
  'cuidado-personal-y-bebe/depilacion',
  'cuidado-personal-y-bebe/packs-de-cuidado-y-belleza',

  // Mascotas (3)
  'mascotas/perros',
  'mascotas/gatos',
  'mascotas/otras-mascotas',

  // Hogar Jugueteria y Libreria (6)
  'hogar-jugueteria-y-libreria/hogar',
  'hogar-jugueteria-y-libreria/jugueteria',
  'hogar-jugueteria-y-libreria/libreria-y-escolares',
  'hogar-jugueteria-y-libreria/electro-y-tecnologia',
  'hogar-jugueteria-y-libreria/automovil-ferreteria-y-jardin',
  'hogar-jugueteria-y-libreria/deportes',

  // Farmacia (6)
  'farmacia/dermocosmetica',
  'farmacia/primeros-auxilios',
  'farmacia/suplementos-y-vitaminas',
  'farmacia/accesorios-medicos',
  'farmacia/bienestar-intimo',
  'farmacia/higiene-bucal-especialidad',

  // Panaderia y Pasteleria (4)
  'panaderia-y-pasteleria/pasteleria',
  'panaderia-y-pasteleria/panaderia-envasada',
  'panaderia-y-pasteleria/masas-y-tortillas',
  'panaderia-y-pasteleria/panaderia-granel',

  // Frutas y Verduras (4)
  'frutas-y-verduras/frutas',
  'frutas-y-verduras/verduras',
  'frutas-y-verduras/frutas-y-verduras-organicas',
  'frutas-y-verduras/frutos-secos-y-semillas',

  // Experiencias Jumbo (4)
  'experiencias-jumbo/productos-importados',
  'experiencias-jumbo/marcas-exclusivas',
  'experiencias-jumbo/mundo-bio-natura',
  'experiencias-jumbo/comidas-preparadas',
]

/**
 * Genera URLs de subcategorías de Jumbo para captura.
 */
export async function discoverJumboScrappingUrlsPhase1(
  baseUrl: string,
): Promise<{ ok: true; seeds: JumboPageSeed[]; total: number } | { ok: false; error: string }> {
  const normalizedBase = baseUrl.replace(/\/+$/, '')
  const seeds: JumboPageSeed[] = []

  for (let i = 0; i < JUMBO_SUBCATEGORIES.length; i++) {
    const slug = JUMBO_SUBCATEGORIES[i]
    const section = slug.split('/')[0]
    seeds.push({
      page_url: `${normalizedBase}/${slug}`,
      page_index: i,
      section_slug: section,
      page_number: 1,
    })
  }

  console.log(`[jumbo-plan] Total seeds: ${seeds.length} subcategorías`)
  return { ok: true, seeds, total: seeds.length }
}

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

export function isJumboCategoryUrl(url: string): boolean {
  const p = url.toLowerCase()
  if (p.includes('/_v/') || p.includes('/api/') || p.includes('/busqueda')) return false
  const firstSegment = new URL(url).pathname.replace(/^\//, '').split('/')[0]
  return JUMBO_SUBCATEGORIES.some((s) => s.startsWith(firstSegment))
}
