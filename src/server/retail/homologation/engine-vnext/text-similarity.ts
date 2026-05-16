/** Tokens normalizados y solapamiento (0–1) para S_name inicial. */

import { normalizeSearchText } from '@/lib/search'

export function normalizedTokenOverlapScore(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalizeSearchText((a ?? '').trim())
  const nb = normalizeSearchText((b ?? '').trim())
  if (!na.length && !nb.length) return 1
  if (!na.length || !nb.length) return 0
  const sa = new Set(na.split(/\s+/).filter(Boolean))
  const sb = new Set(nb.split(/\s+/).filter(Boolean))
  let inter = 0
  for (const x of sa) {
    if (sb.has(x)) inter++
  }
  const union = sa.size + sb.size - inter
  return union ? inter / union : 0
}
