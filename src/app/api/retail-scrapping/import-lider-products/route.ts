import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/server/supabase-admin'
import { insertScrappingRun } from '@/server/retail/scrapping/lider-scrapping-service'
import { getProfileContext } from '@/lib/profile/context'
import { createClient } from '@/lib/supabase/server'
import { assertProfileMembership } from '@/lib/profile/membership'

export const maxDuration = 120

function parsePrice(raw: string | undefined): number {
  if (!raw) return 0
  const cleaned = raw
    .replace('$', '')
    .replace(/\./g, '')
    .replace(/,/g, '.')
    .replace(/\s*x.*$/, '')
    .trim()
  const n = Number.parseFloat(cleaned)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

function hashStable(v: unknown): string {
  try {
    const s = JSON.stringify(v)
    let h = 0
    for (let i = 0; i < s.length; i++) {
      h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
    }
    return Math.abs(h).toString(36)
  } catch {
    return String(Date.now())
  }
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false as const, error: 'Solicitud inválida.' }, { status: 400 })
  }

  const payload =
    typeof body === 'object' && body !== null
      ? (body as { products?: unknown[]; runId?: string })
      : {}

  const products = Array.isArray(payload.products) ? payload.products : []
  if (products.length === 0) {
    return NextResponse.json({ ok: false as const, error: 'No se recibieron productos.' })
  }

  // Auth gate: require authenticated user with editor role
  const { activeProfileId } = await getProfileContext()
  if (!activeProfileId) {
    return NextResponse.json({ ok: false as const, error: 'Sin perfil activo.' }, { status: 401 })
  }
  const supabase = await createClient()
  const gate = await assertProfileMembership(supabase, activeProfileId, { minRole: 'editor' })
  if (!gate.ok) {
    return NextResponse.json({ ok: false as const, error: 'Se requiere rol editor o administrador.' }, { status: 403 })
  }

  try {
    const admin = createServiceRoleClient()

    // Crear o reutilizar run
    let runId = typeof payload.runId === 'string' ? payload.runId.trim() : ''
    if (!runId) {
      const { data: retailData } = await admin
        .from('retail')
        .select('id,name')
        .ilike('name', 'lider')
        .limit(1)
        .maybeSingle()
      const retailId = retailData ? (retailData as { id: string; name: string }).id : null

      const runRes = await insertScrappingRun(admin, {
        retailer: 'lider',
        sourceChain: 'lider',
        totalPages: 0,
        retailId,
      })
      if ('error' in runRes) {
        return NextResponse.json({ ok: false as const, error: 'No se pudo crear la corrida de importación.' })
      }
      runId = runRes.id

      await admin
        .from('scrapping_runs')
        .update({ status: 'completed', finished_at: new Date().toISOString() } as never)
        .eq('id', runId)
    }

    const extractedAt = new Date().toISOString()
    type Row = {
      run_id: string
      retailer: string
      external_ref: string
      product_url: string
      product_name: string
      brand: string | null
      price: number
      currency: string
      source_chain: string
      listing_url: string
      sections: string | null
      categories: string | null
      image_url: string | null
      extracted_at: string
    }

    const rows: Row[] = []
    const snapshotRows: Array<{
      retailer: string
      external_ref: string
      source_url: string | null
      title: string
      price: number
      category_hint: string | null
      brand_hint: string | null
      captured_at: string
      match_method: string
    }> = []

    for (const p of products as Array<Record<string, unknown>>) {
      const name = typeof p.nombre === 'string' ? p.nombre.trim() : ''
      if (!name) continue

      const rawPrice = typeof p.precio === 'string' ? p.precio : ''
      const price = parsePrice(rawPrice)
      const id = typeof p.id === 'string' ? p.id.trim() : ''
      const productUrl = typeof p.url_producto === 'string' ? p.url_producto.trim() : ''
      const listingUrl = typeof p.listing_url === 'string' ? p.listing_url.trim() : productUrl
      const brand = typeof p.marca === 'string' ? p.marca.trim() || null : null
      const imageUrl = typeof p.imagen_url === 'string' ? p.imagen_url.trim() || null : null
      const section = typeof p.categoria === 'string' ? p.categoria.trim() || null : null
      const category = typeof p.subcategoria === 'string' ? p.subcategoria.trim() || null : null
      const externalRef = id || productUrl || `local:${hashStable(name + rawPrice)}`

      rows.push({
        run_id: runId,
        retailer: 'lider',
        external_ref: externalRef,
        product_url: productUrl,
        product_name: name,
        brand,
        price,
        currency: 'CLP',
        source_chain: 'lider',
        listing_url: listingUrl,
        sections: section,
        categories: category,
        image_url: imageUrl,
        extracted_at: extractedAt,
      })

      snapshotRows.push({
        retailer: 'lider',
        external_ref: externalRef,
        source_url: productUrl || null,
        title: name,
        price,
        category_hint: category ?? section ?? null,
        brand_hint: brand,
        captured_at: extractedAt,
        match_method: 'python_local_import',
      })
    }

    // Insertar scrapping rows
    const chunk = 50
    let inserted = 0
    for (let i = 0; i < rows.length; i += chunk) {
      const slice = rows.slice(i, i + chunk)
      const { error: fullErr } = await admin
        .from('scrapping')
        .upsert(slice as never, { onConflict: 'run_id,retailer,external_ref' })
      if (!fullErr) {
        inserted += slice.length
        continue
      }
      // Fallback sin sections/categories si la tabla no tiene esas columnas
      const lite = slice.map(({ sections, categories, image_url, ...rest }) => {
        void sections; void categories; void image_url
        return rest
      })
      const { error: liteErr } = await admin
        .from('scrapping')
        .upsert(lite as never, { onConflict: 'run_id,retailer,external_ref' })
      if (liteErr) {
        return NextResponse.json({ ok: false as const, error: `Error al insertar: ${liteErr.message}` })
      }
      inserted += slice.length
    }

    // Insertar snapshots
    const SNAP_CHUNK = 200
    for (let i = 0; i < snapshotRows.length; i += SNAP_CHUNK) {
      const slice = snapshotRows.slice(i, i + SNAP_CHUNK)
      await admin.from('catalog_retail_snapshots').insert(slice as never)
    }

    // Actualizar run
    await admin
      .from('scrapping_runs')
      .update({
        rows_inserted: inserted,
        pages_done: 1,
        pages_ok: 1,
        total_pages: 1,
        status: 'completed',
        finished_at: new Date().toISOString(),
      } as never)
      .eq('id', runId)

    return NextResponse.json({
      ok: true as const,
      runId,
      inserted,
      snapshots: snapshotRows.length,
    })
  } catch (e) {
    console.error('[api/retail-scrapping/import-lider-products]', e)
    return NextResponse.json(
      { ok: false as const, error: 'No logramos completar la importación. Intenta nuevamente.' },
      { status: 500 },
    )
  }
}
