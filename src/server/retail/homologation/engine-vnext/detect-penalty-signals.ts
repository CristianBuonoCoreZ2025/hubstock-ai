/**
 * Señales heurísticas para penalizaciones (plan §8).
 * Texto ya comparado localmente retail vs maestro.
 */

export type PenaltySignals = {
  zeroVsNormal?: boolean
  lightVsNormal?: boolean
  sinAzucarVsNormal?: boolean
  saborDistinto?: boolean
  packVsUnit?: boolean
  tipoBaseDistinto?: boolean
  formatoMuyDistinto?: boolean
  marcaAliasDebil?: boolean
  categoriaIncompatible?: boolean
}

const ZERO_RE = /\bzero\b|coca\s*-?\s*zero|pepsi\s*zero|monster\s*zero/i
const LIGHT_RE = /\blight\b/i
const SIN_AZUCAR_RE = /\bsin\s*(az[uú]car|azucares)\b|zero\s*az[uú]c/i
const PACK_RE = /\bpack\b|\bx\s*\d+\b|\d+\s*(un(?:idad)?(?:es)?|u)\s*(?:×|x)\s*\d+/i

export function detectPenaltySignals(input: {
  retailTitleNorm: string
  masterTitleNorm: string
  variantConflict?: boolean
  categoryMismatch?: boolean
  weakBrandAlias?: boolean
}): PenaltySignals {
  const r = input.retailTitleNorm.toLowerCase()
  const m = input.masterTitleNorm.toLowerCase()

  const retailZero = ZERO_RE.test(r)
  const masterZero = ZERO_RE.test(m)
  const retailLight = LIGHT_RE.test(r)
  const masterLight = LIGHT_RE.test(m)
  const retailSinAz = SIN_AZUCAR_RE.test(r)
  const masterSinAz = SIN_AZUCAR_RE.test(m)
  const retailPack = PACK_RE.test(r)
  const masterPack = PACK_RE.test(m)

  const signals: PenaltySignals = {}

  if (retailZero !== masterZero || (retailZero && masterZero && r.split(/\s+/)[0] !== m.split(/\s+/)[0])) {
    // Refinar: mismo producto zero en ambos no penaliza; distinto flag sí
    if (retailZero !== masterZero) signals.zeroVsNormal = true
  }

  if (retailLight !== masterLight && (retailLight || masterLight)) {
    signals.lightVsNormal = true
  }

  if (retailSinAz !== masterSinAz && (retailSinAz || masterSinAz)) {
    signals.sinAzucarVsNormal = true
  }

  if (retailPack !== masterPack && (retailPack || masterPack)) {
    signals.packVsUnit = true
  }

  if (input.variantConflict) signals.tipoBaseDistinto = true
  if (input.categoryMismatch) signals.categoriaIncompatible = true
  if (input.weakBrandAlias) signals.marcaAliasDebil = true

  /** Sabor distinto muy burdo: mismo rubrobebida pero distinto token de fruta conocido */
  const flavors =
    /\b(lima|lim[oó]n|naranja|manzana|uva|durazno|cereza|mango|coco|sand[ií]a|mel[oó]n|frutilla)\b/i
  const rf = r.match(flavors)
  const mf = m.match(flavors)
  if (rf?.[1] && mf?.[1] && rf[1].toLowerCase() !== mf[1].toLowerCase()) {
    signals.saborDistinto = true
  }

  return signals
}

export function penaltySumTable(s: PenaltySignals): number {
  let sum = 0
  const d: Record<keyof PenaltySignals, number> = {
    zeroVsNormal: 0.3,
    lightVsNormal: 0.25,
    sinAzucarVsNormal: 0.3,
    saborDistinto: 0.25,
    packVsUnit: 0.45,
    tipoBaseDistinto: 0.5,
    formatoMuyDistinto: 0.35,
    marcaAliasDebil: 0.15,
    categoriaIncompatible: 0.3,
  }
  ;(Object.keys(d) as (keyof PenaltySignals)[]).forEach((k) => {
    if (s[k]) sum += d[k]!
  })
  return sum
}
