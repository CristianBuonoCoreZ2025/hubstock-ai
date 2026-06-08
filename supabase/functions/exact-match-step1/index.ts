/* eslint-disable */
// @ts-nocheck
// Supabase Edge Function: exact-match-step1
// Conecta DIRECTAMENTE a Postgres (bypass PostgREST) para evitar timeout de 10s.
// Requiere variable de entorno DB_URL (no puede usar prefijo SUPABASE_ reservado).
// Ejecuta scrapping_apply_exact_catalog_matches() con statement_timeout de 300s.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { Client } from 'https://deno.land/x/postgres@v0.17.0/mod.ts'

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const dbUrl = Deno.env.get('DB_URL') ?? ''
  if (!dbUrl) {
    return new Response(
      JSON.stringify({ ok: false, error: 'DB_URL no configurado' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  let client: Client | null = null

  try {
    client = new Client(dbUrl)
    await client.connect()

    // Eliminar timeout de Postgres para esta sesion
    await client.queryObject("SET statement_timeout = '300s'")

    const { rows } = await client.queryObject(
      'SELECT scrapping_apply_exact_catalog_matches() as result',
    )

    const row = rows[0] as { result: Record<string, unknown> } | undefined
    if (!row) {
      return new Response(
        JSON.stringify({ ok: false, error: 'No rows returned from RPC' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const o = row.result
    const result = {
      scrappingRowsRemoved: Number(o.scrappingRowsRemoved ?? 0),
      catalogProductsUpdated: Number(o.catalogProductsUpdated ?? 0),
      distinctCatalogProducts: Number(o.distinctCatalogProducts ?? 0),
      exactRemoved: Number(o.exactRemoved ?? 0),
      fuzzyRemoved: Number(o.fuzzyRemoved ?? 0),
      fuzzyUpdated: Number(o.fuzzyUpdated ?? 0),
      fuzzyMasters: Number(o.fuzzyMasters ?? 0),
    }

    return new Response(JSON.stringify({ ok: true, result }), {
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
