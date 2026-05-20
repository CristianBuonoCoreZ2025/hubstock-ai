import re

with open('src/app/(app)/captura-cadenas-2/CapturaCadenas2Client.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# === 1. Reemplazar Modo Ejecución ===
old_execution = '''              {/* === MODO EJECUCIÓN: solo dashboard + detener === */}
              {fullSweepBusy || barridoPlanCtx?.runningForRetail ? (
                <div className="space-y-4">
                  {/* Header */}
                  <div className="flex items-center gap-2 text-sm font-medium text-blue-900 dark:text-blue-100">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" aria-hidden />
                    Barrido en ejecución · {currentRetailLabel || 'Cargando…'}
                  </div>

                  {/* Dashboard visual */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-md border border-blue-500/20 bg-blue-500/5 px-2 py-3 text-center">
                      <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{queuePagesTotal.toLocaleString('es-CL')}</p>
                      <p className="text-[10px] uppercase tracking-wider text-blue-600 dark:text-blue-400">Páginas total</p>
                    </div>
                    <div className="rounded-md border border-blue-500/20 bg-blue-500/5 px-2 py-3 text-center">
                      <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{scraperRowsTotal.toLocaleString('es-CL')}</p>
                      <p className="text-[10px] uppercase tracking-wider text-blue-600 dark:text-blue-400">Productos</p>
                    </div>
                    <div className="rounded-md border border-blue-500/20 bg-blue-500/5 px-2 py-3 text-center">
                      <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{Math.max(0, queuePagesTotal - queuePagesProcessed).toLocaleString('es-CL')}</p>
                      <p className="text-[10px] uppercase tracking-wider text-blue-600 dark:text-blue-400">Restantes</p>
                    </div>
                    <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2 py-3 text-center">
                      <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{queuePagesOk.toLocaleString('es-CL')}</p>
                      <p className="text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Ok</p>
                    </div>
                    <div className="rounded-md border border-red-500/20 bg-red-500/5 px-2 py-3 text-center">
                      <p className="text-2xl font-bold text-red-600 dark:text-red-400">{queuePagesFailed.toLocaleString('es-CL')}</p>
                      <p className="text-[10px] uppercase tracking-wider text-red-600 dark:text-red-400">Fallidas</p>
                    </div>
                    <div className="rounded-md border border-slate-500/20 bg-slate-500/5 px-2 py-3 text-center">
                      <p className="text-2xl font-bold text-slate-600 dark:text-slate-400">{Math.max(0, queuePagesProcessed).toLocaleString('es-CL')}</p>
                      <p className="text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400">Procesadas</p>
                    </div>
                  </div>

                  {/* Barra de progreso */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-blue-800 dark:text-blue-200">
                      <span>{queuePagesProcessed.toLocaleString('es-CL')} de {queuePagesTotal.toLocaleString('es-CL')}</span>
                      <span>{queuePagesTotal > 0 ? Math.round((queuePagesProcessed / queuePagesTotal) * 100) : 0}%</span>
                    </div>
                    <div className="h-3 w-full overflow-hidden rounded-full bg-blue-200 dark:bg-blue-900">
                      <div
                        className="h-full rounded-full bg-blue-600 transition-[width] duration-300 ease-out"
                        style={{ width: queuePagesTotal > 0 ? `${Math.min(100, (queuePagesProcessed / queuePagesTotal) * 100)}%` : '0%' }}
                      />
                    </div>
                  </div>

                  {/* Botón Detener */}
                  <Button
                    type="button"
                    className="btn-danger btn-lg w-full"
                    disabled={stopBusy}
                    onClick={() => {
                      requestLogger.logClick('Detener scrapping (desde modal)')
                      void onDetenerScrapping()
                    }}
                  >
                    {stopBusy ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Square className="mr-2 h-4 w-4" aria-hidden />
                    )}
                    Detener scrapping
                  </Button>

                  <p className="text-[10px] text-blue-700 dark:text-blue-300 text-center">
                    El barrido continúa en segundo plano si cerrás este modal.
                  </p>
                </div>
              )'''

new_execution = '''              {/* === MODO EJECUCIÓN: dashboard + continuar/detener/concluir forzado === */}
              {fullSweepBusy || barridoPlanCtx?.runningForRetail ? (
                <div className="space-y-4">
                  {/* Header */}
                  <div className="flex items-center gap-2 text-sm font-medium text-blue-900 dark:text-blue-100">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" aria-hidden />
                    Barrido en ejecución · {currentRetailLabel || 'Cargando…'}
                  </div>

                  {/* Dashboard visual */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-md border border-blue-500/20 bg-blue-500/5 px-2 py-3 text-center">
                      <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{queuePagesTotal.toLocaleString('es-CL')}</p>
                      <p className="text-[10px] uppercase tracking-wider text-blue-600 dark:text-blue-400">Páginas total</p>
                    </div>
                    <div className="rounded-md border border-blue-500/20 bg-blue-500/5 px-2 py-3 text-center">
                      <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{scraperRowsTotal.toLocaleString('es-CL')}</p>
                      <p className="text-[10px] uppercase tracking-wider text-blue-600 dark:text-blue-400">Productos</p>
                    </div>
                    <div className="rounded-md border border-blue-500/20 bg-blue-500/5 px-2 py-3 text-center">
                      <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{Math.max(0, queuePagesTotal - queuePagesProcessed).toLocaleString('es-CL')}</p>
                      <p className="text-[10px] uppercase tracking-wider text-blue-600 dark:text-blue-400">Restantes</p>
                    </div>
                    <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2 py-3 text-center">
                      <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{queuePagesOk.toLocaleString('es-CL')}</p>
                      <p className="text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Ok</p>
                    </div>
                    <div className="rounded-md border border-red-500/20 bg-red-500/5 px-2 py-3 text-center">
                      <p className="text-2xl font-bold text-red-600 dark:text-red-400">{queuePagesFailed.toLocaleString('es-CL')}</p>
                      <p className="text-[10px] uppercase tracking-wider text-red-600 dark:text-red-400">Fallidas</p>
                    </div>
                    <div className="rounded-md border border-slate-500/20 bg-slate-500/5 px-2 py-3 text-center">
                      <p className="text-2xl font-bold text-slate-600 dark:text-slate-400">{Math.max(0, queuePagesProcessed).toLocaleString('es-CL')}</p>
                      <p className="text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400">Procesadas</p>
                    </div>
                  </div>

                  {/* Barra de progreso */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-blue-800 dark:text-blue-200">
                      <span>{queuePagesProcessed.toLocaleString('es-CL')} de {queuePagesTotal.toLocaleString('es-CL')}</span>
                      <span>{queuePagesTotal > 0 ? Math.round((queuePagesProcessed / queuePagesTotal) * 100) : 0}%</span>
                    </div>
                    <div className="h-3 w-full overflow-hidden rounded-full bg-blue-200 dark:bg-blue-900">
                      <div
                        className="h-full rounded-full bg-blue-600 transition-[width] duration-300 ease-out"
                        style={{ width: queuePagesTotal > 0 ? `${Math.min(100, (queuePagesProcessed / queuePagesTotal) * 100)}%` : '0%' }}
                      />
                    </div>
                  </div>

                  {/* Acciones */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-3 text-center">
                      <p className="text-xs font-medium text-foreground">Retomar</p>
                      <Button
                        type="button"
                        className="btn-run btn-lg w-full"
                        disabled={barridoPlanActionBusy}
                        onClick={() => {
                          const runId = barridoPlanCtx?.runningForRetail?.runId
                          if (runId) void resumeBarridoFromModal(runId)
                        }}
                      >
                        {barridoPlanActionBusy ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <Play className="mr-2 h-4 w-4" aria-hidden />
                        )}
                        Continuar
                      </Button>
                    </div>

                    <div className="space-y-2 rounded-md border border-red-500/30 bg-red-500/5 px-2 py-3 text-center">
                      <p className="text-xs font-medium text-foreground">Cancelar</p>
                      <Button
                        type="button"
                        className="btn-danger btn-lg w-full"
                        disabled={stopBusy}
                        onClick={() => {
                          requestLogger.logClick('Detener scrapping (desde modal)')
                          void onDetenerScrapping()
                        }}
                      >
                        {stopBusy ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <Square className="mr-2 h-4 w-4" aria-hidden />
                        )}
                        Detener
                      </Button>
                    </div>

                    <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-3 text-center">
                      <p className="text-xs font-medium text-foreground">Cierre irreversible</p>
                      <Button
                        type="button"
                        className="btn-warn btn-lg w-full"
                        disabled={forceFinalizeBusy}
                        onClick={() => void onForceFinalizeScrappingFromModal()}
                      >
                        {forceFinalizeBusy ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <AlertTriangle className="mr-2 h-4 w-4" aria-hidden />
                        )}
                        Concluir forzado
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-amber-950 dark:text-amber-100 text-xs">
                    <AlertTriangle className="inline mr-1 h-3 w-3" aria-hidden />
                    <strong>Advertencia:</strong> "Concluir forzado" marca todas las páginas pendientes o en proceso como completadas sin descargar. No se podrá retomar el barrido después. Es irreversible.
                  </div>

                  <p className="text-[10px] text-blue-700 dark:text-blue-300 text-center">
                    El barrido continúa en segundo plano si cerrás este modal.
                  </p>
                </div>
              )'''

if old_execution in content:
    content = content.replace(old_execution, new_execution)
    print('OK execution mode')
else:
    print('FAIL execution mode')

with open('src/app/(app)/captura-cadenas-2/CapturaCadenas2Client.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
