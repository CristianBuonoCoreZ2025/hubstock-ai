import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/server/supabase-admin'
import { runRetailRecaptureHomologatedBatch } from '@/server/retail-capture/recapture-homologated'

const RETAILERS = ['jumbo', 'lider', 'central_mayorista'] as const

function parseRetailer(v: string | null): (typeof RETAILERS)[number] | null {
  if (!v) return null
  return (RETAILERS as readonly string[]).includes(v) ? (v as (typeof RETAILERS)[number]) : null
}

/**
 * Recaptura precios VTEX para vínculos ya homologados (sin usuario).
 * Configurá RETAIL_CRON_SECRET y llamá con Authorization: Bearer <secret>.
 * Ej.: POST /api/cron/retail-recapture?retailer=jumbo&limit=25
 */
async function handle(request: Request) {
  const secret = process.env.RETAIL_CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'RETAIL_CRON_SECRET no configurado en el servidor.' },
      { status: 503 },
    )
  }

  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 })
  }

  const url = new URL(request.url)
  const retailer = parseRetailer(url.searchParams.get('retailer'))
  if (!retailer) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Parámetro retailer obligatorio: jumbo | lider | central_mayorista.',
      },
      { status: 400 },
    )
  }

  const limit = Math.max(1, Math.min(60, Number(url.searchParams.get('limit') ?? '30') || 30))

  let admin
  try {
    admin = createServiceRoleClient()
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Falta SUPABASE_SERVICE_ROLE_KEY en el servidor.' },
      { status: 503 },
    )
  }

  const result = await runRetailRecaptureHomologatedBatch(admin, retailer, limit)
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
  }

  return NextResponse.json({ retailer, ...result })
}

export async function GET(request: Request) {
  return handle(request)
}

export async function POST(request: Request) {
  return handle(request)
}
