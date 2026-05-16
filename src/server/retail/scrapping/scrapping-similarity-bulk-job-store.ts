/**
 * Etapa E: progreso de pasada masiva en memoria (proceso Node dev / servidor long-running).
 */

export type SimilarityBulkJobStatus = 'running' | 'done' | 'error' | 'cancelled'

export type SimilarityBulkJobProgress = {
  jobId: string
  status: SimilarityBulkJobStatus
  total: number
  processed: number
  autoLinked: number
  iaHintsStored: number
  autoPendingNew: number
  leftForReview: number
  failed: number
  error: string | null
  startedAt: string
  updatedAt: string
  /** Solo diagnóstico en servidor / logs */
  batchNumber?: number
  pendingRemaining?: number | null
}

const jobs = new Map<string, SimilarityBulkJobProgress>()
const JOB_TTL_MS = 2 * 60 * 60 * 1000

function pruneOldJobs(): void {
  const cutoff = Date.now() - JOB_TTL_MS
  for (const [id, job] of jobs) {
    if (new Date(job.updatedAt).getTime() < cutoff) jobs.delete(id)
  }
}

export function createSimilarityBulkJob(total: number): SimilarityBulkJobProgress {
  pruneOldJobs()
  const jobId = crypto.randomUUID()
  const now = new Date().toISOString()
  const job: SimilarityBulkJobProgress = {
    jobId,
    status: 'running',
    total,
    processed: 0,
    autoLinked: 0,
    iaHintsStored: 0,
    autoPendingNew: 0,
    leftForReview: 0,
    failed: 0,
    error: null,
    startedAt: now,
    updatedAt: now,
  }
  jobs.set(jobId, job)
  return job
}

export function getSimilarityBulkJob(jobId: string): SimilarityBulkJobProgress | null {
  return jobs.get(jobId) ?? null
}

export function patchSimilarityBulkJob(
  jobId: string,
  patch: Partial<
    Pick<
      SimilarityBulkJobProgress,
      | 'processed'
      | 'autoLinked'
      | 'iaHintsStored'
      | 'autoPendingNew'
      | 'leftForReview'
      | 'failed'
      | 'status'
      | 'error'
      | 'batchNumber'
      | 'pendingRemaining'
    >
  >,
): SimilarityBulkJobProgress | null {
  const cur = jobs.get(jobId)
  if (!cur) return null
  const next: SimilarityBulkJobProgress = {
    ...cur,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  jobs.set(jobId, next)
  return next
}

export function cancelSimilarityBulkJob(jobId: string): void {
  patchSimilarityBulkJob(jobId, { status: 'cancelled' })
}

export function isSimilarityBulkJobCancelled(jobId: string): boolean {
  return jobs.get(jobId)?.status === 'cancelled'
}
