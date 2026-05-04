import type { VisionAnalysisMeta } from '@/types/vision-meta'

/** Texto corto para distinguir gratis / saldo / local (orientativo). */
export function visionCostHint(
  provider: VisionAnalysisMeta['provider']
): string {
  switch (provider) {
    case 'openrouter_free':
      return 'Sin cargo en OpenRouter (modelo gratuito del catálogo)'
    case 'openrouter':
      return 'OpenRouter con saldo de cuenta'
    case 'gemini':
      return 'Google Gemini (según cuota de tu proyecto)'
    case 'ollama':
      return 'Equipo local — sin API en la nube'
    default:
      return ''
  }
}
