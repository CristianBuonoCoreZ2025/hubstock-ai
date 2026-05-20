// Sistema de logging de peticiones para CapturaCadenas2
// Registra cada consulta, clic, y respuesta con timestamps

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
}

class RequestLogger {
  private logs: LogEntry[] = []
  private maxLogs = 1000
  private listeners: ((logs: LogEntry[]) => void)[] = []
  private enabled = true

  enable() {
    this.enabled = true
  }

  disable() {
    this.enabled = false
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  private notify() {
    this.listeners.forEach(fn => fn([...this.logs]))
  }

  subscribe(fn: (logs: LogEntry[]) => void): () => void {
    this.listeners.push(fn)
    fn([...this.logs])
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn)
    }
  }

  startLog(type: LogEntry['type'], action: string, request?: unknown, metadata?: Record<string, unknown>): string {
    if (!this.enabled) return ''
    
    const id = this.generateId()
    const entry: LogEntry = {
      id,
      timestamp: new Date().toISOString(),
      type,
      action,
      startTime: performance.now(),
      status: 'pending',
      request,
      metadata
    }
    
    this.logs.unshift(entry)
    
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs)
    }
    
    this.notify()
    
    // También log a consola para debugging
    console.log(`[${type.toUpperCase()} START] ${action}`, { id, request, metadata })
    
    return id
  }

  endLog(id: string, status: 'success' | 'error', response?: unknown, error?: string) {
    if (!this.enabled || !id) return
    
    const entry = this.logs.find(l => l.id === id)
    if (!entry) return
    
    entry.endTime = performance.now()
    entry.duration = entry.endTime - entry.startTime
    entry.status = status
    entry.response = response
    entry.error = error
    
    this.notify()
    
    console.log(
      `[${entry.type.toUpperCase()} ${status.toUpperCase()}] ${entry.action} - ${entry.duration.toFixed(2)}ms`,
      { id, response, error }
    )
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
    return this.logs.filter(l => l.type === type)
  }

  getPendingLogs(): LogEntry[] {
    return this.logs.filter(l => l.status === 'pending')
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
  metadata?: Record<string, unknown>
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
