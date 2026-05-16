/**
 * Etapa E: ejecuta toda la pasada masiva en servidor (un job, progreso en store).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { getUserFriendlyErrorMessage } from '@/lib/user-friendly-errors'
import { logScrappingBulk } from '@/server/retail/scrapping/scrapping-similarity-bulk-log'
import {
  countScrappingSimilarityPending,
  processScrappingSimilarityBulkBatch,
  type SimilarityBulkBatchStats,
} from '@/server/retail/scrapping/scrapping-similarity-bulk-prep'
import {
  isSimilarityBulkJobCancelled,
  patchSimilarityBulkJob,
  type SimilarityBulkJobProgress,
} from '@/server/retail/scrapping/scrapping-similarity-bulk-job-store'

function applyBatchToJob(jobId: string, batch: SimilarityBulkBatchStats, acc: SimilarityBulkJobProgress): void {
  acc.processed += batch.processed
  acc.autoLinked += batch.autoLinked
  acc.iaHintsStored += batch.iaHintsStored
  acc.autoPendingNew += batch.autoPendingNew
  acc.leftForReview += batch.leftForReview
  acc.failed += batch.failed
  patchSimilarityBulkJob(jobId, {
    processed: acc.processed,
    autoLinked: acc.autoLinked,
    iaHintsStored: acc.iaHintsStored,
    autoPendingNew: acc.autoPendingNew,
    leftForReview: acc.leftForReview,
    failed: acc.failed,
  })
}

export async function runScrappingSimilarityBulkJob(
  admin: SupabaseClient,
  jobId: string,
  initialTotal: number,
): Promise<void> {
  const tJobStart = Date.now()
  const acc: SimilarityBulkJobProgress = {
    jobId,
    status: 'running',
    total: initialTotal,
    processed: 0,
    autoLinked: 0,
    iaHintsStored: 0,
    autoPendingNew: 0,
    leftForReview: 0,
    failed: 0,
    error: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    batchNumber: 0,
    pendingRemaining: initialTotal,
  }

  logScrappingBulk('job_start', {
    jobId,
    initialTotal,
  })

  let afterId: string | null = null
  let batchNumber = 0

  try {
    for (;;) {
      if (isSimilarityBulkJobCancelled(jobId)) {
        logScrappingBulk('job_cancelled', { jobId, processed: acc.processed, batchNumber })
        patchSimilarityBulkJob(jobId, { status: 'cancelled' })
        return
      }

      const pendingBefore = await countScrappingSimilarityPending(admin)
      patchSimilarityBulkJob(jobId, {
        batchNumber,
        pendingRemaining: pendingBefore,
      })

      logScrappingBulk('job_batch_loop', {
        jobId,
        batchNumber,
        afterId,
        pendingBefore,
        processedSoFar: acc.processed,
        totalAtStart: acc.total,
      })

      const r = await processScrappingSimilarityBulkBatch(admin, {
        afterId,
        jobId,
        processedBase: acc.processed,
        batchNumber,
      })
      if (!r.ok) {
        logScrappingBulk('job_error', { jobId, batchNumber, error: r.error })
        patchSimilarityBulkJob(jobId, {
          status: 'error',
          error: r.error,
        })
        return
      }

      batchNumber += 1
      applyBatchToJob(jobId, r.stats, acc)

      const pendingAfter = await countScrappingSimilarityPending(admin)
      patchSimilarityBulkJob(jobId, {
        batchNumber,
        pendingRemaining: pendingAfter,
      })

      logScrappingBulk('job_batch_done', {
        jobId,
        batchNumber,
        batchProcessed: r.stats.processed,
        pendingAfter,
        processedTotal: acc.processed,
        autoPendingNewTotal: acc.autoPendingNew,
        leftForReviewTotal: acc.leftForReview,
        hasMore: r.stats.hasMore,
      })

      if (!r.stats.hasMore || !r.stats.lastId) break
      afterId = r.stats.lastId
    }

    if (acc.autoLinked > 0 || acc.autoPendingNew > 0) {
      revalidatePath('/captura-cadenas-2')
      revalidatePath('/catalogo')
    }

    const pendingFinal = await countScrappingSimilarityPending(admin)
    logScrappingBulk('job_done', {
      jobId,
      ms: Date.now() - tJobStart,
      batches: batchNumber,
      processed: acc.processed,
      pendingFinal,
      autoLinked: acc.autoLinked,
      iaHintsStored: acc.iaHintsStored,
      autoPendingNew: acc.autoPendingNew,
      leftForReview: acc.leftForReview,
      failed: acc.failed,
    })

    patchSimilarityBulkJob(jobId, {
      status: 'done',
      pendingRemaining: pendingFinal,
    })
  } catch (e) {
    const msg = getUserFriendlyErrorMessage(e, 'generic')
    logScrappingBulk('job_exception', {
      jobId,
      batchNumber,
      ms: Date.now() - tJobStart,
      error: msg,
    })
    patchSimilarityBulkJob(jobId, {
      status: 'error',
      error: msg,
    })
  }
}

export async function countPendingForBulkJob(admin: SupabaseClient): Promise<number> {
  return countScrappingSimilarityPending(admin)
}

