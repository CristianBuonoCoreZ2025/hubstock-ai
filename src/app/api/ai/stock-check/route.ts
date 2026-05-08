import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { assertProfileMembership } from '@/lib/profile/membership'
import { stockCheckBodySchema } from '@/lib/validators/ai'
import { analyzeStockCheckFromImage } from '@/server/image-analysis'
import { mapVisionFailure } from '@/server/vision-error-map'

export async function POST(request: Request) {
  try {
    let json: unknown
    try {
      json = await request.json()
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
    }

    const parsed = stockCheckBodySchema.safeParse(json)
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
    const { analysis, vision } = await analyzeStockCheckFromImage({
      imageBase64: parsed.data.imageBase64,
      mimeType: parsed.data.mimeType,
      zone: parsed.data.zone,
      openRouterTier: parsed.data.openRouterTier,
    })
    return NextResponse.json({
      profileId: parsed.data.profileId,
      zone: parsed.data.zone,
      analysis,
      vision,
      persisted: false,
    })
    } catch (e) {
      const { status, payload } = mapVisionFailure(e)
      return NextResponse.json(payload, { status })
    }
  } catch (e) {
    console.error('[api/ai/stock-check]', e)
    const { status, payload } = mapVisionFailure(e)
    return NextResponse.json(payload, { status })
  }
}
