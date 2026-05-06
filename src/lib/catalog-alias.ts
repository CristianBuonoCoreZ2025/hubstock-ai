/** Normalización de texto para catalog_product_aliases.alias_normalized */
export function normalizeCatalogAlias(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}
