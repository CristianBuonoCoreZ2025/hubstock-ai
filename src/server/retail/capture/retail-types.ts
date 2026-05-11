/** Entrada normalizada para staging retail (una fila capturada). */
export type RetailCapturedProductInput = {
  retailer: string
  external_ref: string
  source_url: string | null
  title: string
  brand: string | null
  price: number | null
  unit_price: string | null
  category_hint: string | null
  description_hint: string | null
  image_url: string | null
  raw_data: Record<string, unknown> | null
}

/** Decisión del motor de homologación (reglas o IA). */
export type RetailAiDecision = {
  decision: 'link' | 'review' | 'new_master' | 'duplicate_risk'
  catalog_product_id: string | null
  confidence: number
  reason: string
}

export type RetailHomologationCounters = {
  url_linked: number
  exact_linked: number
  rule_linked: number
  ai_linked: number
  new_master_created: number
  review_required: number
  duplicate_risk: number
}

export type NormalizedRetailProduct = {
  normalized_title: string
  normalized_brand: string
  format_signature: string | null
  volume_ml: number | null
}
