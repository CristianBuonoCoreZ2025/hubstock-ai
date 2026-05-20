'use client'

import { useEffect, useState, useRef } from 'react'
import { requestLogger, type LogEntry } from '@/lib/request-logger'
import { X, Trash2, Download, Clock, AlertCircle, CheckCircle, Loader2, MousePointer, Database, Globe, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function RequestLogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [isOpen, setIsOpen] = useState(true)
  const [filter, setFilter] = useState<LogEntry['type'] | 'all'>('all')
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    const unsubscribe = requestLogger.subscribe((newLogs) => {
      setLogs(newLogs)
      if (autoScroll && scrollRef.current) {
        scrollRef.current.scrollTop = 0
      }
    })
    return unsubscribe
  }, [autoScroll])

  const filteredLogs = filter === 'all' ? logs : logs.filter(l => l.type === filter)

  const getTypeIcon = (type: LogEntry['type']) => {
    switch (type) {
      case 'api': return <Globe className="h-3 w-3" />
      case 'db': return <Database className="h-3 w-3" />
      case 'click': return <MousePointer className="h-3 w-3" />
      case 'error': return <AlertCircle className="h-3 w-3" />
      case 'ui': return <Terminal className="h-3 w-3" />
    }
  }

  const getStatusIcon = (status: LogEntry['status']) => {
    switch (status) {
      case 'success': return <CheckCircle className="h-3 w-3 text-green-500" />
      case 'error': return <AlertCircle className="h-3 w-3 text-red-500" />
      case 'pending': return <Loader2 className="h-3 w-3 text-yellow-500 animate-spin" />
    }
  }

  const getTypeColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'api': return 'bg-blue-200 text-blue-900'
      case 'db': return 'bg-purple-200 text-purple-900'
      case 'click': return 'bg-orange-200 text-orange-900'
      case 'error': return 'bg-red-200 text-red-900'
      case 'ui': return 'bg-gray-200 text-gray-900'
    }
  }

  const downloadLogs = () => {
    const blob = new Blob([requestLogger.exportToJSON()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `captura-cadenas-logs-${new Date().toISOString()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const stats = {
    total: logs.length,
    pending: logs.filter(l => l.status === 'pending').length,
    success: logs.filter(l => l.status === 'success').length,
    error: logs.filter(l => l.status === 'error').length,
    avgDuration: logs.filter(l => l.duration).reduce((acc, l) => acc + (l.duration || 0), 0) / logs.filter(l => l.duration).length || 0
  }

  if (!isOpen) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="fixed right-4 top-4 z-[9999] gap-2"
        onClick={() => setIsOpen(true)}
      >
        <Clock className="h-4 w-4" />
        Logs ({stats.total})
        {stats.pending > 0 && (
          <span className="h-5 min-w-5 px-1 rounded bg-gray-200 text-xs">
            {stats.pending}
          </span>
        )}
        {stats.error > 0 && (
          <span className="h-5 min-w-5 px-1 rounded bg-red-500 text-white text-xs">
            {stats.error}
          </span>
        )}
      </Button>
    )
  }

  return (
    <div className="fixed right-4 top-4 z-[9999] w-[380px] max-h-[600px] bg-slate-50 border border-slate-300 rounded-lg shadow-2xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b bg-white rounded-t-lg shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Clock className="h-4 w-4 text-gray-500 shrink-0" />
          <span className="font-semibold text-sm truncate">Request Logs</span>
          <div className="flex items-center gap-1 text-[10px]">
            <span className="px-1.5 py-0.5 rounded bg-gray-200">{stats.total}</span>
            <span className="px-1.5 py-0.5 rounded border text-yellow-600">{stats.pending}</span>
            <span className="px-1.5 py-0.5 rounded border text-green-600">{stats.success}</span>
            <span className="px-1.5 py-0.5 rounded bg-red-500 text-white">{stats.error}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="outline" size="sm" onClick={downloadLogs} className="h-7 px-2 text-xs gap-1">
            <Download className="h-3 w-3" />
            Descargar
          </Button>
          <Button variant="outline" size="sm" onClick={() => requestLogger.clear()} className="h-7 px-2 text-xs gap-1">
            <Trash2 className="h-3 w-3" />
            Eliminar
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)} className="h-7 w-7 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1 p-2 border-b bg-slate-100">
        {(['all', 'api', 'db', 'click', 'error', 'ui'] as const).map((f) => (
          <Button
            key={f}
            variant={filter === f ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 text-xs capitalize"
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'Todos' : f}
          </Button>
        ))}
        <div className="flex-1" />
        <label className="flex items-center gap-1 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="rounded"
          />
          Auto-scroll
        </label>
      </div>

      {/* Log List */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div className="divide-y">
          {filteredLogs.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No hay logs registrados aún
            </div>
          ) : (
            filteredLogs.map((log) => (
              <div
                key={log.id}
                className={cn(
                  'p-2 text-xs hover:bg-white transition-colors border-b border-slate-200',
                  log.status === 'error' && 'bg-red-50',
                  log.status === 'pending' && 'bg-amber-50'
                )}
              >
                <div className="flex items-start gap-2">
                  <div className="flex items-center gap-1 mt-0.5">
                    {getStatusIcon(log.status)}
                    <span className={cn('text-[10px] px-1 py-0 h-4 rounded', getTypeColor(log.type))}>
                      {getTypeIcon(log.type)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{log.action}</span>
                      {log.duration !== undefined && (
                        <span className={cn(
                          'tabular-nums',
                          log.duration > 2000 ? 'text-red-600 font-bold' :
                          log.duration > 1000 ? 'text-orange-600' :
                          'text-green-600'
                        )}>
                          {log.duration.toFixed(1)}ms
                        </span>
                      )}
                      <span className="text-gray-400">
                        {new Date(log.timestamp).toLocaleTimeString('es-CL', { hour12: false })}
                      </span>
                    </div>
                    {log.error && (
                      <div className="text-red-700 mt-1 bg-red-100 p-1 rounded">
                        {log.error}
                      </div>
                    )}
                    {(Boolean(log.request) || Boolean(log.response)) && (
                      <div className="mt-1 space-y-1">
                        {Boolean(log.request) && (
                          <details className="text-gray-600">
                            <summary className="cursor-pointer hover:text-gray-800">Request</summary>
                            <pre className="mt-1 p-2 bg-slate-100 rounded overflow-auto max-h-32 text-xs text-slate-800">
                              {typeof log.request === 'string' ? log.request : JSON.stringify(log.request, null, 2)}
                            </pre>
                          </details>
                        )}
                        {Boolean(log.response) && log.status === 'success' && (
                          <details className="text-slate-600">
                            <summary className="cursor-pointer hover:text-slate-800">Response</summary>
                            <pre className="mt-1 p-2 bg-slate-100 rounded overflow-auto max-h-32 text-xs text-slate-800">
                              {typeof log.response === 'string' ? log.response : JSON.stringify(log.response, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    )}
                    {log.metadata && Object.keys(log.metadata).length > 0 && (
                      <div className="mt-1 text-gray-500">
                        {JSON.stringify(log.metadata)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
