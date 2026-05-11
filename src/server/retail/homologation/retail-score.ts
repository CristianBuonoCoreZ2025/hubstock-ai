import { normalizeSearchText } from '@/lib/search'
import {
  enrichRetailCandidatesCompositeScore,
  type MatchCandidate,
} from '@/lib/retail-association'
import type { NormalizedRetailProduct } from '@/server/retail/capture/retail-types'
import { extractFormatSignature, volumeMlFromSignature } from '@/server/retail/normalize/normalize-retail-product'

const FORMAT_TOLERANCE_RATIO = 0.12

export type ScoredCatalogCandidate = MatchCandidate & {
  format_ok: boolean
}

function normFmt(s: string | null | undefined): string | null {
  const x = extractFormatSignature(s ?? '')
  return x ? normalizeSearchText(x) : null
}

/**
 * true si no hay señal de formato en uno de los lados, o si son compatibles (misma magnitud).
 */
export function retailFormatsCompatible(
  captured: NormalizedRetailProduct,
  catalogName: string,
  catalogFormat: string | null,
): boolean {
  const capSig = captured.format_signature
  const catSig =
    normFmt(catalogFormat) ?? normFmt(catalogName) ?? null
  if (!capSig && !catSig) return true
  if (!capSig || !catSig) {
    return true
  }
  const a = captured.volume_ml
  const b = volumeMlFromSignature(catSig)
  if (a != null && b != null) {
    const max = Math.max(a, b)
    if (max <= 0) return normalizeSearchText(capSig) === normalizeSearchText(catSig)
    return Math.abs(a - b) / max <= FORMAT_TOLERANCE_RATIO
  }
  return normalizeSearchText(capSig) === normalizeSearchText(catSig)
}

export function scoreRetailCandidates(
  candidates: MatchCandidate[],
  retailTitle: string,
  retailPrice: number | null,
  normalized: NormalizedRetailProduct,
  catalogFormatById?: Map<string, string | null>,
): ScoredCatalogCandidate[] {
  const enriched = enrichRetailCandidatesCompositeScore(candidates, retailTitle, retailPrice)
  return enriched.map((c) => ({
    ...c,
    format_ok: retailFormatsCompatible(
      normalized,
      c.product_name,
      catalogFormatById?.get(c.catalog_product_id) ?? null,
    ),
  }))
}
