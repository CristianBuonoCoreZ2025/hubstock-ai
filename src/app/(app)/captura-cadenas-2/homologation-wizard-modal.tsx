'use client'

import { useCallback, useState } from 'react'
import {
  CheckCircle2,
  Loader2,
  Play,
  Sparkles,
  XCircle,
  LayoutGrid,
  Zap,
  Brain,
  ClipboardCheck,
  Trophy,
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
  runScrappingHomologationStep2DbMotorAction,
  runScrappingHomologationGrayIaBatchAction,
  runScrappingHomologationCreateNewBatchAction,
} from '@/app/actions/retail-scrapping'
import { PackagePlus } from 'lucide-react'
import { withLogging } from '@/lib/request-logger'

/* ────────── Tipos ────────── */

type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped'

type Step1Result = {
  processed: number
  autoTentative: number
  grayIa: number
  pendingNew: number
}

type Step2Result = {
  processed: number
  total: number
  userReview: number
  tentativeAi: number
  rejected: number
  errors: number
}

type Step3Result = {
  processed: number
  total: number
  created: number
  skipped: number
  mediaOk: number
  mediaFailed: number
  errors: number
}

type HomologationWizardModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  pendingCount: number
  grayIaQueued: number
  onFinished: () => void
  onOpenReview: () => void
}

/* Las animaciones (homolog-shimmer, homolog-pulse-ring, homolog-fade-up, etc.)
   están definidas en globals.css para centralizar estilos. */

/* ────────── Componentes visuales ────────── */

function StepIndicator({ status, stepNumber }: { status: StepStatus; stepNumber: number }) {
  const base = 'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold transition-all duration-500'

  switch (status) {
    case 'done':
      return (
        <div className={`${base} bg-emerald-500 text-white shadow-lg shadow-emerald-500/30`}>
          <CheckCircle2 className="h-5 w-5" />
        </div>
      )
    case 'running':
      return (
        <div className={`${base} bg-primary text-primary-foreground shadow-lg shadow-primary/40`}>
          <div
            className="absolute inset-0 rounded-xl bg-primary/50"
            style={{ animation: 'homolog-pulse-ring 2s ease-in-out infinite' }}
          />
          <Loader2 className="relative h-5 w-5 animate-spin" />
        </div>
      )
    case 'error':
      return (
        <div className={`${base} bg-destructive text-destructive-foreground shadow-lg shadow-destructive/30`}>
          <XCircle className="h-5 w-5" />
        </div>
      )
    case 'skipped':
      return (
        <div className={`${base} border-2 border-dashed border-muted-foreground/25 bg-muted/50 text-muted-foreground/40`}>
          {stepNumber}
        </div>
      )
    default:
      return (
        <div className={`${base} border-2 border-muted-foreground/40 bg-background text-muted-foreground`}>
          {stepNumber}
        </div>
      )
  }
}

const SHIMMER_COLORS = {
  primary: { from: 'hsl(var(--primary))', mid: 'hsl(var(--primary) / 0.3)' },
  violet: { from: '#7c3aed', mid: 'rgba(124,58,237,0.3)' },
}

function ShimmerBar({ indeterminate, pct, color }: { indeterminate?: boolean; pct?: number; color?: keyof typeof SHIMMER_COLORS }) {
  const c = SHIMMER_COLORS[color ?? 'primary']
  const width = indeterminate ? '100%' : `${Math.min(100, pct ?? 0)}%`
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted/60">
      <div
        className="h-full rounded-full"
        style={{
          background: `linear-gradient(90deg, ${c.from} 0%, ${c.mid} 50%, ${c.from} 100%)`,
          backgroundSize: '200% 100%',
          animation: indeterminate ? 'homolog-shimmer 1.8s ease-in-out infinite' : undefined,
          width,
          transition: 'width 0.5s ease-out',
        }}
      />
    </div>
  )
}

function StatBadge({ label, value, color, delay }: { label: string; value: number; color?: string; delay?: number }) {
  const c = color ?? 'bg-muted text-foreground'
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-transparent px-2.5 py-1 text-xs font-bold tabular-nums shadow-sm ${c}`}
      style={{ animation: `homolog-count-pop 0.4s ease-out ${delay ?? 0}ms both` }}
    >
      {value.toLocaleString('es-CL')}
      <span className="font-normal opacity-70">{label}</span>
    </span>
  )
}

function StepIcon({ step, status }: { step: 1 | 2 | 3; status: StepStatus }) {
  const active = status === 'running' || status === 'done'
  const cls = `h-4 w-4 ${active ? 'text-foreground' : 'text-muted-foreground/50'} transition-colors duration-300`
  if (step === 1) return <Zap className={cls} />
  if (step === 2) return <Brain className={cls} />
  return <ClipboardCheck className={cls} />
}

/* ────────── Modal principal ────────── */

function HomologationWizardInner({
  onOpenChange,
  pendingCount,
  grayIaQueued: _grayIaQueued,
  onFinished,
  onOpenReview,
}: Omit<HomologationWizardModalProps, 'open'>) {
  const [step1Status, setStep1Status] = useState<StepStatus>('pending')
  const [step2Status, setStep2Status] = useState<StepStatus>('pending')
  const [step3Status, setStep3Status] = useState<StepStatus>('pending')

  const [step1Result, setStep1Result] = useState<Step1Result | null>(null)
  const [step2Result, setStep2Result] = useState<Step2Result | null>(null)
  const [step3Result, setStep3Result] = useState<Step3Result | null>(null)
  const [step1Error, setStep1Error] = useState<string | null>(null)
  const [step2Error, setStep2Error] = useState<string | null>(null)
  const [step3Error, setStep3Error] = useState<string | null>(null)

  const [autoMode, setAutoMode] = useState(false)

  /* ── Paso 1: Calcular scores base ── */
  const runStep1 = useCallback(async (): Promise<Step1Result | null> => {
    setStep1Status('running')
    setStep1Error(null)
    try {
      const out = await withLogging('api', 'runScrappingHomologationStep2DbMotorAction', () => runScrappingHomologationStep2DbMotorAction())
      if (!out.ok) {
        setStep1Status('error')
        setStep1Error(out.error)
        return null
      }
      const r: Step1Result = {
        processed: out.summary.processed,
        autoTentative: out.summary.auto_tentative_base,
        grayIa: out.summary.gray_ia_queued,
        pendingNew: out.summary.pending_new,
      }
      setStep1Result(r)
      setStep1Status('done')
      return r
    } catch (e) {
      setStep1Status('error')
      setStep1Error(e instanceof Error ? e.message : 'Error inesperado')
      return null
    }
  }, [])

  /* ── Paso 2: IA zona gris (por lotes con progreso) ── */
  const runStep2 = useCallback(async (grayCount: number): Promise<Step2Result | null> => {
    if (grayCount === 0) {
      setStep2Status('skipped')
      return { processed: 0, total: 0, userReview: 0, tentativeAi: 0, rejected: 0, errors: 0 }
    }
    setStep2Status('running')
    setStep2Error(null)

    const acc: Step2Result = { processed: 0, total: grayCount, userReview: 0, tentativeAi: 0, rejected: 0, errors: 0 }
    setStep2Result({ ...acc })

    let afterId: string | null = null
    try {
      for (;;) {
        const out = await withLogging('api', 'runScrappingHomologationGrayIaBatchAction', () => runScrappingHomologationGrayIaBatchAction({ afterId, batchSize: 10 }))
        if (!out.ok) {
          setStep2Status('error')
          setStep2Error(out.error)
          return null
        }
        const { stats, hasMore, lastId, total } = out.result
        acc.processed += stats.processed
        acc.userReview += stats.userReview
        acc.tentativeAi += stats.tentativeAi
        acc.rejected += stats.rejected
        acc.errors += stats.errors
        acc.total = Math.max(acc.total, total + acc.processed)
        setStep2Result({ ...acc })

        if (!hasMore || !lastId) break
        afterId = lastId
      }
      setStep2Status('done')
      return acc
    } catch (e) {
      setStep2Status('error')
      setStep2Error(e instanceof Error ? e.message : 'Error inesperado')
      return null
    }
  }, [])

  /* ── Paso 3: Crear productos nuevos (por lotes con progreso) ── */
  const runStep3 = useCallback(async (pendingNewCount: number): Promise<boolean> => {
    if (pendingNewCount === 0) {
      setStep3Status('skipped')
      return true
    }
    setStep3Status('running')
    setStep3Error(null)

    const acc: Step3Result = { processed: 0, total: pendingNewCount, created: 0, skipped: 0, mediaOk: 0, mediaFailed: 0, errors: 0 }
    setStep3Result({ ...acc })

    let afterId: string | null = null
    try {
      for (;;) {
        const out = await withLogging('api', 'runScrappingHomologationCreateNewBatchAction', () => runScrappingHomologationCreateNewBatchAction({ afterId, batchSize: 10 }))
        if (!out.ok) {
          setStep3Status('error')
          setStep3Error(out.error)
          return false
        }
        const { stats, hasMore, lastId, total } = out.result
        acc.processed += stats.processed
        acc.created += stats.created
        acc.skipped += stats.skipped
        acc.mediaOk += stats.mediaOk
        acc.mediaFailed += stats.mediaFailed
        acc.errors += stats.errors
        acc.total = Math.max(acc.total, total + acc.processed)
        setStep3Result({ ...acc })

        if (!hasMore || !lastId) break
        afterId = lastId
      }
      setStep3Status('done')
      return true
    } catch (e) {
      setStep3Status('error')
      setStep3Error(e instanceof Error ? e.message : 'Error inesperado')
      return false
    }
  }, [])

  /* ── Modo automático ── */
  const runAll = useCallback(async () => {
    setAutoMode(true)
    const s1 = await runStep1()
    if (!s1) return
    const s2 = await runStep2(s1.grayIa)
    if (!s2) return
    // pending_new del motor + rechazados de IA
    const pendingNewTotal = s1.pendingNew + s2.rejected
    const ok3 = await runStep3(pendingNewTotal)
    if (ok3) {
      onFinished()
    }
  }, [runStep1, runStep2, runStep3, onFinished])

  /* ── Helpers de UI ── */
  const isRunning = step1Status === 'running' || step2Status === 'running' || step3Status === 'running'
  const allDone = (step1Status === 'done' || step1Status === 'skipped') &&
    (step2Status === 'done' || step2Status === 'skipped') &&
    (step3Status === 'done' || step3Status === 'skipped')

  const totalReview = step2Result?.userReview ?? 0

  return (
    <>

      {/* ━━━ Header con gradiente y glow orbital ━━━ */}
      <div className="relative overflow-hidden border-b">
        {/* Gradiente de fondo */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-violet-500/6" />
        {/* Orbe de glow orbital */}
        {isRunning && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className="h-3 w-3 rounded-full bg-primary/60 blur-md"
              style={{ animation: 'homolog-glow-orbit 3s linear infinite' }}
            />
          </div>
        )}
        <DialogHeader className="relative px-6 pb-4 pt-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-violet-600 shadow-lg shadow-primary/25">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold tracking-tight">
                Homologador inteligente
              </DialogTitle>
              <DialogDescription className="text-xs">
                {pendingCount.toLocaleString('es-CL')} producto(s) en cola
              </DialogDescription>
            </div>
          </div>
          {/* Mini-chips de estado en el header */}
          <div className="mt-3 flex gap-1.5">
            {(['1', '2', '3'] as const).map((n) => {
              const s = n === '1' ? step1Status : n === '2' ? step2Status : step3Status
              const done = s === 'done' || s === 'skipped'
              const active = s === 'running'
              return (
                <div
                  key={n}
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all duration-500 ${
                    done
                      ? 'bg-emerald-500/15 text-emerald-700'
                      : active
                        ? 'bg-primary/15 text-primary'
                        : 'bg-muted text-muted-foreground/50'
                  }`}
                >
                  <StepIcon step={Number(n) as 1 | 2 | 3} status={s} />
                  {n === '1' ? 'Motor' : n === '2' ? 'IA' : 'Nuevos'}
                  {done && <CheckCircle2 className="ml-0.5 h-3 w-3" />}
                </div>
              )
            })}
          </div>
        </DialogHeader>
      </div>

      {/* ━━━ Cuerpo con pasos ━━━ */}
      <div className="flex flex-col gap-0 px-6 py-5">

        {/* ── PASO 1 ── */}
        <div
          className="flex items-start gap-3.5"
          style={{ animation: 'homolog-fade-up 0.35s ease-out both' }}
        >
          <div className="flex flex-col items-center">
            <StepIndicator status={step1Status} stepNumber={1} />
            <div className={`mt-1.5 h-10 w-px transition-colors duration-500 ${step1Status === 'done' ? 'bg-emerald-400/40' : 'bg-border'}`} />
          </div>
          <div className="flex-1 pb-5">
            <div className="flex items-center gap-2">
              <Zap className={`h-4 w-4 ${step1Status === 'running' ? 'text-primary' : step1Status === 'done' ? 'text-emerald-600' : 'text-muted-foreground/60'} transition-colors`} />
              <p className="text-sm font-semibold">Motor de scoring</p>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Compara nombre, marca, precio y categoría contra el catálogo maestro para asignar un puntaje base.
            </p>

            {step1Status === 'running' && (
              <div className="mt-3 space-y-2" style={{ animation: 'homolog-fade-up 0.3s ease-out both' }}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-primary">Analizando {pendingCount.toLocaleString('es-CL')} productos…</p>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                </div>
                <ShimmerBar indeterminate />
              </div>
            )}

            {step1Status === 'done' && step1Result && (
              <div className="mt-3 flex gap-1.5 overflow-x-auto" style={{ animation: 'homolog-fade-up 0.3s ease-out both' }}>
                <StatBadge label="procesados" value={step1Result.processed} color="bg-primary/10 text-primary border-primary/20" delay={0} />
                <StatBadge label="auto" value={step1Result.autoTentative} color="bg-emerald-500/10 text-emerald-700 border-emerald-500/20" delay={80} />
                <StatBadge label="zona gris" value={step1Result.grayIa} color="bg-amber-500/10 text-amber-700 border-amber-500/20" delay={160} />
                <StatBadge label="nuevos" value={step1Result.pendingNew} color="bg-sky-500/10 text-sky-700 border-sky-500/20" delay={240} />
              </div>
            )}

            {step1Status === 'done' && step1Result && step1Result.processed > 0 && step1Result.pendingNew === step1Result.processed && step1Result.autoTentative === 0 && step1Result.grayIa === 0 && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                El catálogo maestro está vacío. Todos los productos se marcaron como nuevos.
              </p>
            )}

            {step1Status === 'error' && (
              <div className="mt-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {step1Error}
              </div>
            )}
          </div>
        </div>

        {/* ── PASO 2 ── */}
        <div
          className="flex items-start gap-3.5"
          style={{ animation: 'homolog-fade-up 0.35s ease-out 0.08s both' }}
        >
          <div className="flex flex-col items-center">
            <StepIndicator status={step2Status} stepNumber={2} />
            <div className={`mt-1.5 h-10 w-px transition-colors duration-500 ${step2Status === 'done' ? 'bg-emerald-400/40' : 'bg-border'}`} />
          </div>
          <div className="flex-1 pb-5">
            <div className="flex items-center gap-2">
              <Brain className={`h-4 w-4 ${step2Status === 'running' ? 'text-violet-500' : step2Status === 'done' ? 'text-emerald-600' : 'text-muted-foreground/60'} transition-colors`} />
              <p className="text-sm font-semibold">Inteligencia artificial</p>
              {step2Status === 'pending' && step1Result && step1Result.grayIa > 0 && (
                <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-amber-600">
                  {step1Result.grayIa.toLocaleString('es-CL')} pendientes
                </span>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Evalúa los casos ambiguos con IA para confirmar, rechazar o escalar a revisión humana.
            </p>

            {step2Status === 'running' && step2Result && (
              <div className="mt-3 space-y-2" style={{ animation: 'homolog-fade-up 0.3s ease-out both' }}>
                <div className="flex items-center justify-between text-xs tabular-nums">
                  <p className="font-bold text-violet-600">
                    {step2Result.processed.toLocaleString('es-CL')} de {step2Result.total.toLocaleString('es-CL')}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-violet-500/10 px-1.5 py-0.5 font-bold text-violet-600">
                      {step2Result.total > 0 ? Math.min(100, Math.round((step2Result.processed / step2Result.total) * 100)) : 0}%
                    </span>
                    <Sparkles className="h-3.5 w-3.5 animate-pulse text-violet-500" />
                  </div>
                </div>
                <ShimmerBar
                  indeterminate={step2Result.processed === 0}
                  pct={step2Result.total > 0 ? Math.min(100, Math.round((step2Result.processed / step2Result.total) * 100)) : 0}
                  color="violet"
                />
                <div className="flex gap-1.5 overflow-x-auto">
                  {step2Result.tentativeAi > 0 && (
                    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-emerald-700">
                      {step2Result.tentativeAi} <span className="font-normal opacity-70">confirmados</span>
                    </span>
                  )}
                  {step2Result.userReview > 0 && (
                    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-amber-700">
                      {step2Result.userReview} <span className="font-normal opacity-70">revisión</span>
                    </span>
                  )}
                  {step2Result.rejected > 0 && (
                    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-red-700">
                      {step2Result.rejected} <span className="font-normal opacity-70">rechazados</span>
                    </span>
                  )}
                  {step2Result.errors > 0 && (
                    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-destructive/20 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-destructive">
                      {step2Result.errors} <span className="font-normal opacity-70">errores</span>
                    </span>
                  )}
                </div>
              </div>
            )}

            {step2Status === 'skipped' && (
              <p className="mt-2 text-xs italic text-muted-foreground/60">Sin casos en zona gris — paso omitido.</p>
            )}

            {step2Status === 'done' && step2Result && (
              <div className="mt-3 flex gap-1.5 overflow-x-auto" style={{ animation: 'homolog-fade-up 0.3s ease-out both' }}>
                <StatBadge label="procesados" value={step2Result.processed} color="bg-violet-500/10 text-violet-700 border-violet-500/20" delay={0} />
                <StatBadge label="confirmados" value={step2Result.tentativeAi} color="bg-emerald-500/10 text-emerald-700 border-emerald-500/20" delay={80} />
                <StatBadge label="revisión" value={step2Result.userReview} color="bg-amber-500/10 text-amber-700 border-amber-500/20" delay={160} />
                <StatBadge label="rechazados" value={step2Result.rejected} color="bg-red-500/10 text-red-700 border-red-500/20" delay={240} />
                {step2Result.errors > 0 && (
                  <StatBadge label="errores" value={step2Result.errors} color="bg-destructive/10 text-destructive border-destructive/20" delay={320} />
                )}
              </div>
            )}

            {step2Status === 'error' && (
              <div className="mt-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {step2Error}
              </div>
            )}
          </div>
        </div>

        {/* ── PASO 3 (crear productos nuevos) ── */}
        <div
          className="flex items-start gap-3.5"
          style={{ animation: 'homolog-fade-up 0.35s ease-out 0.16s both' }}
        >
          <div className="flex flex-col items-center">
            <StepIndicator status={step3Status} stepNumber={3} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <PackagePlus className={`h-4 w-4 ${step3Status === 'running' ? 'text-sky-600' : step3Status === 'done' ? 'text-emerald-600' : 'text-muted-foreground/60'} transition-colors`} />
              <p className="text-sm font-semibold">Crear productos nuevos</p>
              {step3Status === 'pending' && step1Result && step1Result.pendingNew > 0 && (
                <span className="rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-sky-600">
                  {step1Result.pendingNew.toLocaleString('es-CL')} pendientes
                </span>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Crea los artículos nuevos en el catálogo maestro, asigna categoría y descarga imágenes.
            </p>

            {step3Status === 'running' && step3Result && (
              <div className="mt-3 space-y-2" style={{ animation: 'homolog-fade-up 0.3s ease-out both' }}>
                <div className="flex items-center justify-between text-xs tabular-nums">
                  <p className="font-bold text-sky-600">
                    {step3Result.processed.toLocaleString('es-CL')} de {step3Result.total.toLocaleString('es-CL')}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-sky-500/10 px-1.5 py-0.5 font-bold text-sky-600">
                      {step3Result.total > 0 ? Math.min(100, Math.round((step3Result.processed / step3Result.total) * 100)) : 0}%
                    </span>
                    <PackagePlus className="h-3.5 w-3.5 animate-pulse text-sky-500" />
                  </div>
                </div>
                <ShimmerBar
                  indeterminate={step3Result.processed === 0}
                  pct={step3Result.total > 0 ? Math.min(100, Math.round((step3Result.processed / step3Result.total) * 100)) : 0}
                  color="primary"
                />
                <div className="flex gap-1.5 overflow-x-auto">
                  {step3Result.created > 0 && (
                    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-emerald-700">
                      {step3Result.created} <span className="font-normal opacity-70">creados</span>
                    </span>
                  )}
                  {step3Result.skipped > 0 && (
                    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-amber-700">
                      {step3Result.skipped} <span className="font-normal opacity-70">omitidos</span>
                    </span>
                  )}
                  {step3Result.errors > 0 && (
                    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-destructive/20 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-destructive">
                      {step3Result.errors} <span className="font-normal opacity-70">errores</span>
                    </span>
                  )}
                </div>
              </div>
            )}

            {step3Status === 'skipped' && (
              <p className="mt-2 text-xs italic text-muted-foreground/60">Sin productos nuevos — paso omitido.</p>
            )}

            {step3Status === 'done' && step3Result && (
              <div className="mt-3 flex gap-1.5 overflow-x-auto" style={{ animation: 'homolog-fade-up 0.3s ease-out both' }}>
                <StatBadge label="procesados" value={step3Result.processed} color="bg-sky-500/10 text-sky-700 border-sky-500/20" delay={0} />
                <StatBadge label="creados" value={step3Result.created} color="bg-emerald-500/10 text-emerald-700 border-emerald-500/20" delay={80} />
                <StatBadge label="omitidos" value={step3Result.skipped} color="bg-amber-500/10 text-amber-700 border-amber-500/20" delay={160} />
                {step3Result.errors > 0 && (
                  <StatBadge label="errores" value={step3Result.errors} color="bg-destructive/10 text-destructive border-destructive/20" delay={240} />
                )}
              </div>
            )}

            {step3Status === 'error' && (
              <div className="mt-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {step3Error}
              </div>
            )}
          </div>
        </div>

        {/* ── RESUMEN FINAL ── */}
        {allDone && totalReview > 0 && (
          <div className="mt-4 space-y-3" style={{ animation: 'homolog-fade-up 0.4s ease-out both' }}>
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
              <p className="text-xs font-medium text-amber-700">
                {totalReview.toLocaleString('es-CL')} caso(s) necesitan tu revisión manual
              </p>
            </div>
            <Button
              variant="default"
              size="sm"
              className="h-9 gap-2 bg-gradient-to-r from-primary to-violet-600 shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30"
              onClick={() => {
                onOpenChange(false)
                onOpenReview()
              }}
            >
              <LayoutGrid className="h-4 w-4" />
              Abrir revisión de casos
            </Button>
          </div>
        )}

        {allDone && totalReview === 0 && (
          <div
            className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5"
            style={{ animation: 'homolog-fade-up 0.5s ease-out both' }}
          >
            <Trophy className="h-5 w-5 text-emerald-500" />
            <p className="text-xs font-semibold text-emerald-700">
              ¡Todos los productos fueron clasificados automáticamente!
            </p>
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
          {allDone ? 'Cerrar' : 'Cancelar'}
        </Button>

        <div className="flex gap-2">
          {step1Status === 'pending' && (
            <Button
              size="sm"
              onClick={runAll}
              className="gap-2 bg-gradient-to-r from-primary to-violet-600 shadow-md shadow-primary/20 transition-shadow hover:shadow-lg hover:shadow-primary/30"
            >
              <Play className="h-4 w-4" />
              Iniciar homologación
            </Button>
          )}

          {step1Status === 'error' && (
            <Button size="sm" variant="secondary" onClick={() => void runAll()} className="gap-2">
              <Zap className="h-4 w-4" />
              Reintentar
            </Button>
          )}

          {step2Status === 'error' && (
            <Button size="sm" variant="secondary" onClick={() => void runAll()} className="gap-2">
              <Brain className="h-4 w-4" />
              Reintentar
            </Button>
          )}

          {step3Status === 'error' && (
            <Button size="sm" variant="secondary" onClick={() => void runAll()} className="gap-2">
              <PackagePlus className="h-4 w-4" />
              Reintentar
            </Button>
          )}
        </div>
      </div>
    </>
  )
}

export function HomologationWizardModal({
  open,
  onOpenChange,
  pendingCount,
  grayIaQueued,
  onFinished,
  onOpenReview,
}: HomologationWizardModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="modal-lg">
        {open && (
          <HomologationWizardInner
            onOpenChange={onOpenChange}
            pendingCount={pendingCount}
            grayIaQueued={grayIaQueued}
            onFinished={onFinished}
            onOpenReview={onOpenReview}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
