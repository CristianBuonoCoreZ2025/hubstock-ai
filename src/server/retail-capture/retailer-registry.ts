/**
 * Catálogo de cadenas retail soportadas por captura web / JSON en la app.
 * Los scrapers locales (p. ej. SQLite Lider) siguen en scripts/; esta lista es la fuente de verdad para UI y validación.
 */

export type RetailerCode = 'lider' | 'jumbo' | 'central_mayorista'

export type RetailerDefinition = {
  code: RetailerCode
  label: string
  /** Variable de entorno para URL base VTEX; vacío = solo JSON o default Jumbo */
  vtexBaseUrlEnvVar: string | null
  /** Si hay URL por defecto sin env (solo Jumbo hoy) */
  defaultVtexBaseUrl: string | null
  help: string
}

export const RETAILER_REGISTRY: RetailerDefinition[] = [
  {
    code: 'jumbo',
    label: 'Jumbo',
    vtexBaseUrlEnvVar: 'RETAIL_JUMBO_VTEX_BASE_URL',
    defaultVtexBaseUrl: 'https://www.jumbo.cl',
    help: 'Captura por API pública VTEX. Opcional: RETAIL_JUMBO_VTEX_BASE_URL si usás otro host.',
  },
  {
    code: 'lider',
    label: 'Lider',
    vtexBaseUrlEnvVar: 'RETAIL_LIDER_VTEX_BASE_URL',
    defaultVtexBaseUrl: null,
    help:
      'Captura en vivo desde el sitio (HTML). Opcional: RETAIL_LIDER_STORE_ORIGIN o RETAIL_LIDER_VTEX_BASE_URL. Catálogo masivo: cola de listados; RETAIL_LIDER_STOREFRONT_BROWSE_URLS agrega rutas /browse/. Volumen offline: carpeta lider/ + scripts.',
  },
  {
    code: 'central_mayorista',
    label: 'Central Mayorista',
    vtexBaseUrlEnvVar: 'RETAIL_CENTRAL_MAYORISTA_VTEX_BASE_URL',
    defaultVtexBaseUrl: null,
    help: 'Usá la URL base VTEX de centralmayorista.cl (no la tienda HTML sola). Import JSON si la API falla.',
  },
]

export function retailerDefinition(code: string): RetailerDefinition | undefined {
  return RETAILER_REGISTRY.find((r) => r.code === code)
}
