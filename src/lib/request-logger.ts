// Sistema de logging de peticiones global para StockCasa
// Registra cada consulta, clic, y respuesta con timestamps

const STORAGE_KEY = 'stockcasa-diag-log-enabled'
const MAX_LOGS = 300
const MAX_BODY_CHARS = 5000

const SENSITIVE_KEYS = new Set([
  'authorization',
  'x-api-key',
  'cookie',
  'set-cookie',
  'token',
  'password',
  'secret',
  'service_role',
  'apikey',
  'api_key',
  'access_token',
  'refresh_token',
  'id_token',
])

function sanitizeObject(obj: unknown): unknown {
  if (obj == null) return obj
  if (typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(sanitizeObject)
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const lower = key.toLowerCase()
    if (SENSITIVE_KEYS.has(lower)) {
      out[key] = typeof value === 'string' ? value.slice(0, 6) + '…' : '***'
    } else {
      out[key] = sanitizeObject(value)
    }
  }
  return out
}

function truncateBody(body: unknown): unknown {
  if (body == null) return body
  const str = typeof body === 'string' ? body : JSON.stringify(body)
  if (str.length > MAX_BODY_CHARS) {
    return str.slice(0, MAX_BODY_CHARS) + ' …[body omitido por tamaño]'
  }
  return body
}

export interface LogEntry {
  id: string
  timestamp: string
  type: 'api' | 'click' | 'db' | 'error' | 'ui'
  action: string
  startTime: number
  endTime?: number
  duration?: number
  status: 'pending' | 'success' | 'error'
  request?: unknown
  response?: unknown
  error?: string
  metadata?: Record<string, unknown>
  pathname?: string
}

type EnabledListener = (enabled: boolean) => void

class RequestLogger {
  private logs: LogEntry[] = []
  private maxLogs = MAX_LOGS
  private listeners: ((logs: LogEntry[]) => void)[] = []
  private enabledListeners: EnabledListener[] = []
  private enabled: boolean

  constructor() {
    this.enabled = this.readEnabledFromStorage()
  }

  private readEnabledFromStorage(): boolean {
    if (typeof window === 'undefined') return false
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  }

  private writeEnabledToStorage(enabled: boolean) {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled))
    } catch {
      // ignore
    }
  }

  getEnabled(): boolean {
    return this.enabled
  }

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return
    this.enabled = enabled
    this.writeEnabledToStorage(enabled)
    this.enabledListeners.forEach((fn) => fn(enabled))
  }

  subscribeEnabled(fn: EnabledListener): () => void {
    this.enabledListeners.push(fn)
    return () => {
      this.enabledListeners = this.enabledListeners.filter((l) => l !== fn)
    }
  }

  enable() {
    this.setEnabled(true)
  }

  disable() {
    this.setEnabled(false)
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  private notify() {
    this.listeners.forEach((fn) => fn([...this.logs]))
  }

  subscribe(fn: (logs: LogEntry[]) => void): () => void {
    this.listeners.push(fn)
    fn([...this.logs])
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn)
    }
  }

  private currentPathname(): string | undefined {
    if (typeof window === 'undefined') return undefined
    return window.location.pathname
  }

  startLog(
    type: LogEntry['type'],
    action: string,
    request?: unknown,
    metadata?: Record<string, unknown>,
  ): string {
    if (!this.enabled) return ''

    const id = this.generateId()
    const entry: LogEntry = {
      id,
      timestamp: new Date().toISOString(),
      type,
      action,
      startTime: performance.now(),
      status: 'pending',
      request: truncateBody(sanitizeObject(request)),
      metadata: sanitizeObject(metadata) as Record<string, unknown> | undefined,
      pathname: this.currentPathname(),
    }

    this.logs.unshift(entry)

    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs)
    }

    this.notify()

    return id
  }

  endLog(id: string, status: 'success' | 'error', response?: unknown, error?: string) {
    if (!this.enabled || !id) return

    const entry = this.logs.find((l) => l.id === id)
    if (!entry) return

    entry.endTime = performance.now()
    entry.duration = entry.endTime - entry.startTime
    entry.status = status
    entry.response = truncateBody(sanitizeObject(response))
    entry.error = error

    this.notify()
  }

  logClick(buttonName: string, metadata?: Record<string, unknown>) {
    const id = this.startLog('click', buttonName, undefined, metadata)
    this.endLog(id, 'success')
  }

  logUI(message: string, metadata?: Record<string, unknown>) {
    const id = this.startLog('ui', message, undefined, metadata)
    this.endLog(id, 'success')
  }

  logError(action: string, error: string, metadata?: Record<string, unknown>) {
    const id = this.startLog('error', action, undefined, metadata)
    this.endLog(id, 'error', undefined, error)
  }

  getLogs(): LogEntry[] {
    return [...this.logs]
  }

  getLogsByType(type: LogEntry['type']): LogEntry[] {
    return this.logs.filter((l) => l.type === type)
  }

  getPendingLogs(): LogEntry[] {
    return this.logs.filter((l) => l.status === 'pending')
  }

  clear() {
    this.logs = []
    this.notify()
  }

  exportToJSON(): string {
    return JSON.stringify(this.logs, null, 2)
  }
}

export const requestLogger = new RequestLogger()

// Helper para envolver funciones async con logging
export async function withLogging<T>(
  type: LogEntry['type'],
  action: string,
  fn: () => Promise<T>,
  request?: unknown,
  metadata?: Record<string, unknown>,
): Promise<T> {
  const id = requestLogger.startLog(type, action, request, metadata)

  try {
    const result = await fn()
    requestLogger.endLog(id, 'success', result)
    return result
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    requestLogger.endLog(id, 'error', undefined, errorMsg)
    throw error
  }
}
