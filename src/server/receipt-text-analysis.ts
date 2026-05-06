/**
 * Boletas analizadas desde texto (PDF extraído o texto pegado). Usa modelos distintos a la visión
 * cuando defines OPENROUTER_DOCUMENT_MODEL_*; si no, reutiliza las listas de visión.
 */

import {
  geminiAnalyzeReceiptFromText,
  getGeminiVisionModel,
} from '@/server/gemini-vision'
import { parseModelJsonLoose } from '@/server/parse-model-json'
import { openRouterChatText } from '@/server/openrouter-vision'
import { RECEIPT_ANALYSIS_PROMPT } from '@/server/vision-prompts'
import { shouldRetryVisionError } from '@/server/vision-retry'
import {
  buildVisionAnalysisMeta,
  getOpenRouterFreeDocumentModels,
  getOpenRouterPaidDocumentModels,
  resolveStockCheckVisionChain,
} from '@/server/vision-config'
import type { OpenRouterStockCheckTier } from '@/types/open-router-stock-check-tier'
import type { VisionAnalysisMeta } from '@/types/vision-meta'

type VisionAnalysisResult = {
  analysis: unknown
  vision: VisionAnalysisMeta
}

function receiptTextPrompt(body: string): string {
  const safe = body.slice(0, 450_000)
  return `${RECEIPT_ANALYSIS_PROMPT}

---
Texto de la boleta (puede incluir ruido de OCR):

${safe}`
}

function hasGeminiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim())
}

function hasOpenRouterKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim())
}

async function tryOpenRouterFreeDocumentModels(input: {
  prompt: string
}): Promise<VisionAnalysisResult> {
  const models = getOpenRouterFreeDocumentModels()
  let lastError: unknown
  for (const model of models) {
    try {
      const text = await openRouterChatText({
        prompt: input.prompt,
        model,
      })
      return {
        analysis: parseModelJsonLoose(text),
        vision: buildVisionAnalysisMeta('openrouter_free', model),
      }
    } catch (e) {
      lastError = e
      if (!shouldRetryVisionError(e)) {
        throw e
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Ningún modelo gratuito de documento respondió')
}

async function tryOpenRouterPaidDocumentModels(input: {
  prompt: string
}): Promise<VisionAnalysisResult> {
  const models = getOpenRouterPaidDocumentModels()
  let lastError: unknown
  for (const model of models) {
    try {
      const text = await openRouterChatText({
        prompt: input.prompt,
        model,
      })
      return {
        analysis: parseModelJsonLoose(text),
        vision: buildVisionAnalysisMeta('openrouter', model),
      }
    } catch (e) {
      lastError = e
      if (!shouldRetryVisionError(e)) {
        throw e
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Ningún modelo de pago de documento respondió')
}

/**
 * Misma prioridad que fotos (Gemini si hay clave + OpenRouter según tier), pero solo texto.
 * Omite Ollama (solo visión en este proyecto).
 */
export async function analyzeReceiptFromExtractedText(input: {
  receiptText: string
  openRouterTier?: OpenRouterStockCheckTier
}): Promise<VisionAnalysisResult> {
  const prompt = receiptTextPrompt(input.receiptText.trim())
  const chain = resolveStockCheckVisionChain(
    input.openRouterTier ?? 'free_first'
  )
  let lastError: unknown
  for (const provider of chain) {
    if (provider === 'ollama') {
      continue
    }
    if (provider === 'gemini' && !hasGeminiKey()) continue
    if (
      (provider === 'openrouter' || provider === 'openrouter_free') &&
      !hasOpenRouterKey()
    ) {
      continue
    }
    try {
      if (provider === 'gemini') {
        const analysis = await geminiAnalyzeReceiptFromText(input.receiptText)
        return {
          analysis,
          vision: {
            ...buildVisionAnalysisMeta('gemini', getGeminiVisionModel()),
            analysisKind: 'document_text',
          },
        }
      }
      if (provider === 'openrouter_free') {
        const r = await tryOpenRouterFreeDocumentModels({ prompt })
        return {
          ...r,
          vision: { ...r.vision, analysisKind: 'document_text' },
        }
      }
      if (provider === 'openrouter') {
        const r = await tryOpenRouterPaidDocumentModels({ prompt })
        return {
          ...r,
          vision: { ...r.vision, analysisKind: 'document_text' },
        }
      }
    } catch (e) {
      lastError = e
      if (!shouldRetryVisionError(e)) {
        throw e
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(
        'No se pudo analizar el texto de la boleta con ningún proveedor configurado'
      )
}
