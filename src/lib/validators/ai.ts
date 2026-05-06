import { z } from 'zod'
import type { OpenRouterStockCheckTier } from '@/types/open-router-stock-check-tier'

export const profileScopedImageBodySchema = z.object({
  profileId: z.uuid(),
  imageBase64: z.string().min(1),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
})

const openRouterStockCheckTierSchema: z.ZodType<OpenRouterStockCheckTier> =
  z.enum(['free_first', 'paid_only', 'free_only'])

export const stockCheckBodySchema = profileScopedImageBodySchema.extend({
  zone: z.enum([
    'alacena',
    'refrigerador',
    'congelador',
    'bano',
    'bodega',
    'otro',
  ]),
  /** Solo OpenRouter: orden entre modelos gratis y de pago. */
  openRouterTier: openRouterStockCheckTierSchema.optional(),
})

/** Igual que chequeo de stock: imagen + opción OpenRouter (gratis/pago). */
export const profileScopedVisionImageBodySchema =
  profileScopedImageBodySchema.extend({
    openRouterTier: openRouterStockCheckTierSchema.optional(),
  })

/** Boleta: foto de ticket, PDF con texto extraído en servidor, o texto pegado. */
export const analyzeReceiptBodySchema = z.discriminatedUnion('inputKind', [
  z.object({
    profileId: z.uuid(),
    inputKind: z.literal('image'),
    imageBase64: z.string().min(1),
    mimeType: z.enum([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ]),
    openRouterTier: openRouterStockCheckTierSchema.optional(),
  }),
  z.object({
    profileId: z.uuid(),
    inputKind: z.literal('document_pdf'),
    /** PDF completo en base64 (tamaño razonable para Route Handler). */
    pdfBase64: z.string().min(1).max(26_214_400),
    openRouterTier: openRouterStockCheckTierSchema.optional(),
  }),
  z.object({
    profileId: z.uuid(),
    inputKind: z.literal('document_text'),
    plainText: z.string().min(10).max(500_000),
    openRouterTier: openRouterStockCheckTierSchema.optional(),
  }),
])

export type ProfileScopedImageBody = z.infer<typeof profileScopedImageBodySchema>
export type ProfileScopedVisionImageBody = z.infer<
  typeof profileScopedVisionImageBodySchema
>
export type AnalyzeReceiptBody = z.infer<typeof analyzeReceiptBodySchema>
export type StockCheckBody = z.infer<typeof stockCheckBodySchema>
