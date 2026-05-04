/**
 * Compatibilidad: las rutas pueden importar desde aquí o desde `image-analysis`.
 * La lógica vive en `image-analysis` (Gemini directo u OpenRouter según env).
 */
export {
  analyzeProductFromImage,
  analyzeReceiptFromImage,
  analyzeStockCheckFromImage,
} from '@/server/image-analysis'
export type { VisionAnalysisMeta } from '@/server/image-analysis'
