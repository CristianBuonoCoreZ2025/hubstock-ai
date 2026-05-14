/**
 * Tipos de respuesta del barrido Lider vía `/api/retail-scrapping/*`.
 * Mantener alineados con `src/app/actions/retail-scrapping.ts` (sin importar ese módulo desde el cliente).
 */

import type { RetailTargetRow, ScrappingRunRow } from '@/types/retail-scrapping-ui'

export type BarridoPrepareRunResponse =
  | {
      ok: true
      runId: string
      retailName: string
      retailMaxPages: number
      retailMaxProducts: number
    }
  | { ok: false; error: string }

export type BarridoPhase1EnqueueResponse =
  | {
      ok: true
      phase1Pages: number
      alreadyPhase1: boolean
      retailName: string
      retailMaxPages: number
      retailMaxProducts: number
    }
  | { ok: false; error: string }

export type BarridoPhase2SealResponse =
  | {
      ok: true
      finalTotalPages: number
      appendedUrls: number
      sealedAlready: boolean
      retailName: string
      retailMaxPages: number
      retailMaxProducts: number
    }
  | { ok: false; error: string }

export type BarridoListRunsResponse = { ok: true; runs: ScrappingRunRow[] } | { ok: false; error: string }

export type BarridoListRetailsResponse =
  | { ok: true; retails: RetailTargetRow[] }
  | { ok: false; error: string }

export type BarridoStopResponse = { ok: true } | { ok: false; error: string }

export type BarridoPersistOutcomeResponse = { ok: true; updated: boolean } | { ok: false; error: string }

export type ProcessLiderScrappingRunPageResult =
  | {
      ok: true
      done: boolean
      cancelled: boolean
      pageIndex: number
      productsThisPage: number
      rowsWritten: number
      nextPageIndex: number
      totalPages: number
      error?: string
      scrappingRowsTotal?: number
      scrappingRowsTally: number
      queuePagesTotal: number
      queuePagesProcessed: number
      queuePagesOk: number
      queuePagesFailed: number
      queuePagesPending: number
      queuePagesProcessing: number
      runPersistedStatus: string
      retailMaxPages: number
      retailMaxProducts: number
    }
  | { ok: false; error: string }

export type BarridoContextResponse =
  | {
      ok: true
      anyRunningGlobally: boolean
      globalScrappingProducts: number
      globalScrappingPages: number
      runningForRetail: null | {
        runId: string
        startedAt: string
        pending: number
        processing: number
        failed: number
        done: number
        total: number
        totalPages: number | null
      }
      latestRun: null | { runId: string; status: string; startedAt: string; failedPages: number }
    }
  | { ok: false; error: string }

export type BarridoResumeResponse = BarridoPrepareRunResponse

export type BarridoRequeueFailedResponse =
  | {
      ok: true
      runId: string
      requeued: number
      retailName: string
      retailMaxPages: number
      retailMaxProducts: number
    }
  | { ok: false; error: string }

export type BarridoPurgeIdleResponse = { ok: true } | { ok: false; error: string }
