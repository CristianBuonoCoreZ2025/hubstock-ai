with open('src/app/(app)/captura-cadenas-2/CapturaCadenas2Client.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_config = '''              ) : (
                /* === MODO CONFIGURACIÓN: opciones según estado === */
                <div className="space-y-4">
                  {/* Warning si hay running en otro retail */}
                  {barridoPlanCtx.anyRunningGlobally && !barridoPlanCtx.runningForRetail && (
                    <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-950 dark:text-amber-100 text-xs">
                      Hay una corrida en curso en otro retail. Detené el scrapping antes de iniciar un barrido nuevo,
                      reencolar fallidas o vaciar tablas desde acá.
                    </p>
                  )}

                  {/* Info última corrida */}
                  {barridoPlanCtx.latestRun ? (
                    <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                      <p className="font-medium">Última corrida registrada</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Estado: {barridoPlanCtx.latestRun.status} · Fallidas en cola:{' '}
                        {barridoPlanCtx.latestRun.failedPages}
                      </p>
                    </div>
                  ) : (
                    <p className="text-muted-foreground">No hay corridas previas para este retail.</p>
                  )}

                  {/* Acciones en horizontal */}
                  <div className="grid grid-cols-3 gap-3">
                    {/* Reencolar */}
                    {barridoPlanCtx.latestRun && barridoPlanCtx.latestRun.failedPages > 0 ? (
                      <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-3 text-center">
                        <p className="text-xs font-medium text-foreground">{barridoPlanCtx.latestRun.failedPages} fallidas</p>
                        <Button
                          type="button"
                          className="btn-warn btn-lg"
                          disabled={barridoPlanActionBusy || (barridoPlanCtx.anyRunningGlobally && !barridoPlanCtx.runningForRetail)}
                          onClick={() => void requeueFailedAndResumeFromModal()}
                        >
                          {barridoPlanActionBusy ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                          ) : (
                            <Play className="mr-2 h-4 w-4" aria-hidden />
                          )}
                          Continuar
                        </Button>
                      </div>
                    ) : (
                      <div className="rounded-md border border-border bg-muted/20 px-2 py-3 text-center opacity-50">
                        <p className="text-xs text-muted-foreground">Sin fallidas</p>
                      </div>
                    )}

                    {/* Nuevo barrido */}
                    <div className="space-y-2 rounded-md border border-border bg-muted/20 px-2 py-3 text-center">
                      <p className="text-xs font-medium text-foreground">Nuevo barrido</p>
                      <Button
                        type="button"
                        className="btn-run btn-lg"
                        disabled={barridoPlanActionBusy || (barridoPlanCtx.anyRunningGlobally && !barridoPlanCtx.runningForRetail)}
                        onClick={() => void startBarridoFreshFromModal()}
                      >
                        {barridoPlanActionBusy ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <Play className="mr-2 h-4 w-4" aria-hidden />
                        )}
                        Nuevo
                      </Button>
                    </div>

                    {/* Limpiar */}
                    {barridoPlanCtx.globalScrappingPages > 0 ? (
                      <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-3 text-center">
                        <p className="text-xs font-medium text-foreground">({barridoPlanCtx.globalScrappingPages.toLocaleString('es-CL')})</p>
                        <Button
                          type="button"
                          className="btn-danger btn-lg"
                          disabled={purgeIdleBusy || barridoPlanActionBusy || barridoPlanCtx.anyRunningGlobally}
                          onClick={() => void onPurgeScrappingIdle()}
                        >
                          {purgeIdleBusy ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                          ) : (
                            <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                          )}
                          Limpieza
                        </Button>
                      </div>
                    ) : (
                      <div className="rounded-md border border-border bg-muted/20 px-2 py-3 text-center opacity-50">
                        <p className="text-xs text-muted-foreground">Sin datos</p>
                      </div>
                    )}
                  </div>
                </div>
              )}'''

new_config = '''              ) : (
                /* === MODO CONFIGURACIÓN: opciones según estado === */
                <div className="space-y-4">
                  {/* Warning si hay running en otro retail */}
                  {barridoPlanCtx.anyRunningGlobally && !barridoPlanCtx.runningForRetail && (
                    <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-950 dark:text-amber-100 text-xs">
                      Hay una corrida en curso en otro retail. Detené el scrapping antes de iniciar un barrido nuevo
                      o vaciar tablas desde acá.
                    </p>
                  )}

                  {/* Info última corrida */}
                  {barridoPlanCtx.latestRun ? (
                    <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                      <p className="font-medium">Última corrida registrada</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Estado: {barridoPlanCtx.latestRun.status} · Fallidas en cola:{' '}
                        {barridoPlanCtx.latestRun.failedPages}
                      </p>
                    </div>
                  ) : (
                    <p className="text-muted-foreground">No hay corridas previas para este retail.</p>
                  )}

                  {/* Acciones disponibles solo si la última corrida está concluida */}
                  {(() => {
                    const isConcluded =
                      !barridoPlanCtx.latestRun ||
                      barridoPlanCtx.latestRun.status === 'completed' ||
                      barridoPlanCtx.latestRun.status === 'cancelled'
                    return (
                      <div className="grid grid-cols-3 gap-3">
                        {/* Nuevo barrido */}
                        <div className="space-y-2 rounded-md border border-border bg-muted/20 px-2 py-3 text-center">
                          <p className="text-xs font-medium text-foreground">Nuevo barrido</p>
                          <Button
                            type="button"
                            className="btn-run btn-lg"
                            disabled={
                              !isConcluded ||
                              barridoPlanActionBusy ||
                              (barridoPlanCtx.anyRunningGlobally && !barridoPlanCtx.runningForRetail)
                            }
                            onClick={() => void startBarridoFreshFromModal()}
                          >
                            {barridoPlanActionBusy ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                            ) : (
                              <Play className="mr-2 h-4 w-4" aria-hidden />
                            )}
                            Nuevo
                          </Button>
                          {!isConcluded && (
                            <p className="text-[10px] text-amber-700 dark:text-amber-300 mt-1">
                              Concluí la corrida activa antes de iniciar uno nuevo.
                            </p>
                          )}
                        </div>

                        {/* Limpiar */}
                        {barridoPlanCtx.globalScrappingPages > 0 ? (
                          <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-3 text-center">
                            <p className="text-xs font-medium text-foreground">({barridoPlanCtx.globalScrappingPages.toLocaleString('es-CL')})</p>
                            <Button
                              type="button"
                              className="btn-danger btn-lg"
                              disabled={
                                !isConcluded ||
                                purgeIdleBusy ||
                                barridoPlanActionBusy ||
                                barridoPlanCtx.anyRunningGlobally
                              }
                              onClick={() => void onPurgeScrappingIdle()}
                            >
                              {purgeIdleBusy ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                              ) : (
                                <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                              )}
                              Limpieza
                            </Button>
                            {!isConcluded && (
                              <p className="text-[10px] text-amber-700 dark:text-amber-300 mt-1">
                                Concluí la corrida activa antes de limpiar.
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="rounded-md border border-border bg-muted/20 px-2 py-3 text-center opacity-50">
                            <p className="text-xs text-muted-foreground">Sin datos</p>
                          </div>
                        )}

                        {/* Estado cuando no está concluida */}
                        {!isConcluded && barridoPlanCtx.latestRun && (
                          <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-3 text-center">
                            <p className="text-xs font-medium text-amber-800 dark:text-amber-200">Corrida activa</p>
                            <p className="text-[10px] text-muted-foreground">
                              La última corrida está en estado <strong>{barridoPlanCtx.latestRun.status}</strong>. No se puede iniciar nuevo ni limpiar hasta concluirla (completada, cancelada o forzada).
                            </p>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              )}'''

if old_config in content:
    content = content.replace(old_config, new_config)
    print('OK config mode')
else:
    print('FAIL config mode')

with open('src/app/(app)/captura-cadenas-2/CapturaCadenas2Client.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
