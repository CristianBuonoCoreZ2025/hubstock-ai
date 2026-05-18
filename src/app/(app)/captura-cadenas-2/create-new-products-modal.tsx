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
  skipped: number
  mediaOk: number
  mediaFailed: number
  errors: number
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

function StatBadge({ label, value, color, delay }: {
  label: string
  value: number
  color: string
  delay?: number
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-transparent px-2.5 py-1 text-xs font-bold tabular-nums shadow-sm ${color}`}
      style={{ animation: `homolog-count-pop 0.4s ease-out ${delay ?? 0}ms both` }}
    >
      {value.toLocaleString('es-CL')}
      <span className="font-normal opacity-70">{label}</span>
    </span>
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
        acc.skipped += stats.skipped
        acc.mediaOk += stats.mediaOk
        acc.mediaFailed += stats.mediaFailed
        acc.errors += stats.errors
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
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/8 via-transparent to-teal-500/6" />
        {isRunning && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className="h-3 w-3 rounded-full bg-emerald-500/60 blur-md"
              style={{ animation: 'homolog-glow-orbit 3s linear infinite' }}
            />
          </div>
        )}
        <DialogHeader className="relative px-6 pb-4 pt-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/25">
              <PackagePlus className="h-5 w-5 text-white" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold tracking-tight">
                Crear maestros nuevos
              </DialogTitle>
              <DialogDescription className="text-xs">
                {pendingNew.toLocaleString('es-CL')} producto(s) sin homólogo en catálogo
              </DialogDescription>
            </div>
          </div>

          {/* Mini chips de estado */}
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
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all duration-500 ${
                  done
                    ? 'bg-emerald-500/15 text-emerald-700'
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
        </DialogHeader>
      </div>

      {/* ━━━ Cuerpo ━━━ */}
      <div className="flex flex-col gap-5 px-6 py-5">

        {/* ── Selector de categoría de respaldo ── */}
        {!isDone && (
          <div
            className={`space-y-2 rounded-xl border p-4 transition-all duration-300 ${
              isRunning
                ? 'border-border/40 opacity-50'
                : 'border-emerald-500/20 bg-emerald-500/[0.03]'
            }`}
            style={{ animation: 'homolog-fade-up 0.35s ease-out both' }}
          >
            <div className="flex items-center gap-2">
              <Tags className="h-4 w-4 text-emerald-600" />
              <p className="text-sm font-semibold">Categoría de respaldo</p>
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
              <SelectTrigger className="h-8 w-full text-xs">
                {sectionsLoading ?
                  <div className="flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
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

        {/* ── Progreso en tiempo real ── */}
        {(isRunning || isDone) && result && (
          <div
            className="space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-4"
            style={{ animation: 'homolog-fade-up 0.3s ease-out both' }}
          >
            <div className="flex items-center justify-between text-xs tabular-nums">
              <p className="font-bold text-emerald-700">
                {result.processed.toLocaleString('es-CL')} de {result.total.toLocaleString('es-CL')} productos
              </p>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 font-bold text-emerald-700">
                  {pct}%
                </span>
                {isRunning && <Sparkles className="h-3.5 w-3.5 animate-pulse text-emerald-500" />}
                {isDone && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
              </div>
            </div>

            <ShimmerBar
              indeterminate={isRunning && result.processed === 0}
              pct={pct}
              color="emerald"
            />

            {/* Chips en tiempo real */}
            <div className="flex flex-wrap gap-1.5">
              {result.created > 0 && (
                <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-emerald-700">
                  {result.created} <span className="font-normal opacity-70">creados</span>
                </span>
              )}
              {result.mediaOk > 0 && (
                <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-sky-700">
                  {result.mediaOk} <span className="font-normal opacity-70">imágenes</span>
                </span>
              )}
              {result.skipped > 0 && (
                <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-amber-700">
                  {result.skipped} <span className="font-normal opacity-70">omitidos</span>
                </span>
              )}
              {result.errors > 0 && (
                <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-destructive/20 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-destructive">
                  {result.errors} <span className="font-normal opacity-70">errores</span>
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {status === 'error' && error && (
          <div
            className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5"
            style={{ animation: 'homolog-fade-up 0.3s ease-out both' }}
          >
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-xs text-destructive">{error}</p>
          </div>
        )}

        {/* ── Resumen final ── */}
        {isDone && result && (
          <div
            className="space-y-3"
            style={{ animation: 'homolog-fade-up 0.4s ease-out both' }}
          >
            {result.created > 0 ?
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
                <Trophy className="h-5 w-5 shrink-0 text-emerald-500" />
                <p className="text-xs font-semibold text-emerald-700">
                  {result.created.toLocaleString('es-CL')} producto(s) creados en el catálogo maestro
                </p>
              </div>
            : <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
                <PackagePlus className="h-5 w-5 shrink-0 text-amber-500" />
                <p className="text-xs font-semibold text-amber-700">
                  Ningún producto creado — probá eligiendo una categoría de respaldo y reintentando.
                </p>
              </div>
            }

            <div className="flex flex-wrap gap-1.5">
              <StatBadge label="procesados" value={result.processed} color="bg-emerald-500/10 text-emerald-700 border-emerald-500/20" delay={0} />
              <StatBadge label="creados" value={result.created} color="bg-teal-500/10 text-teal-700 border-teal-500/20" delay={80} />
              {result.mediaOk > 0 && (
                <StatBadge label="imágenes" value={result.mediaOk} color="bg-sky-500/10 text-sky-700 border-sky-500/20" delay={160} />
              )}
              {result.skipped > 0 && (
                <StatBadge label="omitidos" value={result.skipped} color="bg-amber-500/10 text-amber-700 border-amber-500/20" delay={240} />
              )}
              {result.mediaFailed > 0 && (
                <StatBadge label="sin imagen" value={result.mediaFailed} color="bg-muted text-muted-foreground" delay={320} />
              )}
              {result.errors > 0 && (
                <StatBadge label="errores" value={result.errors} color="bg-destructive/10 text-destructive border-destructive/20" delay={400} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* ━━━ Footer ━━━ */}
      <div className="flex items-center justify-between border-t bg-muted/10 px-6 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onOpenChange(false)}
          disabled={isRunning}
          className="text-muted-foreground"
        >
          {isDone ? 'Cerrar' : 'Cancelar'}
        </Button>

        <div className="flex gap-2">
          {status === 'idle' && (
            <Button
              size="sm"
              onClick={() => void runBatch()}
              className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 shadow-md shadow-emerald-500/20 transition-shadow hover:shadow-lg hover:shadow-emerald-500/30"
            >
              <Play className="h-4 w-4" />
              Crear {pendingNew.toLocaleString('es-CL')} producto(s)
            </Button>
          )}

          {status === 'error' && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void runBatch()}
              className="gap-2"
            >
              <PackagePlus className="h-4 w-4" />
              Reintentar
            </Button>
          )}

          {isDone && result && result.skipped > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setStatus('idle')
                setResult(null)
                setError(null)
              }}
              className="gap-2"
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
      <DialogContent className="max-w-lg gap-0 overflow-hidden rounded-2xl border-0 p-0 shadow-2xl shadow-black/20">
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
