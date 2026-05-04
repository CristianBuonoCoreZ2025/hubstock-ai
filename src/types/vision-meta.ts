/** Metadatos devueltos por `/api/ai/*` tras un análisis de imagen exitoso. */
export type VisionAnalysisMeta = {
  provider: 'gemini' | 'openrouter' | 'openrouter_free' | 'ollama'
  /** Identificador técnico del modelo (ej. `gemini-2.0-flash`, `openai/gpt-4o-mini`). */
  model: string
  /** Nombre corto para la UI. */
  providerLabel: string
}
