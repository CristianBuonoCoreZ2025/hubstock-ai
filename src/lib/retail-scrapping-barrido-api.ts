import type {
  BarridoContextResponse,
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
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body ?? {}),
    signal,
  })
  let data: unknown
  try {
    data = await res.json()
  } catch {
    return { ok: false, error: 'Respuesta no válida del servidor.' } as T
  }
  if (!res.ok && (data == null || typeof data !== 'object')) {
    return { ok: false, error: `Error de red (${res.status})` } as T
  }
  return data as T
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: 'same-origin' })
  let data: unknown
  try {
    data = await res.json()
  } catch {
    return { ok: false, error: 'Respuesta no válida del servidor.' } as T
  }
  if (!res.ok && (data == null || typeof data !== 'object')) {
    return { ok: false, error: `Error de red (${res.status})` } as T
  }
  return data as T
}

export async function barridoApiListRuns(): Promise<BarridoListRunsResponse> {
  return getJson<BarridoListRunsResponse>('/runs')
}

export async function barridoApiListRetails(): Promise<BarridoListRetailsResponse> {
  return getJson<BarridoListRetailsResponse>('/retails')
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
