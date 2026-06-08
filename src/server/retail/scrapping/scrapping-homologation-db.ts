/**
 * Paso 2 · motor de homologación por score en Postgres (Captura cadenas 2).
 * Llama a la Edge Function `homologation-step2` que procesa todo en loop interno.
 * La Edge Function tiene 400s de timeout; cada batch v4 es rapido.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getUserFriendlyErrorMessage } from '@/lib/user-friendly-errors'
import { getServerEnv } from '@/server/env'

export type HomologationStep2RpcSummary = {
  processed: number
  auto_tentative_base: number
  gray_ia_queued: number
  pending_new: number
}

export async function runHomologationStep2ComputeAllPending(
  _admin: SupabaseClient,
): Promise<{ ok: true; summary: HomologationStep2RpcSummary } | { ok: false; error: string; __technical?: string }> {
  try {
    const env = getServerEnv()
    const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/homologation-step2`
    const key = env.SUPABASE_SERVICE_ROLE_KEY
    if (!key) {
      return { ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY no está configurada.' }
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
    })
    const json = await res.json().catch(() => ({}))

    if (!res.ok || !json.ok) {
      const tech = JSON.stringify({ status: res.status, body: json })
      return {
        ok: false,
        error: getUserFriendlyErrorMessage(json.error ?? 'No se pudo completar la acción. Intenta nuevamente.', 'generic'),
        __technical: tech,
      }
    }

    const raw = json.data as unknown
    if (raw == null || typeof raw !== 'object') {
      const tech = JSON.stringify({ raw: String(raw), type: typeof raw })
      console.error('[runHomologationStep2ComputeAllPending] Edge Function retornó valor inesperado:', tech)
      return { ok: false, error: 'No se pudo completar la acción. Intenta nuevamente.', __technical: tech }
    }

    const o: Record<string, unknown> =
      Array.isArray(raw) && raw.length > 0 && raw[0] != null && typeof raw[0] === 'object'
        ? (raw[0] as Record<string, unknown>)
        : (raw as Record<string, unknown>)

    return {
      ok: true,
      summary: {
        processed: Number(o.processed ?? 0),
        auto_tentative_base: Number(o.auto_tentative_base ?? 0),
        gray_ia_queued: Number(o.gray_ia_queued ?? 0),
        pending_new: Number(o.pending_new ?? 0),
      },
    }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

export type ExactCatalogMatchStats = {
  scrappingRowsRemoved: number
  catalogProductsUpdated: number
  distinctCatalogProducts: number
  exactRemoved: number
  fuzzyRemoved: number
  fuzzyUpdated: number
  fuzzyMasters: number
}

/**
 * Paso 1: coincidencias exactas + fuzzy por marca.
 * Llama a la Edge Function `exact-match-step1` para evitar timeout de PostgREST (10s).
 * La Edge Function conecta directamente a Postgres con 300s de timeout.
 */
export async function runExactCatalogMatchesStep1(): Promise<
  { ok: true; result: ExactCatalogMatchStats } | { ok: false; error: string; __technical?: string }
> {
  try {
    const env = getServerEnv()
    const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/exact-match-step1`
    const key = env.SUPABASE_SERVICE_ROLE_KEY
    if (!key) {
      return { ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY no está configurada.' }
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
    })
    const json = await res.json().catch(() => ({}))

    if (!res.ok || !json.ok) {
      const tech = JSON.stringify({ status: res.status, body: json })
      return {
        ok: false,
        error: getUserFriendlyErrorMessage(json.error ?? 'No se pudo completar la acción. Intenta nuevamente.', 'generic'),
        __technical: tech,
      }
    }

    const raw = json.result as unknown
    if (raw == null || typeof raw !== 'object') {
      const tech = JSON.stringify({ raw: String(raw), type: typeof raw })
      console.error('[runExactCatalogMatchesStep1] Edge Function retornó valor inesperado:', tech)
      return { ok: false, error: 'No se pudo completar la acción. Intenta nuevamente.', __technical: tech }
    }

    const o = raw as Record<string, unknown>
    return {
      ok: true,
      result: {
        scrappingRowsRemoved: Number(o.scrappingRowsRemoved ?? 0),
        catalogProductsUpdated: Number(o.catalogProductsUpdated ?? 0),
        distinctCatalogProducts: Number(o.distinctCatalogProducts ?? 0),
        exactRemoved: Number(o.exactRemoved ?? 0),
        fuzzyRemoved: Number(o.fuzzyRemoved ?? 0),
        fuzzyUpdated: Number(o.fuzzyUpdated ?? 0),
        fuzzyMasters: Number(o.fuzzyMasters ?? 0),
      },
    }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}

export async function recordHomologationUserFeedbackRpc(
  admin: SupabaseClient,
  input: { scrappingId: string; reasonCode: string; penaltyDelta: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sid = input.scrappingId?.trim()
  const code = input.reasonCode?.trim()
  if (!sid || !code) {
    return { ok: false, error: 'Completa los datos obligatorios antes de guardar.' }
  }
  try {
    const { error } = await admin.rpc('homologation_record_user_feedback' as never, {
      p_scrapping_id: sid,
      p_reason_code: code,
      p_penalty_delta: input.penaltyDelta,
    } as never)
    if (error) return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getUserFriendlyErrorMessage(e, 'generic') }
  }
}
