import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { assertProfileMembership } from '@/lib/profile/membership'
import { profileScopedVisionImageBodySchema } from '@/lib/validators/ai'
import { analyzeProductFromImage } from '@/server/image-analysis'
import { mapVisionFailure } from '@/server/vision-error-map'
import {
  enrichProductImageAnalysis,
  mergeProductImageWithOff,
} from '@/server/product-enrichment'
import { normalizeMultiProductVisionJson } from '@/server/vision-product-multi'

export async function POST(request: Request) {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = profileScopedVisionImageBodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const supabase = await createClient()
  const gate = await assertProfileMembership(supabase, parsed.data.profileId, {
    minRole: 'editor',
  })
  if (!gate.ok) {
    return NextResponse.json({ error: gate.reason }, { status: 403 })
  }

  try {
    const { analysis, vision } = await analyzeProductFromImage({
      imageBase64: parsed.data.imageBase64,
      mimeType: parsed.data.mimeType,
      openRouterTier: parsed.data.openRouterTier,
    })

    const items = normalizeMultiProductVisionJson(analysis)
    const products = await Promise.all(
      items.map(async (item) => {
        try {
          return await enrichProductImageAnalysis(item)
        } catch {
          return mergeProductImageWithOff(item, null)
        }
      })
    )

    return NextResponse.json({
      profileId: parsed.data.profileId,
      /** Compatibilidad: primer ítem igual que antes */
      analysis: items[0] ?? analysis,
      enriched: products[0] ?? null,
      products,
      vision,
      persisted: false,
    })
  } catch (e) {
    const { status, payload } = mapVisionFailure(e)
    return NextResponse.json(payload, { status })
  }
}
