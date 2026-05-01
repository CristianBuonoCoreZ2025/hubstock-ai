import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { assertProfileMembership } from '@/lib/profile/membership'
import { profileScopedImageBodySchema } from '@/lib/validators/ai'
import { analyzeReceiptFromImage } from '@/server/gemini'

export async function POST(request: Request) {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = profileScopedImageBodySchema.safeParse(json)
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
    const analysis = await analyzeReceiptFromImage({
      imageBase64: parsed.data.imageBase64,
      mimeType: parsed.data.mimeType,
    })
    return NextResponse.json({
      profileId: parsed.data.profileId,
      analysis,
      persisted: false,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'gemini_error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
