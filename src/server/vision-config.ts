/**
 * Proveedores de análisis de imagen para `/api/ai/*`.
 *
 * ## Segundo “gratis” además de Gemini (Google AI)
 * - **`openrouter_free`**: usa tu **`OPENROUTER_API_KEY`** pero el modelo **gratuito** del catálogo OpenRouter
 *   (`OPENROUTER_VISION_MODEL_FREE`, o un valor por defecto si no lo defines).
 *   No es otra cuenta: es el mismo OpenRouter con otro `model` (suelen llevar sufijo `:free`).
 *
 * ## Cadena por defecto (`VISION_PROVIDER=auto` o sin definir)
 * - Con **Gemini + OpenRouter**: `gemini` (API Google) → **`openrouter_free`** → `openrouter`.
 *   Por eso **tu modelo gratis de OpenRouter no va “primero”** si tienes `GEMINI_API_KEY`:
 *   usa `VISION_CHAIN=openrouter_free,gemini,openrouter` para intentar Gemma/OpenRouter gratis antes que Gemini.
 * - Solo OpenRouter: **`openrouter_free`** → `openrouter`.
 * - Solo Gemini: `gemini`.
 *
 * **`OPENROUTER_VISION_MODEL_FREE`**: uno o **varios** ids separados por **coma**; se intentan **en orden**
 * dentro del paso `openrouter_free` antes de pasar al siguiente proveedor de la cadena (ej. el de pago).
 *
 * **`VISION_CHAIN`**: lista explícita, ej. `gemini,openrouter_free,openrouter` (admite `openrouter_free`).
 *
 * ## Ollama (local, sin API key)
 * - **`ollama`**: `OLLAMA_BASE_URL` (por defecto `http://127.0.0.1:11434`) y `OLLAMA_VISION_MODEL` (ej. `llava`).
 * - No entra en la cadena **`auto`** por defecto (si Ollama no está encendido, cada petición fallaría).
 * - Actívalo con `VISION_CHAIN=...,ollama,...` o `VISION_PROVIDER=ollama`.
 *
 * ## Variables
 * - `GEMINI_API_KEY`, `GEMINI_MODEL`
 * - `OPENROUTER_API_KEY`, `OPENROUTER_VISION_MODEL`, `OPENROUTER_VISION_MODEL_FREE`, `OPENROUTER_HTTP_REFERER`
 * - `OLLAMA_BASE_URL`, `OLLAMA_VISION_MODEL`
 */

import type { OpenRouterStockCheckTier } from '@/types/open-router-stock-check-tier'
import type { VisionAnalysisMeta } from '@/types/vision-meta'

export type VisionProviderName =
  | 'gemini'
  | 'openrouter'
  | 'openrouter_free'
  /** Inferencia local con Ollama (sin clave de nube); ver `OLLAMA_*` */
  | 'ollama'

/** Etiqueta para UI + payload estable para APIs. */
export function buildVisionAnalysisMeta(
  provider: VisionProviderName,
  model: string
): VisionAnalysisMeta {
  let providerLabel: string
  switch (provider) {
    case 'gemini':
      providerLabel = 'Google Gemini'
      break
    case 'openrouter_free':
      providerLabel = 'OpenRouter (gratis)'
      break
    case 'openrouter':
      providerLabel = 'OpenRouter'
      break
    case 'ollama':
      providerLabel = 'Ollama (local)'
      break
    default:
      providerLabel = provider
  }
  return { provider, model, providerLabel }
}

function assertGeminiKey(): void {
  if (!process.env.GEMINI_API_KEY?.trim()) {
    throw new Error(
      'VISION_PROVIDER=gemini pero GEMINI_API_KEY no está configurada'
    )
  }
}

function assertOpenRouterKey(): void {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error(
      'VISION_PROVIDER=openrouter pero OPENROUTER_API_KEY no está configurada'
    )
  }
}

/** Sin repetir el mismo proveedor seguido si la lista viene mal configurada */
function uniqueProviders(items: VisionProviderName[]): VisionProviderName[] {
  const seen = new Set<VisionProviderName>()
  const out: VisionProviderName[] = []
  for (const x of items) {
    if (seen.has(x)) continue
    seen.add(x)
    out.push(x)
  }
  return out
}

/**
 * Orden de intentos: el primero que responda bien gana; si falla de forma recuperable,
 * se intenta el siguiente (`shouldRetryVisionError` en `vision-retry.ts`).
 */
export function resolveVisionChain(): VisionProviderName[] {
  const chainRaw = process.env.VISION_CHAIN?.trim()
  if (chainRaw) {
    const parts = chainRaw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    const parsed: VisionProviderName[] = []
    for (const p of parts) {
      if (
        p === 'gemini' ||
        p === 'openrouter' ||
        p === 'openrouter_free' ||
        p === 'ollama'
      ) {
        parsed.push(p)
      }
    }
    if (parsed.length > 0) {
      return uniqueProviders(parsed)
    }
  }

  const raw = process.env.VISION_PROVIDER?.trim().toLowerCase()

  if (raw === 'gemini') {
    assertGeminiKey()
    return ['gemini']
  }
  if (raw === 'openrouter') {
    assertOpenRouterKey()
    return ['openrouter']
  }
  if (raw === 'ollama') {
    return ['ollama']
  }

  const orKey = process.env.OPENROUTER_API_KEY?.trim()
  const gKey = process.env.GEMINI_API_KEY?.trim()

  if (gKey && orKey) {
    return ['gemini', 'openrouter_free', 'openrouter']
  }
  if (gKey && !orKey) {
    return ['gemini']
  }
  if (orKey && !gKey) {
    return ['openrouter_free', 'openrouter']
  }

  throw new Error(
    'Configura OPENROUTER_API_KEY y/o GEMINI_API_KEY para análisis de imágenes (IA).'
  )
}

/**
 * Pasos **solo OpenRouter** para chequeo de stock (orden gratis→pago según `tier`).
 * Sin `OPENROUTER_API_KEY` devuelve `[]` (el llamador puede anteponer Gemini u otros).
 */
export function resolveOpenRouterStockCheckChain(
  tier: OpenRouterStockCheckTier
): VisionProviderName[] {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    return []
  }
  switch (tier) {
    case 'paid_only':
      return ['openrouter']
    case 'free_only':
      return ['openrouter_free']
    case 'free_first':
      return ['openrouter_free', 'openrouter']
    default:
      return ['openrouter_free', 'openrouter']
  }
}

/**
 * Cadena completa para `/api/ai/stock-check`: **Gemini si hay `GEMINI_API_KEY`** (como captura/boletas),
 * más pasos OpenRouter según el selector de la UI. Requiere al menos un proveedor disponible.
 */
export function resolveStockCheckVisionChain(
  tier: OpenRouterStockCheckTier
): VisionProviderName[] {
  const parts: VisionProviderName[] = []
  if (process.env.GEMINI_API_KEY?.trim()) {
    parts.push('gemini')
  }
  parts.push(...resolveOpenRouterStockCheckChain(tier))
  const merged = uniqueProviders(parts)
  if (merged.length === 0) {
    throw new Error(
      'Configura GEMINI_API_KEY y/o OPENROUTER_API_KEY para analizar fotos del chequeo de stock.'
    )
  }
  return merged
}

/** Modelo de pago / saldo en OpenRouter (respaldo tras intentos gratis). */
export function getOpenRouterVisionModel(): string {
  const fromEnv = process.env.OPENROUTER_VISION_MODEL?.trim()
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv
  }
  return 'openai/gpt-4o-mini'
}

const DEFAULT_OPENROUTER_FREE_MODEL = 'google/gemini-2.0-flash-exp:free'

/**
 * Modelos **gratuitos** en OpenRouter (visión), en orden de intento.
 * En `OPENROUTER_VISION_MODEL_FREE` pon uno o varios ids separados por **coma**
 * (sin espacios problemáticos). Catálogo: https://openrouter.ai/models — suelen llevar `:free`.
 */
export function getOpenRouterFreeVisionModels(): string[] {
  const fromEnv = process.env.OPENROUTER_VISION_MODEL_FREE?.trim()
  if (!fromEnv || fromEnv.length === 0) {
    return [DEFAULT_OPENROUTER_FREE_MODEL]
  }
  const parts = fromEnv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return parts.length > 0 ? parts : [DEFAULT_OPENROUTER_FREE_MODEL]
}

/** Primer modelo gratuito (compatibilidad con código que espera un solo id). */
export function getOpenRouterFreeVisionModel(): string {
  return getOpenRouterFreeVisionModels()[0] ?? DEFAULT_OPENROUTER_FREE_MODEL
}

export function getOpenRouterHttpReferer(): string {
  return (
    process.env.OPENROUTER_HTTP_REFERER?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    'http://localhost:3000'
  )
}

/** Base URL de Ollama (API local, sin clave). */
export function getOllamaBaseUrl(): string {
  const u = process.env.OLLAMA_BASE_URL?.trim()
  if (u && u.length > 0) {
    return u
  }
  return 'http://127.0.0.1:11434'
}

/** Modelo Ollama con visión; instalar con `ollama pull <model>`. */
export function getOllamaVisionModel(): string {
  const m = process.env.OLLAMA_VISION_MODEL?.trim()
  if (m && m.length > 0) {
    return m
  }
  return 'llava'
}
