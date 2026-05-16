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
): Promise<{ ok: true; summary: HomologationStep2RpcSummary } | { ok: false; error: string }> {
  try {
    const { data, error } = await admin.rpc('scrapping_homologation_step2_compute_all_pending' as never)
    if (error) {
      return { ok: false, error: getUserFriendlyErrorMessage(error, 'generic') }
    }
    const raw = data as Record<string, unknown> | null
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: 'No se pudo completar la acción. Intenta nuevamente.' }
    }
    return {
      ok: true,
      summary: {
        processed: Number(raw.processed ?? 0),
        auto_tentative_base: Number(raw.auto_tentative_base ?? 0),
        gray_ia_queued: Number(raw.gray_ia_queued ?? 0),
        pending_new: Number(raw.pending_new ?? 0),
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
