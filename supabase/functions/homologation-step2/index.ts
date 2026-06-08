// @ts-nocheck
// Supabase Edge Function: homologation-step2
// Conecta DIRECTAMENTE a Postgres (bypass PostgREST) para evitar timeout de 10s.
// Usa deno-postgres con statement_timeout de 300s.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { Client } from 'https://deno.land/x/postgres@v0.17.0/mod.ts'

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const dbUrl = Deno.env.get('SUPABASE_DB_URL') ?? ''
  if (!dbUrl) {
    return new Response(
      JSON.stringify({ ok: false, error: 'SUPABASE_DB_URL no configurado' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  let client: Client | null = null

  try {
    client = new Client(dbUrl)
    await client.connect()

    // Eliminar timeout de Postgres para esta sesion
    await client.queryObject("SET statement_timeout = '300s'")

    const summary = {
      processed: 0,
      auto_tentative_base: 0,
      gray_ia_queued: 0,
      pending_new: 0,
    }

    let iterations = 0
    const maxIterations = 100
    const pLimit = 100

    while (iterations < maxIterations) {
      iterations++

      const { rows } = await client.queryObject(
        'SELECT scrapping_homologation_step2_compute_all_pending_v4($1) as result',
        [pLimit],
      )

      const row = rows[0] as { result: Record<string, unknown> } | undefined
      if (!row) break

      const o = row.result
      summary.processed += Number(o.processed ?? 0)
      summary.auto_tentative_base += Number(o.auto_tentative_base ?? 0)
      summary.gray_ia_queued += Number(o.gray_ia_queued ?? 0)
      summary.pending_new += Number(o.pending_new ?? 0)

      const remaining = Number(o.remaining ?? 0)
      if (remaining <= 0) break
    }

    return new Response(JSON.stringify({ ok: true, data: summary }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  } finally {
    if (client) {
      try { await client.end() } catch {}
    }
  }
})
