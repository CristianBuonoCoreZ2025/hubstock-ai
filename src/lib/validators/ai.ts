import { z } from 'zod'

export const profileScopedImageBodySchema = z.object({
  profileId: z.uuid(),
  imageBase64: z.string().min(1),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
})

export const stockCheckBodySchema = profileScopedImageBodySchema.extend({
  zone: z.enum([
    'alacena',
    'refrigerador',
    'congelador',
    'bano',
    'bodega',
    'otro',
  ]),
})

export type ProfileScopedImageBody = z.infer<typeof profileScopedImageBodySchema>
export type StockCheckBody = z.infer<typeof stockCheckBodySchema>
