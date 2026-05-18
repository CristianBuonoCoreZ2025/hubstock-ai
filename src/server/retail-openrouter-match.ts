/**
 * Homologación retail automática con OpenRouter (solo texto).
 * Modelos: lista gratuita retail (`OPENROUTER_RETAIL_MODEL_FREE`); pago solo si `RETAIL_AI_ALLOW_PAID_FALLBACK=1`.
 * No usa las listas de documento/boleta salvo el fallback explícito de pago.
 */

import { parseModelJsonLoose } from '@/server/parse-model-json'
import { openRouterChatText } from '@/server/openrouter-vision'
import { shouldRetryVisionError } from '@/server/vision-retry'
import { getOpenRouterPaidDocumentModels } from '@/server/vision-config'
import {
  getOpenRouterFreeRetailModels,
  retailAiAllowPaidFallback,
} from '@/server/retail/homologation/retail-ai-config'

/** Activa la segunda pasada con modelo de lenguaje tras fallar la heurística local. */
export function retailIaHomologationEnabled(): boolean {
  const v = process.env.RETAIL_IA_HOMOLOGATION_ENABLED?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

export function isRetailIaHomologationConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEYS?.trim() || process.env.OPENROUTER_API_KEY?.trim())
}

/** Máximo de llamadas OpenRouter por corrida de auto-asociación (evita costo/rate limit). */
export function retailIaHomologationMaxCallsPerRun(): number {
  const raw = process.env.RETAIL_IA_HOMOLOG_MAX_PER_RUN?.trim()
  const n = raw ? Number(raw) : 40
  if (!Number.isFinite(n) || n < 0) return 40
  return Math.min(Math.floor(n), 500)
}

/** Confianza mínima del modelo para aceptar vínculo automático. */
export function retailIaHomologationMinConfidence(): number {
  const raw = process.env.RETAIL_IA_HOMOLOG_MIN_CONFIDENCE?.trim()
  const n = raw ? Number(raw) : 0.82
  if (!Number.isFinite(n)) return 0.82
  return Math.min(0.99, Math.max(0.5, n))
}

type CandidatePayload = {
  id: string
  nombre: string
  precio_referencia: number | null
}

/**
 * El modelo debe elegir un id de la lista o declarar que ninguno corresponde al mismo producto.
 */
export async function resolveRetailCatalogMatchWithOpenRouter(input: {
  retailTitle: string
  retailPrice: number | null
  brandHint: string | null
  descriptionHint: string | null
  candidates: CandidatePayload[]
}): Promise<{ catalogProductId: string; confidence: number; reason: string } | null> {
  if (!isRetailIaHomologationConfigured() || input.candidates.length === 0) {
    return null
  }

  const allowed = new Set(input.candidates.map((c) => c.id))
  const prompt = buildRetailMatchPrompt(input)

  let text: string
  try {
    text = await tryOpenRouterDocumentModelsForRetail(prompt)
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = parseModelJsonLoose(text)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>
  const chosenRaw = o.chosen_id
  const confRaw = o.confidence
  const reason = typeof o.reason === 'string' ? o.reason.slice(0, 500) : ''

  if (chosenRaw === null || chosenRaw === undefined || chosenRaw === 'null') {
    return null
  }

  const chosen =
    typeof chosenRaw === 'string' ? chosenRaw.trim()
    : typeof chosenRaw === 'number' ? String(chosenRaw)
    : ''
  if (!chosen || !allowed.has(chosen)) {
    return null
  }

  const confidence =
    typeof confRaw === 'number' && Number.isFinite(confRaw) ? confRaw
    : typeof confRaw === 'string' ? Number(confRaw)
    : 0
  if (!Number.isFinite(confidence)) return null

  if (confidence < retailIaHomologationMinConfidence()) {
    return null
  }

  return { catalogProductId: chosen, confidence, reason }
}

/** Salida contracto plan homologación §12 + campo explícito mismo producto físico. */
export type RetailIaHomologHintPayload = {
  aiScore: number | null
  aiHint: string
  candidateSuggested: string | null
  reason: string
  /** true solo si es literalmente el mismo producto (presentación, volumen, variante). */
  sameProduct: boolean | null
}

/**
 * Segunda pasada IA: devuelve texto y candidato sugerido para revisión humana.
 * No aplica umbrales de confianza ni escribe en base de datos.
 */
export async function resolveRetailCatalogHomologIaHintOpenRouter(input: {
  retailTitle: string
  retailPrice: number | null
  brandHint: string | null
  descriptionHint: string | null
  candidates: CandidatePayload[]
  /** ambiguous_review = filas en zona revisión; autolink_validation = contraste antes de vínculo automático */
  mode?: 'ambiguous_review' | 'autolink_validation'
  baseTopScore?: number | null
  baseGap?: number | null
  proposedCatalogProductId?: string | null
}): Promise<RetailIaHomologHintPayload | null> {
  if (!isRetailIaHomologationConfigured() || input.candidates.length === 0) {
    return null
  }

  const allowed = new Set(input.candidates.map((c) => c.id))
  const prompt = buildRetailHomologHintPrompt(input)

  let text: string
  try {
    text = await tryOpenRouterDocumentModelsForRetail(prompt)
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = parseModelJsonLoose(text)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>

  const reason = typeof o.reason === 'string' ? o.reason.slice(0, 500) : ''

  const aiHintRaw =
    typeof o.ai_hint === 'string' ? o.ai_hint
    : typeof o.aiHint === 'string' ? o.aiHint
    : typeof o.hint === 'string' ? o.hint
    : ''

  const scoreRaw = o.ai_score ?? o.confidence
  const aiScore =
    typeof scoreRaw === 'number' && Number.isFinite(scoreRaw) ? Math.min(1, Math.max(0, scoreRaw))
    : typeof scoreRaw === 'string' && Number.isFinite(Number(scoreRaw)) ?
      Math.min(1, Math.max(0, Number(scoreRaw)))
    : null

  const sameProduct = parseSameProductField(o)

  const chosenRaw = o.candidate_suggested ?? o.candidate_suggestion ?? o.chosen_id ?? o.suggested_id
  let candidateSuggested: string | null = null
  if (chosenRaw !== null && chosenRaw !== undefined && String(chosenRaw) !== 'null') {
    const chosen =
      typeof chosenRaw === 'string' ? chosenRaw.trim()
      : typeof chosenRaw === 'number' ? String(chosenRaw)
      : ''
    if (chosen && allowed.has(chosen)) candidateSuggested = chosen
  }

  const validateLink = input.mode === 'autolink_validation'
  const proposed = input.proposedCatalogProductId?.trim()

  if (sameProduct === false) {
    candidateSuggested = null
  }

  if (validateLink && proposed && allowed.has(proposed)) {
    if (sameProduct !== true) {
      candidateSuggested = null
    } else if (!candidateSuggested) {
      candidateSuggested = proposed
    }
  }

  let aiHint = aiHintRaw.trim().slice(0, 2000)
  if (!aiHint && sameProduct === false) {
    aiHint = reason.trim() ?
        `${reason.trim().slice(0, 800)} (IA: no es el mismo producto físico.)`
      : 'La IA considera que no es el mismo producto físico (presentación, volumen o variante distinta).'
  }

  if (!aiHint && candidateSuggested == null && !reason.trim() && sameProduct == null) {
    return null
  }

  return {
    aiScore,
    aiHint: aiHint || (candidateSuggested ? `Candidato sugerido para revisión (${candidateSuggested.slice(0, 8)}…).` : ''),
    candidateSuggested,
    reason,
    sameProduct,
  }
}

function parseSameProductField(o: Record<string, unknown>): boolean | null {
  const v = o.same_product ?? o.es_mismo_producto ?? o.mismo_producto
  if (v === true || v === false) return v
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === 'true' || s === 'si' || s === 'sí' || s === 'yes') return true
    if (s === 'false' || s === 'no') return false
  }
  return null
}

function buildRetailHomologHintPrompt(input: {
  retailTitle: string
  retailPrice: number | null
  brandHint: string | null
  descriptionHint: string | null
  candidates: CandidatePayload[]
  mode?: 'ambiguous_review' | 'autolink_validation'
  baseTopScore?: number | null
  baseGap?: number | null
  proposedCatalogProductId?: string | null
}): string {
  const item = {
    titulo_tienda: input.retailTitle.slice(0, 400),
    precio_observado: input.retailPrice,
    marca_o_rubro: input.brandHint,
    descripcion_extra: input.descriptionHint,
  }

  const mode = input.mode ?? 'ambiguous_review'
  const baseLine =
    input.baseTopScore != null && Number.isFinite(input.baseTopScore) ?
      `\nPuntuación agregada del motor base (antes de IA): mejor candidato ≈ ${Number(input.baseTopScore).toFixed(4)}` +
        (input.baseGap != null && Number.isFinite(input.baseGap) ?
          ` · brecha 1º–2º ≈ ${Number(input.baseGap).toFixed(4)}`
        : '')
    : ''

  const validateIntro =
    mode === 'autolink_validation' && input.proposedCatalogProductId?.trim() ?
      `\nEl motor base propone vincular el ítem de tienda al maestro id "${input.proposedCatalogProductId.trim()}".
Debes confirmar si es el MISMO producto físico (misma presentación comercial: mismo volumen/peso, mismo tipo de variante).
Ejemplos donde same_product debe ser false:
- "Crema facial 750 ml" vs "Crema humectante 500 ml" (distinto volumen y uso/tipo).
- "Plancha" vs "Microondas" aunque compartan marca (artículos distintos).
Si same_product es false: candidate_suggestion debe ser null y explica en ai_hint.\n`
    : ''

  return `Eres un asistente de homologación de catálogo de supermercado (Chile).
El usuario humano confirma cualquier vínculo; tu salida es evidencia y revisión semántica.${baseLine}${validateIntro}

Reglas estrictas para el campo same_product:
- true SOLO si el ítem de tienda y el maestro elegido son el mismo SKU / misma presentación (incluye mismo volumen nominal cuando figura en ambos).
- false si difieren volumen, formato (pack vs unitario), variante (zero/light/sabor), categoría de uso relevante, o son artículos distintos aunque la marca coincida.

Otros campos:
- candidate_suggestion: uuid del maestro que mejor correspondería, o null si ninguno encaja.
- Si same_product es false, candidate_suggestion debe ser null.
- ai_hint: texto corto en español (motivos concretos: ml, pack, variante).
- ai_score: opcional 0–1 (tu confianza en same_product / sugerencia).

Responde SOLO un objeto JSON válido.

Esquema obligatorio:
{"same_product":true|false,"ai_hint":"string","ai_score":null,"candidate_suggestion":"<uuid o null>","reason":"una frase corta"}

Ítem tienda:
${JSON.stringify(item, null, 0)}

Candidatos (id = catalog_product_id del maestro):
${JSON.stringify(input.candidates, null, 0)}`
}

function buildRetailMatchPrompt(input: {
  retailTitle: string
  retailPrice: number | null
  brandHint: string | null
  descriptionHint: string | null
  candidates: CandidatePayload[]
}): string {
  const item = {
    titulo_tienda: input.retailTitle.slice(0, 400),
    precio_observado: input.retailPrice,
    marca_o_rubro: input.brandHint,
    descripcion_extra: input.descriptionHint,
  }

  return `Eres un asistente de homologación de catálogo de supermercado (Chile).
Debes decidir si el ítem de la TIENDA corresponde al MISMO producto físico que uno de los MAESTROS candidatos (misma marca presentación y tamaño cuando aplique).

Reglas:
- Solo puedes elegir un id de la lista "candidatos" o declarar que ninguno coincide.
- Si hay duda entre dos productos distintos (distinto tamaño, pack, sabor), responde chosen_id null.
- Responde SOLO un objeto JSON válido, sin markdown, sin texto fuera del JSON.

Esquema obligatorio:
{"chosen_id":"<uuid de candidatos o null>","confidence":0.95,"reason":"una frase corta"}

Ítem tienda:
${JSON.stringify(item, null, 0)}

Candidatos (catalog_product_id del maestro):
${JSON.stringify(input.candidates, null, 0)}`
}

async function tryOpenRouterDocumentModelsForRetail(prompt: string): Promise<string> {
  const modelsFree = getOpenRouterFreeRetailModels()
  let lastError: unknown
  for (const model of modelsFree) {
    try {
      return await openRouterChatText({ prompt, model })
    } catch (e) {
      lastError = e
      if (!shouldRetryVisionError(e)) throw e
    }
  }
  if (retailAiAllowPaidFallback()) {
    const modelsPaid = getOpenRouterPaidDocumentModels()
    for (const model of modelsPaid) {
      try {
        return await openRouterChatText({ prompt, model })
      } catch (e) {
        lastError = e
        if (!shouldRetryVisionError(e)) throw e
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('OpenRouter retail automatic models failed')
}
