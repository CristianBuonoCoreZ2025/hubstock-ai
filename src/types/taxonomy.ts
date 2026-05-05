/** Taxonomía maestra: cada categoría pertenece a una sola sección. */
export type TaxonomySection = {
  id: string
  name: string
  sort_order?: number
}

export type TaxonomyCategory = {
  id: string
  name: string
  section_id: string
  sort_order?: number
}
