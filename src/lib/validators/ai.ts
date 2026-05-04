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

export type ProfileScopedImageBody = z.infer<typeof profileScopedImageBodySchema>
export type StockCheckBody = z.infer<typeof stockCheckBodySchema>
