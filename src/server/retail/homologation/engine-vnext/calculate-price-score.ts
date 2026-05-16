/** S_price según tabla del plan de homologación (CLP + porcentajes). Función pura. */

export function calculatePriceScore(
  retailPrice: number | null | undefined,
  masterReferencePrice: number | null | undefined,
): number {
  const pr =
    retailPrice != null && Number.isFinite(Number(retailPrice)) && Number(retailPrice) > 0 ?
      Number(retailPrice)
    : null
  const pm =
    masterReferencePrice != null &&
    Number.isFinite(Number(masterReferencePrice)) &&
    Number(masterReferencePrice) > 0 ?
      Number(masterReferencePrice)
    : null

  if (pr == null || pm == null) return 0.55

  const abs = Math.abs(pr - pm)
  const denom = Math.max(pr, pm)
  const pct = denom > 0 ? abs / denom : 0

  const rules: Array<{ ok: boolean; score: number }> = [
    { ok: abs <= 500, score: 1.0 },
    { ok: pct <= 0.05, score: 0.85 },
    { ok: abs <= 1500, score: 0.75 },
    { ok: pct <= 0.1, score: 0.65 },
    { ok: pct <= 0.25, score: 0.45 },
    { ok: pct <= 0.5, score: 0.15 },
  ]

  let best = 0
  for (const r of rules) {
    if (r.ok) best = Math.max(best, r.score)
  }
  if (pct > 0.5 && best === 0) return 0
  return best
}
