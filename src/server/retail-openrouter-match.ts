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
  return Boolean(process.env.OPENROUTER_API_KEY?.trim())
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
