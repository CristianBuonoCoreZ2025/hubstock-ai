/**
 * OpenRouter solo para casos ambiguos de homologación retail (top candidatos ya calculados).
 * Automático: solo modelos gratuitos de `OPENROUTER_RETAIL_MODEL_FREE` (fallback `openrouter/free`);
 * modelos pagos solo si `RETAIL_AI_ALLOW_PAID_FALLBACK=1`.
 */

import { parseModelJsonLoose } from '@/server/parse-model-json'
import { openRouterChatText } from '@/server/openrouter-vision'
import { shouldRetryVisionError } from '@/server/vision-retry'
import { getOpenRouterPaidDocumentModels } from '@/server/vision-config'
import {
  getOpenRouterFreeRetailModels,
  retailAiAllowPaidFallback,
} from '@/server/retail/homologation/retail-ai-config'
import type { RetailAiDecision } from '@/server/retail/capture/retail-types'

type CandidateBrief = {
  catalog_product_id: string
  product_name: string
  category_id?: string
  default_reference_price?: number | null
  format?: string | null
}

const STRICT_PROMPT = `Eres un motor de homologación de productos de supermercado.
Debes evitar duplicados.
Compara el producto capturado contra los candidatos del catálogo maestro.
Decide una acción: link, review, new_master, duplicate_risk.
Considera nombre, marca, formato, cantidad, unidad, sabor, variante, categoría, precio, descripción y URL.
El precio cambia entre cadenas, no descartes solo por precio.
No enlaces formatos distintos.
No crees maestro si existe riesgo razonable de duplicado.
Devuelve solo JSON válido con:
{
  "decision": "link | review | new_master | duplicate_risk",
  "catalog_product_id": "uuid o null",
  "confidence": 0.0,
  "reason": "frase breve"
}`

function buildUserPayload(captured: {
  title: string
  brand: string | null
  price: number | null
  unit_price: string | null
  category_hint: string | null
  description_hint: string | null
  source_url: string | null
}, candidates: CandidateBrief[]): string {
  return JSON.stringify(
    {
      producto_capturado: {
        titulo: captured.title,
        marca: captured.brand,
        precio: captured.price,
        precio_por_unidad: captured.unit_price,
        rubro: captured.category_hint,
        descripcion: captured.description_hint,
        url: captured.source_url,
      },
      candidatos: candidates.map((c) => ({
        catalog_product_id: c.catalog_product_id,
        nombre: c.product_name,
        precio_referencia: c.default_reference_price ?? null,
        formato: c.format ?? null,
      })),
    },
    null,
    0,
  )
}

/**
 * Retail automático: solo modelos gratuitos de `OPENROUTER_RETAIL_MODEL_FREE`
 * (fallback `openrouter/free`). Modelos pagos solo si `RETAIL_AI_ALLOW_PAID_FALLBACK=1`.
 */
async function tryRetailHomologationModels(prompt: string): Promise<string> {
  const free = getOpenRouterFreeRetailModels()
  let last: unknown
  for (const model of free) {
    try {
      return await openRouterChatText({ prompt, model })
    } catch (e) {
      last = e
      if (!shouldRetryVisionError(e)) throw e
    }
  }
  if (retailAiAllowPaidFallback()) {
    for (const model of getOpenRouterPaidDocumentModels()) {
      try {
        return await openRouterChatText({ prompt, model })
      } catch (e) {
        last = e
        if (!shouldRetryVisionError(e)) throw e
      }
    }
  }
  throw last instanceof Error ? last : new Error('openrouter_failed')
}

function parseRetailAiDecision(
  text: string,
  allowedIds: Set<string>,
): RetailAiDecision | null {
  let parsed: unknown
  try {
    parsed = parseModelJsonLoose(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>
  const decisionRaw = o.decision
  const decision =
    typeof decisionRaw === 'string' ? decisionRaw.trim().toLowerCase() : ''
  if (!['link', 'review', 'new_master', 'duplicate_risk'].includes(decision)) {
    return null
  }

  let catalog_product_id: string | null = null
  const idRaw = o.catalog_product_id
  if (idRaw != null && idRaw !== '' && idRaw !== 'null') {
    const id =
      typeof idRaw === 'string' ? idRaw.trim()
      : typeof idRaw === 'number' ? String(idRaw)
      : ''
    if (id && allowedIds.has(id)) catalog_product_id = id
  }

  const confRaw = o.confidence
  const confidence =
    typeof confRaw === 'number' && Number.isFinite(confRaw) ? confRaw
    : typeof confRaw === 'string' ? Number(confRaw)
    : NaN
  if (!Number.isFinite(confidence)) return null

  const reason = typeof o.reason === 'string' ? o.reason.trim().slice(0, 400) : ''

  if (decision === 'link' && !catalog_product_id) return null

  return {
    decision: decision as RetailAiDecision['decision'],
    catalog_product_id,
    confidence,
    reason: reason || 'sin motivo',
  }
}

export async function resolveRetailHomologationWithOpenRouter(input: {
  captured: {
    title: string
    brand: string | null
    price: number | null
    unit_price: string | null
    category_hint: string | null
    description_hint: string | null
    source_url: string | null
  }
  candidates: CandidateBrief[]
}): Promise<RetailAiDecision | null> {
  if (!process.env.OPENROUTER_API_KEY?.trim() || input.candidates.length === 0) {
    return null
  }

  const allowed = new Set(input.candidates.map((c) => c.catalog_product_id))
  const prompt = `${STRICT_PROMPT}

${buildUserPayload(input.captured, input.candidates)}`

  let text: string
  try {
    text = await tryRetailHomologationModels(prompt)
  } catch {
    return null
  }

  return parseRetailAiDecision(text, allowed)
}
