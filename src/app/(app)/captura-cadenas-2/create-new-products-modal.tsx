'use client'

import { useCallback, useState } from 'react'
import {
  CheckCircle2,
  Loader2,
  PackagePlus,
  Play,
  Sparkles,
  Trophy,
  XCircle,
  Image as ImageIcon,
  Tags,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  getCatalogSectionsWithCategoriesAction,
  runScrappingHomologationCreateNewBatchAction,
  type CatalogSectionWithCategories,
} from '@/app/actions/retail-scrapping'

/* ────────── Tipos ────────── */

type RunStatus = 'idle' | 'running' | 'done' | 'error'

type RunResult = {
  processed: number
  total: number
  created: number
  recovered: number
  skipped: number
  mediaOk: number
  mediaFailed: number
  errors: number
  lastError?: string | null
}

export type CreateNewProductsModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  pendingNew: number
  onFinished: () => void
}

/* ────────── Componentes visuales (mismos tokens que HomologationWizardModal) ────────── */

function ShimmerBar({ indeterminate, pct, color }: {
  indeterminate?: boolean
  pct?: number
  color?: 'emerald' | 'sky'
}) {
  const from = color === 'sky' ? '#0284c7' : '#10b981'
  const mid = color === 'sky' ? 'rgba(2,132,199,0.3)' : 'rgba(16,185,129,0.3)'
  const width = indeterminate ? '100%' : `${Math.min(100, pct ?? 0)}%`
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted/60">
      <div
        className="h-full rounded-full"
        style={{
          background: `linear-gradient(90deg, ${from} 0%, ${mid} 50%, ${from} 100%)`,
          backgroundSize: '200% 100%',
          animation: indeterminate ? 'homolog-shimmer 1.8s ease-in-out infinite' : undefined,
          width,
          transition: 'width 0.5s ease-out',
        }}
      />
    </div>
  )
}

/* ────────── Inner ────────── */

function CreateNewProductsModalInner({
  onOpenChange,
  pendingNew,
  onFinished,
}: Omit<CreateNewProductsModalProps, 'open'>) {
  const [status, setStatus] = useState<RunStatus>('idle')
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [fallbackCatId, setFallbackCatId] = useState<string>('__auto__')
  const [sections, setSections] = useState<CatalogSectionWithCategories[]>([])
  const [sectionsLoading, setSectionsLoading] = useState(false)

  const loadSections = useCallback(async () => {
    if (sections.length > 0) return
    setSectionsLoading(true)
    const r = await getCatalogSectionsWithCategoriesAction()
    if (r.ok) setSections(r.sections)
    setSectionsLoading(false)
  }, [sections.length])

  const runBatch = useCallback(async () => {
    setStatus('running')
    setError(null)
    const fallbackCategoryId = fallbackCatId !== '__auto__' ? fallbackCatId : null

    const acc: RunResult = {
      processed: 0,
      total: pendingNew,
      created: 0,
      recovered: 0,
      skipped: 0,
      mediaOk: 0,
      mediaFailed: 0,
      errors: 0,
    }
    setResult({ ...acc })

    let afterId: string | null = null
    try {
      for (;;) {
        const out = await runScrappingHomologationCreateNewBatchAction({
          afterId,
          batchSize: 10,
          fallbackCategoryId,
        })
        if (!out.ok) {
          setStatus('error')
          setError(out.error)
          return
        }
        const { stats, hasMore, lastId, total } = out.result
        acc.processed += stats.processed
        acc.created += stats.created
        acc.recovered += stats.recovered
        acc.skipped += stats.skipped
        acc.mediaOk += stats.mediaOk
        acc.mediaFailed += stats.mediaFailed
        acc.errors += stats.errors
        acc.lastError = stats.lastError ?? acc.lastError
        acc.total = Math.max(acc.total, total + acc.processed)
        setResult({ ...acc })

        if (!hasMore || !lastId) break
        afterId = lastId
      }
      setStatus('done')
      onFinished()
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : 'Error inesperado')
    }
  }, [fallbackCatId, pendingNew, onFinished])

  const isRunning = status === 'running'
  const isDone = status === 'done'
  const pct = result && result.total > 0 ? Math.min(100, Math.round((result.processed / result.total) * 100)) : 0

  return (
    <>
      {/* ━━━ Header ━━━ */}
      <div className="relative overflow-hidden border-b">
        <div className="absolute inset-0 bg-linear-to-br from-emerald-500/10 via-transparent to-teal-500/8" />
        {isRunning && (
          <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-emerald-500/10 blur-2xl" />
        )}
        <DialogHeader className="relative px-8 pb-5 pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/30 ${isRunning ? 'shadow-emerald-500/50' : ''}`}>
                {isRunning && (
                  <div className="absolute inset-0 rounded-2xl bg-emerald-500/30" style={{ animation: 'homolog-pulse-ring 2s ease-in-out infinite' }} />
                )}
                <PackagePlus className="relative h-7 w-7 text-white" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold tracking-tight">
                  Crear maestros nuevos
                </DialogTitle>
                <DialogDescription className="mt-0.5 text-sm">
                  {pendingNew.toLocaleString('es-CL')} producto(s) sin homólogo en catálogo
                </DialogDescription>
                <div className="mt-3 flex gap-1.5">
                  {(
                    [
                      { icon: Tags, label: 'Taxonomía', active: status === 'idle', done: isDone },
                      { icon: PackagePlus, label: 'Maestros', active: isRunning, done: isDone },
                      { icon: ImageIcon, label: 'Imágenes', active: isRunning, done: isDone },
                    ] as const
                  ).map(({ icon: Icon, label, active, done }) => (
                    <div
                      key={label}
                      className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all duration-500 ${
                        done
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : active
                            ? 'bg-emerald-500/15 text-emerald-700'
                            : 'bg-muted text-muted-foreground/50'
                      }`}
                    >
                      <Icon className="h-3 w-3" />
                      {label}
                      {done && <CheckCircle2 className="ml-0.5 h-3 w-3" />}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </DialogHeader>
      </div>

      {/* ━━━ Cuerpo ━━━ */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">

        {/* ── Zona principal ── */}
        <div className="flex flex-col gap-5 px-8 py-6">

          {/* Selector de categoría de respaldo */}
          {!isDone && (
            <div
              className={`space-y-3 rounded-xl border p-5 transition-all duration-300 ${
                isRunning
                  ? 'border-border/40 opacity-50'
                  : 'border-emerald-500/20 bg-emerald-500/[0.03]'
              }`}
              style={{ animation: 'homolog-fade-up 0.35s ease-out both' }}
            >
              <div className="flex items-center gap-2">
                <Tags className="h-4 w-4 text-emerald-600" />
                <p className="text-sm font-bold tracking-tight">Categoría de respaldo</p>
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  opcional
                </span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Si el retailer no tiene taxonomía mapeada, los productos se asignan aquí. Dejá en <strong>Auto</strong> para usar el fuzzy del catálogo.
              </p>
              <Select
                value={fallbackCatId}
                onValueChange={setFallbackCatId}
                disabled={isRunning}
                onOpenChange={(open) => { if (open) void loadSections() }}
              >
                <SelectTrigger className="h-9 w-full text-sm">
                  {sectionsLoading ?
                    <div className="flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Cargando...</span>
                    </div>
                  : <SelectValue placeholder="Auto (recomendado)" />}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto__" className="text-xs text-muted-foreground">
                    Auto — fuzzy por nombre
                  </SelectItem>
                  {sections.map((sec) => (
                    <div key={sec.sectionId}>
                      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {sec.sectionName}
                      </div>
                      {sec.categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id} className="pl-4 text-xs">
                          {cat.name}
                        </SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Progreso en tiempo real */}
          {(isRunning || isDone) && result && (
            <div
              className="space-y-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-5"
              style={{ animation: 'homolog-fade-up 0.3s ease-out both' }}
            >
              <div className="flex items-center justify-between text-sm tabular-nums">
                <p className="font-bold text-emerald-700">
                  {result.processed.toLocaleString('es-CL')} de {result.total.toLocaleString('es-CL')} productos
                </p>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 font-bold text-emerald-700">
                    {pct}%
                  </span>
                  {isRunning && <Sparkles className="h-4 w-4 animate-pulse text-emerald-500" />}
                  {isDone && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                </div>
              </div>
              <ShimmerBar
                indeterminate={isRunning && result.processed === 0}
                pct={pct}
                color="emerald"
              />
              {result.lastError && result.errors > 0 && (
                <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-[11px] font-mono leading-relaxed text-destructive">
                  {result.lastError}
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {status === 'error' && error && (
            <div
              className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3"
              style={{ animation: 'homolog-fade-up 0.3s ease-out both' }}
            >
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {/* Resumen final */}
          {isDone && result && (
            <div style={{ animation: 'homolog-fade-up 0.4s ease-out both' }}>
              {result.created > 0 ?
                <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
                  <Trophy className="h-6 w-6 shrink-0 text-emerald-500" />
                  <div>
                    <p className="text-sm font-bold text-emerald-700">¡Proceso completado!</p>
                    <p className="text-xs text-emerald-700/80">{result.created.toLocaleString('es-CL')} producto(s) creados en el catálogo maestro</p>
                  </div>
                </div>
              : <div className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                  <PackagePlus className="h-6 w-6 shrink-0 text-amber-500" />
                  <p className="text-sm text-amber-700">Ningún producto creado — probá eligiendo una categoría de respaldo y reintentando.</p>
                </div>
              }
            </div>
          )}

          {/* Estado idle */}
          {status === 'idle' && (
            <div
              className="flex items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 py-10 text-center"
              style={{ animation: 'homolog-fade-up 0.4s ease-out 0.1s both' }}
            >
              <div>
                <PackagePlus className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm font-medium text-muted-foreground">Listo para procesar</p>
                <p className="mt-1 text-xs text-muted-foreground/70">Configurá la categoría de respaldo y presioná Crear</p>
              </div>
            </div>
          )}
        </div>

        {/* ── Panel de stats horizontal ── */}
        <div className="border-t bg-muted/20 px-8 py-5">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs font-bold tracking-tight text-muted-foreground">Resumen de operación</p>
          </div>
          <div className="grid grid-cols-5 gap-3">
            <div className="rounded-xl border border-border bg-card px-4 py-3 text-center">
              <p className="text-2xl font-bold tabular-nums text-foreground">
                {(result?.total ?? pendingNew).toLocaleString('es-CL')}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Total</p>
            </div>
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-center">
              <p className="text-2xl font-bold tabular-nums text-emerald-700">{(result?.created ?? 0).toLocaleString('es-CL')}</p>
              <p className="mt-0.5 text-[11px] text-emerald-700/70">Creados</p>
            </div>
            <div className="rounded-xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-center">
              <p className="text-2xl font-bold tabular-nums text-sky-700">{(result?.recovered ?? 0).toLocaleString('es-CL')}</p>
              <p className="mt-0.5 text-[11px] text-sky-700/70">Recuperados</p>
            </div>
            <div className="rounded-xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-center">
              <p className="text-2xl font-bold tabular-nums text-sky-700">{(result?.mediaOk ?? 0).toLocaleString('es-CL')}</p>
              <p className="mt-0.5 text-[11px] text-sky-700/70">Imágenes</p>
            </div>
            <div className={`rounded-xl border px-4 py-3 text-center ${
              (result?.errors ?? 0) > 0
                ? 'border-destructive/20 bg-destructive/10'
                : (result?.skipped ?? 0) > 0
                  ? 'border-amber-500/20 bg-amber-500/10'
                  : 'border-border bg-muted/40'
            }`}>
              <p className={`text-2xl font-bold tabular-nums ${
                (result?.errors ?? 0) > 0 ? 'text-destructive'
                : (result?.skipped ?? 0) > 0 ? 'text-amber-700'
                : 'text-muted-foreground'
              }`}>
                {((result?.errors ?? 0) > 0 ? (result?.errors ?? 0) : (result?.skipped ?? 0)).toLocaleString('es-CL')}
              </p>
              <p className={`mt-0.5 text-[11px] ${
                (result?.errors ?? 0) > 0 ? 'text-destructive/70'
                : (result?.skipped ?? 0) > 0 ? 'text-amber-700/70'
                : 'text-muted-foreground'
              }`}>
                {(result?.errors ?? 0) > 0 ? 'Errores' : 'Omitidos'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ━━━ Footer ━━━ */}
      <div className="flex items-center justify-between border-t bg-muted/10 px-8 py-4">
        <Button
          variant="ghost"
          className={`h-9 gap-2 ${isDone ? 'btn-close' : 'btn-cancel'}`}
          onClick={() => onOpenChange(false)}
          disabled={isRunning}
        >
          {isDone ? 'Cerrar' : 'Cancelar'}
        </Button>

        <div className="flex gap-2">
          {status === 'idle' && (
            <Button
              className="btn-create h-9 gap-2"
              onClick={() => void runBatch()}
            >
              <Play className="h-4 w-4" />
              Crear {pendingNew.toLocaleString('es-CL')} producto(s)
            </Button>
          )}

          {status === 'error' && (
            <Button
              className="btn-warn h-9 gap-2"
              onClick={() => void runBatch()}
            >
              <PackagePlus className="h-4 w-4" />
              Reintentar
            </Button>
          )}

          {isDone && result && result.skipped > 0 && (
            <Button
              className="btn-amber h-9 gap-2"
              onClick={() => {
                setStatus('idle')
                setResult(null)
                setError(null)
              }}
            >
              <Tags className="h-4 w-4" />
              Elegir categoría y reintentar
            </Button>
          )}
        </div>
      </div>
    </>
  )
}

/* ────────── Export ────────── */

export function CreateNewProductsModal({
  open,
  onOpenChange,
  pendingNew,
  onFinished,
}: CreateNewProductsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="modal-lg">
        {open && (
          <CreateNewProductsModalInner
            onOpenChange={onOpenChange}
            pendingNew={pendingNew}
            onFinished={onFinished}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
