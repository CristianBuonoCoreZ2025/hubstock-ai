/**
 * Paso 2 · motor de homologación por score en Postgres (Captura cadenas 2).
 * Un solo RPC recalcula todas las filas `scrapping` en `catalog_match_status = 'pending'`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getUserFriendlyErrorMessage } from '@/lib/user-friendly-errors'

export type HomologationStep2RpcSummary = {
  processed: number
  auto_tentative_base: number
  gray_ia_queued: number
  pending_new: number
}

export async function runHomologationStep2ComputeAllPending(
  admin: SupabaseClient,
): Promise<{ ok: true; summary: HomologationStep2RpcSummary } | { ok: false; error: string; __technical?: string }> {
  try {
    const { data, error } = await admin.rpc('scrapping_homologation_step2_compute_all_pending_safe' as never)
    if (error) {
      const tech = error instanceof Error ? error.message : JSON.stringify(error)
      return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic'), __technical: tech }
    }
    const raw = data as unknown
    if (raw == null || typeof raw !== 'object') {
      const tech = JSON.stringify({ raw: String(raw), type: typeof raw })
      console.error('[runHomologationStep2ComputeAllPending] RPC retornó valor inesperado:', tech)
      return { ok: false, error: 'No se pudo completar la acción. Intenta nuevamente.', __technical: tech }
    }
    // Supabase puede envolver jsonb en array de 1 elemento
    const o: Record<string, unknown> = Array.isArray(raw) && raw.length > 0 && raw[0] != null && typeof raw[0] === 'object' ? (raw[0] as Record<string, unknown>) : (raw as Record<string, unknown>)
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
