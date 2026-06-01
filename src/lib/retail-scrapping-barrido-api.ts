import { requestLogger } from '@/lib/request-logger'
import type {
  BarridoContextResponse,
  BarridoInitResponse,
  BarridoListRetailsResponse,
  BarridoListRunsResponse,
  BarridoPersistOutcomeResponse,
  BarridoPhase1EnqueueResponse,
  BarridoPhase2SealResponse,
  BarridoPrepareRunResponse,
  BarridoPurgeIdleResponse,
  BarridoRequeueFailedResponse,
  BarridoResumeResponse,
  BarridoStopResponse,
  ProcessLiderScrappingRunPageResult,
} from '@/types/retail-scrapping-barrido-api'

const BASE = '/api/retail-scrapping'

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const logId = requestLogger.startLog('api', `POST ${path}`, body, undefined, requestLogger.getSessionTraceId())
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (requestLogger.getEnabled()) headers['x-app-diagnostic-log'] = '1'
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify(body ?? {}),
    signal,
  })
  let data: unknown
  try {
    data = await res.json()
  } catch {
    requestLogger.endLog(logId, 'error', undefined, 'Respuesta no valida del servidor.')
    return { ok: false, error: 'Respuesta no válida del servidor.' } as T
  }
  if (!res.ok && (data == null || typeof data !== 'object')) {
    requestLogger.endLog(logId, 'error', undefined, `Error de red (${res.status})`)
    return { ok: false, error: `Error de red (${res.status})` } as T
  }
  requestLogger.endLog(logId, 'success', data)
  return data as T
}

async function getJson<T>(path: string): Promise<T> {
  const logId = requestLogger.startLog('api', `GET ${path}`, undefined, undefined, requestLogger.getSessionTraceId())
  const headers: Record<string, string> = {}
  if (requestLogger.getEnabled()) headers['x-app-diagnostic-log'] = '1'
  const res = await fetch(`${BASE}${path}`, { credentials: 'same-origin', headers })
  let data: unknown
  try {
    data = await res.json()
  } catch {
    requestLogger.endLog(logId, 'error', undefined, 'Respuesta no valida del servidor.')
    return { ok: false, error: 'Respuesta no válida del servidor.' } as T
  }
  if (!res.ok && (data == null || typeof data !== 'object')) {
    requestLogger.endLog(logId, 'error', undefined, `Error de red (${res.status})`)
    return { ok: false, error: `Error de red (${res.status})` } as T
  }
  requestLogger.endLog(logId, 'success', data)
  return data as T
}

export async function barridoApiListRuns(): Promise<BarridoListRunsResponse> {
  return getJson<BarridoListRunsResponse>('/runs')
}

export async function barridoApiListRetails(): Promise<BarridoListRetailsResponse> {
  return getJson<BarridoListRetailsResponse>('/retails')
}

export async function barridoApiInit(): Promise<BarridoInitResponse> {
  return getJson<BarridoInitResponse>('/init')
}

export async function barridoApiStop(): Promise<BarridoStopResponse> {
  return postJson<BarridoStopResponse>('/stop', {})
}

export async function barridoApiPrepareRun(retailId: string): Promise<BarridoPrepareRunResponse> {
  return postJson<BarridoPrepareRunResponse>('/prepare-run', { retailId })
}

export async function barridoApiPhase1Enqueue(input: {
  runId: string
  retailId: string
}): Promise<BarridoPhase1EnqueueResponse> {
  return postJson<BarridoPhase1EnqueueResponse>('/phase1-enqueue', input)
}

export async function barridoApiPhase2Seal(
  input: {
    runId: string
    retailId: string
    maxPages?: number
  },
  signal?: AbortSignal,
): Promise<BarridoPhase2SealResponse> {
  return postJson<BarridoPhase2SealResponse>('/phase2-seal', input, signal)
}

export async function barridoApiPersistOutcome(input: {
  runId: string
  summary: string
}): Promise<BarridoPersistOutcomeResponse> {
  return postJson<BarridoPersistOutcomeResponse>('/persist-outcome', input)
}

export async function barridoApiProcessRunPage(runId: string, signal?: AbortSignal): Promise<ProcessLiderScrappingRunPageResult> {
  return postJson<ProcessLiderScrappingRunPageResult>('/process-run-page', { runId }, signal)
}

export async function barridoApiBarridoContext(retailId: string): Promise<BarridoContextResponse> {
  const q = encodeURIComponent(retailId)
  return getJson<BarridoContextResponse>(`/barrido-context?retailId=${q}`)
}

export async function barridoApiResumeBarrido(input: {
  runId: string
  retailId: string
}): Promise<BarridoResumeResponse> {
  return postJson<BarridoResumeResponse>('/resume-barrido', input)
}

export async function barridoApiPurgeIfIdle(): Promise<BarridoPurgeIdleResponse> {
  return postJson<BarridoPurgeIdleResponse>('/purge-if-idle', {})
}

export async function barridoApiRequeueFailedLatest(retailId: string): Promise<BarridoRequeueFailedResponse> {
  return postJson<BarridoRequeueFailedResponse>('/requeue-failed-latest', { retailId })
}
export async function barridoApiSubmitPageHtml(input: {
  runId: string
  pageId: string
  pageUrl: string
  html: string
}): Promise<{ ok: true; productsFound: number; rowsWritten: number } | { ok: false; error: string }> {
  return postJson('/submit-page-html', input)
}
