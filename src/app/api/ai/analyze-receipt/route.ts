import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { extractPdfTextFromBase64 } from '@/lib/pdf-text'
import { assertProfileMembership } from '@/lib/profile/membership'
import { analyzeReceiptBodySchema } from '@/lib/validators/ai'
import { analyzeReceiptFromImage } from '@/server/image-analysis'
import { analyzeReceiptFromExtractedText } from '@/server/receipt-text-analysis'
import { mapVisionFailure } from '@/server/vision-error-map'
import { enrichReceiptAnalysisPayload } from '@/server/product-enrichment'
import { parseJsonBody, apiError } from '@/lib/api-route-helpers'

export async function POST(request: Request) {
  try {
    const json = await parseJsonBody(request)
    if (json === null) return apiError('invalid_json', 400)

    const parsed = analyzeReceiptBodySchema.safeParse(json)
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

    const tier = parsed.data.openRouterTier

    try {
    if (parsed.data.inputKind === 'image') {
      const { analysis, vision } = await analyzeReceiptFromImage({
        imageBase64: parsed.data.imageBase64,
        mimeType: parsed.data.mimeType,
        openRouterTier: tier,
      })
      const enriched = await enrichReceiptAnalysisPayload(analysis).catch(
        () => null
      )
      return NextResponse.json({
        profileId: parsed.data.profileId,
        analysis,
        enriched,
        vision,
        persisted: false,
      })
    }

    let receiptText: string
    if (parsed.data.inputKind === 'document_text') {
      receiptText = parsed.data.plainText.trim()
    } else {
      receiptText = await extractPdfTextFromBase64(parsed.data.pdfBase64)
    }

    if (receiptText.length < 10) {
      return NextResponse.json(
        {
          error: 'empty_document',
          hint: 'No se pudo extraer texto suficiente del documento. Prueba otro PDF o pega el texto a mano.',
        },
        { status: 400 }
      )
    }

    const { analysis, vision } = await analyzeReceiptFromExtractedText({
      receiptText,
      openRouterTier: tier,
    })
    const enriched = await enrichReceiptAnalysisPayload(analysis).catch(
      () => null
    )
    return NextResponse.json({
      profileId: parsed.data.profileId,
      analysis,
      enriched,
      vision,
      persisted: false,
    })
    } catch (e) {
      const { status, payload } = mapVisionFailure(e)
      return NextResponse.json(payload, { status })
    }
  } catch (e) {
    console.error('[api/ai/analyze-receipt]', e)
    const { status, payload } = mapVisionFailure(e)
    return NextResponse.json(payload, { status })
  }
}
