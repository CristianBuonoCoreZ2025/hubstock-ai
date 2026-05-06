/**
 * Análisis de imagen: prueba proveedores en cadena (p. ej. Gemini gratis → OpenRouter).
 * Configuración: `vision-config.ts` (`VISION_CHAIN`, `VISION_PROVIDER`, claves).
 */

import {
  geminiAnalyzeProductFromImage,
  geminiAnalyzeReceiptFromImage,
  geminiAnalyzeStockCheckFromImage,
  getGeminiVisionModel,
} from '@/server/gemini-vision'
import { parseModelJsonLoose } from '@/server/parse-model-json'
import { ollamaVisionText } from '@/server/ollama-vision'
import { openRouterVisionText } from '@/server/openrouter-vision'
import {
  PRODUCT_ANALYSIS_PROMPT,
  RECEIPT_ANALYSIS_PROMPT,
  stockCheckAnalysisPrompt,
} from '@/server/vision-prompts'
import {
  buildVisionAnalysisMeta,
  getOllamaVisionModel,
  getOpenRouterFreeVisionModels,
  getOpenRouterPaidVisionModels,
  resolveStockCheckVisionChain,
} from '@/server/vision-config'
import type { OpenRouterStockCheckTier } from '@/types/open-router-stock-check-tier'
import { shouldRetryVisionError } from '@/server/vision-retry'
import type { VisionAnalysisMeta } from '@/types/vision-meta'

export type { VisionAnalysisMeta } from '@/types/vision-meta'

type VisionAnalysisResult = {
  analysis: unknown
  vision: VisionAnalysisMeta
}

function hasGeminiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim())
}

function hasOpenRouterKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim())
}

/** Intenta cada id en `OPENROUTER_VISION_MODEL_FREE` antes de fallar el paso. */
async function tryOpenRouterFreeModels(input: {
  prompt: string
  imageBase64: string
  mimeType: string
}): Promise<VisionAnalysisResult> {
  const models = getOpenRouterFreeVisionModels()
  let lastError: unknown
  for (const model of models) {
    try {
      const text = await openRouterVisionText({
        prompt: input.prompt,
        imageBase64: input.imageBase64,
        mimeType: input.mimeType,
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
    : new Error('Ningún modelo gratuito de OpenRouter respondió')
}

/** Intenta cada id en `OPENROUTER_VISION_MODEL` (pago) antes de fallar el paso. */
async function tryOpenRouterPaidVisionModels(input: {
  prompt: string
  imageBase64: string
  mimeType: string
}): Promise<VisionAnalysisResult> {
  const models = getOpenRouterPaidVisionModels()
  let lastError: unknown
  for (const model of models) {
    try {
      const text = await openRouterVisionText({
        prompt: input.prompt,
        imageBase64: input.imageBase64,
        mimeType: input.mimeType,
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
    : new Error('Ningún modelo de pago de OpenRouter respondió')
}

async function runProductAnalysisWithChain(input: {
  imageBase64: string
  mimeType: string
  /** Misma lógica que Chequeo de stock: Gemini (si hay clave) + OpenRouter según modo. */
  openRouterTier?: OpenRouterStockCheckTier
}): Promise<VisionAnalysisResult> {
  const chain = resolveStockCheckVisionChain(
    input.openRouterTier ?? 'free_first'
  )
  let lastError: unknown
  for (const provider of chain) {
    if (provider === 'gemini' && !hasGeminiKey()) continue
    if (
      (provider === 'openrouter' || provider === 'openrouter_free') &&
      !hasOpenRouterKey()
    ) {
      continue
    }
    try {
      if (provider === 'gemini') {
        const analysis = await geminiAnalyzeProductFromImage(input)
        return {
          analysis,
          vision: buildVisionAnalysisMeta('gemini', getGeminiVisionModel()),
        }
      }
      if (provider === 'ollama') {
        const model = getOllamaVisionModel()
        const text = await ollamaVisionText({
          prompt: PRODUCT_ANALYSIS_PROMPT,
          imageBase64: input.imageBase64,
          mimeType: input.mimeType,
          model,
        })
        return {
          analysis: parseModelJsonLoose(text),
          vision: buildVisionAnalysisMeta('ollama', model),
        }
      }
      if (provider === 'openrouter_free') {
        return await tryOpenRouterFreeModels({
          prompt: PRODUCT_ANALYSIS_PROMPT,
          imageBase64: input.imageBase64,
          mimeType: input.mimeType,
        })
      }
      if (provider === 'openrouter') {
        return await tryOpenRouterPaidVisionModels({
          prompt: PRODUCT_ANALYSIS_PROMPT,
          imageBase64: input.imageBase64,
          mimeType: input.mimeType,
        })
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
    : new Error('No se pudo analizar el producto con ningún proveedor configurado')
}

async function runReceiptAnalysisWithChain(input: {
  imageBase64: string
  mimeType: string
  openRouterTier?: OpenRouterStockCheckTier
}): Promise<VisionAnalysisResult> {
  const chain = resolveStockCheckVisionChain(
    input.openRouterTier ?? 'free_first'
  )
  let lastError: unknown
  for (const provider of chain) {
    if (provider === 'gemini' && !hasGeminiKey()) continue
    if (
      (provider === 'openrouter' || provider === 'openrouter_free') &&
      !hasOpenRouterKey()
    ) {
      continue
    }
    try {
      if (provider === 'gemini') {
        const analysis = await geminiAnalyzeReceiptFromImage(input)
        return {
          analysis,
          vision: {
            ...buildVisionAnalysisMeta('gemini', getGeminiVisionModel()),
            analysisKind: 'image',
          },
        }
      }
      if (provider === 'ollama') {
        const model = getOllamaVisionModel()
        const text = await ollamaVisionText({
          prompt: RECEIPT_ANALYSIS_PROMPT,
          imageBase64: input.imageBase64,
          mimeType: input.mimeType,
          model,
        })
        return {
          analysis: parseModelJsonLoose(text),
          vision: {
            ...buildVisionAnalysisMeta('ollama', model),
            analysisKind: 'image',
          },
        }
      }
      if (provider === 'openrouter_free') {
        const r = await tryOpenRouterFreeModels({
          prompt: RECEIPT_ANALYSIS_PROMPT,
          imageBase64: input.imageBase64,
          mimeType: input.mimeType,
        })
        return {
          ...r,
          vision: { ...r.vision, analysisKind: 'image' },
        }
      }
      if (provider === 'openrouter') {
        const r = await tryOpenRouterPaidVisionModels({
          prompt: RECEIPT_ANALYSIS_PROMPT,
          imageBase64: input.imageBase64,
          mimeType: input.mimeType,
        })
        return {
          ...r,
          vision: { ...r.vision, analysisKind: 'image' },
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
    : new Error('No se pudo analizar la boleta con ningún proveedor configurado')
}

async function runStockCheckAnalysisWithChain(input: {
  imageBase64: string
  mimeType: string
  zone: string
  /** Solo OpenRouter (sin Gemini): gratis→pago, solo pago o solo gratis. */
  openRouterTier?: OpenRouterStockCheckTier
}): Promise<VisionAnalysisResult> {
  const prompt = stockCheckAnalysisPrompt(input.zone)
  const chain = resolveStockCheckVisionChain(
    input.openRouterTier ?? 'free_first'
  )
  let lastError: unknown
  for (const provider of chain) {
    if (provider === 'gemini' && !hasGeminiKey()) continue
    if (
      (provider === 'openrouter' || provider === 'openrouter_free') &&
      !hasOpenRouterKey()
    ) {
      continue
    }
    try {
      if (provider === 'gemini') {
        const analysis = await geminiAnalyzeStockCheckFromImage(input)
        return {
          analysis,
          vision: buildVisionAnalysisMeta('gemini', getGeminiVisionModel()),
        }
      }
      if (provider === 'ollama') {
        const model = getOllamaVisionModel()
        const text = await ollamaVisionText({
          prompt,
          imageBase64: input.imageBase64,
          mimeType: input.mimeType,
          model,
        })
        return {
          analysis: parseModelJsonLoose(text),
          vision: buildVisionAnalysisMeta('ollama', model),
        }
      }
      if (provider === 'openrouter_free') {
        return await tryOpenRouterFreeModels({
          prompt,
          imageBase64: input.imageBase64,
          mimeType: input.mimeType,
        })
      }
      if (provider === 'openrouter') {
        return await tryOpenRouterPaidVisionModels({
          prompt,
          imageBase64: input.imageBase64,
          mimeType: input.mimeType,
        })
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
    : new Error('No se pudo analizar el chequeo con ningún proveedor configurado')
}

export async function analyzeProductFromImage(input: {
  imageBase64: string
  mimeType: string
  openRouterTier?: OpenRouterStockCheckTier
}): Promise<VisionAnalysisResult> {
  return runProductAnalysisWithChain(input)
}

export async function analyzeReceiptFromImage(input: {
  imageBase64: string
  mimeType: string
  openRouterTier?: OpenRouterStockCheckTier
}): Promise<VisionAnalysisResult> {
  return runReceiptAnalysisWithChain(input)
}

export async function analyzeStockCheckFromImage(input: {
  imageBase64: string
  mimeType: string
  zone: string
  openRouterTier?: OpenRouterStockCheckTier
}): Promise<VisionAnalysisResult> {
  return runStockCheckAnalysisWithChain(input)
}
